import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GET as start } from "@/app/api/auth/bankid/route";
import { GET as callback } from "@/app/api/auth/bankid/callback/route";
import { GET as session } from "@/app/api/auth/session/route";
import { createPatient } from "../support/factories";
import { request, sessionCookieFrom } from "../support/http";

// Bank iD je v testech podvržené (fetch), databáze je skutečná (PGlite). Ověřuje se celý tok:
// přesměrování s PKCE → návrat s kódem → výměna za údaje → pacient podle RČ a data narození → session.

const ISSUER = "https://oidc.sandbox.bankid.cz";
const CLIENT_ID = "test-client";
let person: Record<string, string> = {};
let idTokenNonce: string | null = null;

const jwt = (payload: object) => `e30.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.podpis`;

beforeEach(() => {
  vi.stubEnv("BANKID_ISSUER", ISSUER);
  vi.stubEnv("BANKID_CLIENT_ID", CLIENT_ID);
  vi.stubEnv("BANKID_CLIENT_SECRET", "tajne");
  vi.stubEnv("BANKID_REDIRECT_URI", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/.well-known/openid-configuration"))
        return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/auth`, token_endpoint: `${ISSUER}/token`, userinfo_endpoint: `${ISSUER}/userinfo`, profile_endpoint: `${ISSUER}/profile` });
      if (u === `${ISSUER}/token`) {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("grant_type")).toBe("authorization_code");
        expect(body.get("code_verifier")).toBeTruthy();
        // Bank iD umí jen client_secret_post
        expect(body.get("client_secret")).toBe("tajne");
        expect(new Headers(init?.headers).get("authorization")).toBeNull();
        return Response.json({ access_token: "pristup", id_token: jwt({ iss: ISSUER, aud: CLIENT_ID, nonce: idTokenNonce }) });
      }
      // rodné číslo vrací jen /profile (Identify), /userinfo ne
      if (u === `${ISSUER}/profile`) return Response.json({ sub: "bankid-123", ...person });
      if (u === `${ISSUER}/userinfo`) return Response.json({ sub: "bankid-123", given_name: person.given_name });
      throw new Error(`neočekávaný fetch ${u}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// Začátek přihlášení: vrátí adresu u Bank iD a cookie s tajnými hodnotami pro návrat.
async function begin() {
  const res = await start(request("GET", "/api/auth/bankid"));
  const location = new URL(res.headers.get("location")!);
  const cookie = res.headers.get("set-cookie")!;
  const pending = JSON.parse(decodeURIComponent(cookie.split(";")[0].split("=").slice(1).join("=")));
  return { res, location, cookie: cookie.split(";")[0], pending };
}

describe("přihlášení přes Bank iD", () => {
  test("přesměruje na Bank iD s PKCE, state a nonce, tajné hodnoty jen v httpOnly cookie", async () => {
    const { res, location, cookie, pending } = await begin();

    expect(res.status).toBe(307);
    expect(location.origin + location.pathname).toBe(`${ISSUER}/auth`);
    expect(location.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("scope")).toContain("profile.birthnumber");
    expect(location.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/auth/bankid/callback");
    expect(location.searchParams.get("state")).toBe(pending.state);
    expect(location.toString()).not.toContain(pending.verifier);
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/^aa_bankid=/);
  });

  test("po návratu najde pacienta podle RČ a data narození a přihlásí ho", async () => {
    const { user } = await createPatient({ patient: { birthNumber: "8056161520", birthDate: "1980-06-16" } });
    person = { given_name: "Lakita", family_name: "Jacobson", birthdate: "1980-06-16", birthnumber: "805616/1520" };
    const { cookie, pending } = await begin();
    idTokenNonce = pending.nonce;

    const res = await callback(request("GET", `/api/auth/bankid/callback?code=kod&state=${pending.state}`, { cookie }));

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/patient");
    const me = await session(request("GET", "/api/auth/session", { cookie: sessionCookieFrom(res) }));
    expect(me.status).toBe(200);
    expect((await me.json()).id).toBe(user.id);
  });

  test("nesedí datum narození: nepřihlásí a řekne proč", async () => {
    await createPatient({ patient: { birthNumber: "7110042874", birthDate: "1971-10-04" } });
    person = { birthdate: "1971-10-05", birthnumber: "7110042874" };
    const { cookie, pending } = await begin();
    idTokenNonce = pending.nonce;

    const res = await callback(request("GET", `/api/auth/bankid/callback?code=kod&state=${pending.state}`, { cookie }));

    expect(res.headers.get("location")).toMatch(/\/login\?bankid=nenalezen$/);
    expect(res.headers.get("set-cookie")).not.toMatch(/aa_session=[^;]+/);
  });

  test("podvržený state nebo nonce odmítne", async () => {
    person = { birthdate: "1980-06-16", birthnumber: "8056161520" };
    const first = await begin();
    idTokenNonce = first.pending.nonce;
    const badState = await callback(request("GET", "/api/auth/bankid/callback?code=kod&state=cizi", { cookie: first.cookie }));
    expect(badState.headers.get("location")).toMatch(/bankid=neplatne$/);

    const second = await begin();
    idTokenNonce = "cizi-nonce";
    const badNonce = await callback(request("GET", `/api/auth/bankid/callback?code=kod&state=${second.pending.state}`, { cookie: second.cookie }));
    expect(badNonce.headers.get("location")).toMatch(/bankid=neplatne$/);
  });

  test("zrušení u Bank iD a návrat bez cookie skončí srozumitelnou zprávou", async () => {
    const { cookie, pending } = await begin();
    const cancelled = await callback(request("GET", `/api/auth/bankid/callback?error=access_denied&state=${pending.state}`, { cookie }));
    expect(cancelled.headers.get("location")).toMatch(/bankid=zruseno$/);

    const noCookie = await callback(request("GET", "/api/auth/bankid/callback?code=kod&state=x"));
    expect(noCookie.headers.get("location")).toMatch(/bankid=vyprselo$/);
  });

  test("za proxy (Azure) použije veřejnou doménu, ne adresu, na které Next.js poslouchá", async () => {
    // Next.js za proxy skládá req.url z vlastního hostname:port (localhost:3000), veřejná doména je jen v hlavičkách.
    const proxied = { host: "klidka.cz", "x-forwarded-proto": "https" };
    await createPatient({ patient: { birthNumber: "9001011237", birthDate: "1990-01-01" } });
    person = { birthdate: "1990-01-01", birthnumber: "9001011237" };
    const res = await start(request("GET", "/api/auth/bankid", { headers: proxied }));
    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("redirect_uri")).toBe("https://klidka.cz/api/auth/bankid/callback");

    const cookie = res.headers.get("set-cookie")!.split(";")[0];
    const pending = JSON.parse(decodeURIComponent(cookie.split("=").slice(1).join("=")));
    idTokenNonce = pending.nonce;
    const back = await callback(request("GET", `/api/auth/bankid/callback?code=kod&state=${pending.state}`, { cookie, headers: proxied }));
    expect(back.headers.get("location")).toBe("https://klidka.cz/patient");

    const failed = await callback(request("GET", "/api/auth/bankid/callback?code=kod&state=x", { headers: proxied }));
    expect(failed.headers.get("location")).toBe("https://klidka.cz/login?bankid=vyprselo");
  });

  test("bez nastavení Bank iD tlačítko jen vrátí zprávu", async () => {
    vi.stubEnv("BANKID_CLIENT_ID", "");
    const res = await start(request("GET", "/api/auth/bankid"));
    expect(res.headers.get("location")).toMatch(/\/login\?bankid=nenastaveno$/);
  });
});
