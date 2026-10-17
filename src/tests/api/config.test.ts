import { describe, expect, test } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { createPatient, createStaff } from "../support/factories";
import { request } from "../support/http";

// Bez společného hesla pro AA se nepřihlásí žádný lékař, zbytek aplikace jede dál.
delete process.env.STAFF_PASSWORD;
// Bez nastavení je limit pokusů o přihlášení zatím hodně vysoko (prakticky vypnutý).
delete process.env.LOGIN_MAX_ATTEMPTS;

describe("výchozí limit přihlášení", () => {
  test("po pár chybných pokusech se účet nezablokuje", async () => {
    const { patient } = await createPatient();
    for (let i = 0; i < 6; i++) {
      await login(request("POST", "/api/auth/login", { json: { identifier: patient.externalId, birthDate: "2000-01-01" } }));
    }

    const res = await login(request("POST", "/api/auth/login", { json: { identifier: patient.externalId, birthDate: "1960-03-01" } }));

    expect(res.status).toBe(200);
  });
});

describe("chybějící STAFF_PASSWORD", () => {
  test("pacient se přihlásí dál", async () => {
    const { patient } = await createPatient();

    const res = await login(request("POST", "/api/auth/login", { json: { identifier: patient.externalId, birthDate: "1960-03-01" } }));

    expect(res.status).toBe(200);
  });

  test("lékař se nepřihlásí žádným heslem", async () => {
    await createStaff({ email: "eva.mala@vfn.cz" });

    const res = await login(request("POST", "/api/auth/login", { json: { email: "eva.mala@vfn.cz", password: "admin" } }));

    expect(res.status).toBe(401);
  });
});
