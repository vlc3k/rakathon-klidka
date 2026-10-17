import { describe, expect, test, vi } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as session } from "@/app/api/auth/session/route";
import { loginAttempts } from "@/db/schema";
import { testDb } from "../support/db";
import { createPatient, createStaff } from "../support/factories";
import { request, sessionCookieFrom } from "../support/http";

const patientLogin = (identifier: string, birthDate: string, headers: Record<string, string> = {}) =>
  login(request("POST", "/api/auth/login", { json: { identifier, birthDate }, headers }));

describe("přihlášení pacienta", () => {
  test("identifikátor a datum narození vytvoří session v httpOnly cookie", async () => {
    const { user, patient } = await createPatient();

    const res = await patientLogin(patient.externalId!, "1960-03-01");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: user.id, role: "patient", displayName: user.displayName });
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=43200/);
  });

  test("identifikátor nezáleží na velikosti písmen a mezerách", async () => {
    await createPatient({ patient: { externalId: "VFN-2026-0142" } });

    const res = await patientLogin("  vfn-2026-0142 ", "1960-03-01");

    expect(res.status).toBe(200);
  });

  test("špatné datum narození i neznámý identifikátor vrátí stejnou chybu", async () => {
    const { patient } = await createPatient();

    const wrongDate = await patientLogin(patient.externalId!, "1961-03-01");
    const unknown = await patientLogin("VFN-0000-0000", "1960-03-01");

    expect(wrongDate.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrongDate.json()).toEqual(await unknown.json());
    expect(wrongDate.headers.get("set-cookie")).toBeNull();
  });

  test("paralelní pokusy limit neobejdou", async () => {
    const { patient } = await createPatient();

    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => patientLogin(patient.externalId!, `1990-01-${String(i + 1).padStart(2, "0")}`)));

    expect(results.filter((r) => r.status === 401).length).toBeLessThanOrEqual(5);
    expect(results.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(15);
  });

  test("po pěti neúspěšných pokusech se identifikátor dočasně zablokuje i pro správné údaje", async () => {
    const { patient } = await createPatient();
    for (let i = 0; i < 5; i++) expect((await patientLogin(patient.externalId!, "2000-01-01")).status).toBe(401);

    const res = await patientLogin(patient.externalId!, "1960-03-01");

    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("přihlášení lékaře", () => {
  test("e-mail a společné heslo z prostředí přihlásí roli aa", async () => {
    const staff = await createStaff({ email: "eva.mala@vfn.cz" });

    const res = await login(request("POST", "/api/auth/login", { json: { email: "Eva.Mala@VFN.cz", password: "test-staff-password-1234" } }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: staff.id, role: "aa" });
  });

  test("špatné heslo vrátí 401", async () => {
    await createStaff({ email: "eva.mala@vfn.cz" });

    const res = await login(request("POST", "/api/auth/login", { json: { email: "eva.mala@vfn.cz", password: "wrong-password-1234" } }));

    expect(res.status).toBe(401);
  });

  test("pacient se heslem lékaře nepřihlásí, ani když má e-mail", async () => {
    await createPatient({ user: { email: "jan@example.cz" } });

    const res = await login(request("POST", "/api/auth/login", { json: { email: "jan@example.cz", password: "test-staff-password-1234" } }));

    expect(res.status).toBe(401);
  });
});

describe("ochrana přihlášení", () => {
  test("požadavek z cizí domény odmítne", async () => {
    const { patient } = await createPatient();

    const res = await patientLogin(patient.externalId!, "1960-03-01", { origin: "https://evil.example" });

    expect(res.status).toBe(403);
  });

  test("tělo, které není JSON, odmítne", async () => {
    const res = await login(request("POST", "/api/auth/login", { headers: { "content-type": "text/plain" } }));

    expect(res.status).toBe(415);
  });

  test("neúplné údaje vrátí 400", async () => {
    const res = await login(request("POST", "/api/auth/login", { json: { identifier: "VFN-2026-0142" } }));

    expect(res.status).toBe(400);
  });
});

describe("odolnost přihlášení", () => {
  test("nové přihlášení v tomtéž prohlížeči zruší předchozí session", async () => {
    const { patient } = await createPatient();
    const first = sessionCookieFrom(await patientLogin(patient.externalId!, "1960-03-01"));

    await login(request("POST", "/api/auth/login", { cookie: first, json: { identifier: patient.externalId, birthDate: "1960-03-01" } }));

    expect((await session(request("GET", "/api/auth/session", { cookie: first }))).status).toBe(401);
  });

  test("znak NUL ve vstupu vrátí 400, ne 500", async () => {
    const res = await patientLogin("VFN\u0000", "1960-03-01");

    expect(res.status).toBe(400);
  });

  test("odmítnutý pokus během zablokování se nepočítá, zablokování tak neprodlužuje", async () => {
    const { patient } = await createPatient();
    for (let i = 0; i < 5; i++) await patientLogin(patient.externalId!, "2000-01-01");
    const before = await testDb.select().from(loginAttempts);

    for (let i = 0; i < 3; i++) expect((await patientLogin(patient.externalId!, "2000-01-01")).status).toBe(429);

    expect(await testDb.select().from(loginAttempts)).toHaveLength(before.length);
  });

  test("prošlé pokusy se mažou u všech klíčů, tabulka neroste", async () => {
    await testDb.insert(loginAttempts).values({ key: "stary-klic", createdAt: new Date(Date.now() - 60 * 60 * 1000) });

    await patientLogin("VFN-0000-0000", "1960-03-01");

    expect((await testDb.select().from(loginAttempts)).map((r) => r.key)).not.toContain("stary-klic");
  });
});

describe("session", () => {
  test("vrátí přihlášeného uživatele", async () => {
    const { user, patient } = await createPatient();
    const cookie = sessionCookieFrom(await patientLogin(patient.externalId!, "1960-03-01"));

    const res = await session(request("GET", "/api/auth/session", { cookie }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: user.id, role: "patient", firstName: user.firstName, lastName: user.lastName, displayName: user.displayName });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("bez cookie vrátí 401", async () => {
    const res = await session(request("GET", "/api/auth/session"));

    expect(res.status).toBe(401);
  });

  test("po vypršení platnosti session neplatí", async () => {
    const { patient } = await createPatient();
    const cookie = sessionCookieFrom(await patientLogin(patient.externalId!, "1960-03-01"));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 13 * 60 * 60 * 1000);

    const res = await session(request("GET", "/api/auth/session", { cookie }));

    expect(res.status).toBe(401);
  });

  test("odhlášení smaže session na serveru, stará cookie už neplatí", async () => {
    const { patient } = await createPatient();
    const cookie = sessionCookieFrom(await patientLogin(patient.externalId!, "1960-03-01"));

    const res = await logout(request("POST", "/api/auth/logout", { cookie }));

    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await session(request("GET", "/api/auth/session", { cookie }))).status).toBe(401);
  });
});
