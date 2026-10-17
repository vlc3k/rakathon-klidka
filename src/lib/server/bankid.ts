import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { bankidEnv } from "@/lib/server/env";

// Přihlášení přes Bank iD: OpenID Connect, Authorization Code + PKCE (S256), state a nonce proti podvržení.
// 1. start(): adresa přihlášení u Bank iD + tajné hodnoty pro cookie (state, nonce, code_verifier)
// 2. finish(): po návratu vymění kód za tokeny a z userinfo vrátí ověřené údaje o člověku
// Hesla ani bankovní údaje nikdy nevidíme, Bank iD nám pošle jen údaje ze scope.

export const BANKID_COOKIE = "aa_bankid";
// údaje, které chceme: jméno, datum narození a rodné číslo (podle RČ a data narození najdeme pacienta)
const SCOPE = "openid profile.name profile.birthdate profile.birthnumber";

// profile_endpoint: Bank iD vrací údaje produktu Identify (rodné číslo) z /profile, /userinfo má jen Connect (jméno, datum).
type Discovery = { issuer: string; authorization_endpoint: string; token_endpoint: string; userinfo_endpoint: string; profile_endpoint?: string };
let discovery: Promise<Discovery> | null = null;

function discover(): Promise<Discovery> {
  discovery ??= fetch(`${bankidEnv().BANKID_ISSUER.replace(/\/$/, "")}/.well-known/openid-configuration`, { cache: "no-store" }).then(async (res) => {
    if (!res.ok) throw new Error(`Bank iD discovery ${res.status}`);
    return (await res.json()) as Discovery;
  });
  discovery.catch(() => (discovery = null)); // při chybě zkusit příště znovu
  return discovery;
}

const b64url = (buf: Buffer) => buf.toString("base64url");
const redirectUri = (origin: string) => bankidEnv().BANKID_REDIRECT_URI ?? `${origin}/api/auth/bankid/callback`;

export type BankidPending = { state: string; nonce: string; verifier: string; redirectUri: string };

export async function start(origin: string): Promise<{ url: string; pending: BankidPending }> {
  const { authorization_endpoint } = await discover();
  const pending: BankidPending = { state: b64url(randomBytes(24)), nonce: b64url(randomBytes(24)), verifier: b64url(randomBytes(48)), redirectUri: redirectUri(origin) };
  const url = new URL(authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: bankidEnv().BANKID_CLIENT_ID,
    redirect_uri: pending.redirectUri,
    scope: SCOPE,
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: b64url(createHash("sha256").update(pending.verifier).digest()),
    code_challenge_method: "S256",
  }).toString();
  return { url: url.toString(), pending };
}

export type BankidPerson = { sub: string; givenName?: string; familyName?: string; birthDate?: string; birthNumber?: string };

export async function finish(params: URLSearchParams, pending: BankidPending): Promise<BankidPerson> {
  if (params.get("error")) throw new BankidError(params.get("error") === "access_denied" ? "Přihlášení přes Bank iD bylo zrušeno." : "Bank iD přihlášení odmítlo.");
  const code = params.get("code");
  if (!code || params.get("state") !== pending.state) throw new BankidError("Neplatná odpověď Bank iD (nesedí state). Zkuste to znovu.");

  const { token_endpoint, userinfo_endpoint, profile_endpoint, issuer } = await discover();
  const { BANKID_CLIENT_ID, BANKID_CLIENT_SECRET } = bankidEnv();
  // Bank iD ověřuje klienta jen client_secret_post (ne Basic): id a tajemství v těle požadavku.
  const res = await fetch(token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: pending.redirectUri,
      code_verifier: pending.verifier,
      client_id: BANKID_CLIENT_ID,
      client_secret: BANKID_CLIENT_SECRET,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Bank iD token ${res.status}`);
  const tokens = (await res.json()) as { access_token: string; id_token?: string };

  // ID token přišel přímo z token endpointu přes TLS po ověření klienta, takže podle OIDC stačí zkontrolovat
  // vydavatele, příjemce a nonce (podpis kontrolovat nemusíme, nikdo třetí ho nepodstrčil).
  if (tokens.id_token) {
    const claims = JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString("utf8")) as { iss?: string; aud?: string | string[]; nonce?: string };
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== issuer || !aud.includes(BANKID_CLIENT_ID) || claims.nonce !== pending.nonce) throw new BankidError("Neplatná odpověď Bank iD (ID token). Zkuste to znovu.");
  }

  // Rodné číslo je v /profile (Identify); když endpoint není nebo selže, aspoň /userinfo.
  type Person = { sub: string; given_name?: string; family_name?: string; birthdate?: string; birthnumber?: string };
  const read = async (endpoint: string): Promise<Person> => {
    const r = await fetch(endpoint, { headers: { authorization: `Bearer ${tokens.access_token}` }, cache: "no-store" });
    if (!r.ok) throw new Error(`Bank iD ${new URL(endpoint).pathname} ${r.status}`);
    const text = await r.text();
    // podepsaná odpověď (JWT) i obyčejný JSON; přišla přímo z Bank iD přes TLS s naším access tokenem
    return JSON.parse(/^[\w-]+\.[\w-]+\.[\w-]*$/.test(text.trim()) ? Buffer.from(text.trim().split(".")[1], "base64url").toString("utf8") : text);
  };
  const u = profile_endpoint ? await read(profile_endpoint).catch(() => read(userinfo_endpoint)) : await read(userinfo_endpoint);
  return { sub: u.sub, givenName: u.given_name, familyName: u.family_name, birthDate: u.birthdate, birthNumber: u.birthnumber?.replace(/\D/g, "") };
}

/** Chyba, kterou smíme ukázat uživateli. */
export class BankidError extends Error {}
