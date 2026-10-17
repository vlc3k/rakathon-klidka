import { describe, expect, test } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { users } from "@/db/schema";
import { seedAdmin } from "@/db/seed";
import { createPatient } from "@/tests/support/factories";
import { testDb } from "@/tests/support/db";
import { request } from "@/tests/support/http";

process.env.STAFF_PASSWORD = "admin";

describe("seed produkčních dat", () => {
  test("založí admina z AA, který se přihlásí společným heslem", async () => {
    const { created } = await seedAdmin(testDb, "admin@admin.com");

    const res = await login(request("POST", "/api/auth/login", { json: { email: "admin@admin.com", password: "admin" } }));

    expect(created).toBe(true);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: "aa" });
  });

  test("opakované spuštění nic nezdvojí, ani s jinou velikostí písmen", async () => {
    const first = await seedAdmin(testDb, "admin@admin.com");

    const second = await seedAdmin(testDb, " Admin@Admin.com ");

    expect(second).toEqual({ id: first.id, created: false });
    expect(await testDb.select().from(users)).toHaveLength(1);
  });

  test("e-mail patřící pacientovi neprohlásí za admina", async () => {
    await createPatient({ user: { email: "admin@admin.com" } });

    await expect(seedAdmin(testDb, "admin@admin.com")).rejects.toThrow(/není z AA/);
  });
});
