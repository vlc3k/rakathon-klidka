import { describe, expect, test } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { createStaff } from "../support/factories";
import { request } from "../support/http";

// Délka společného hesla AA se nehlídá.
process.env.STAFF_PASSWORD = "admin";

describe("společné heslo AA", () => {
  test("krátké heslo stačí", async () => {
    await createStaff({ email: "eva.mala@vfn.cz" });

    const res = await login(request("POST", "/api/auth/login", { json: { email: "eva.mala@vfn.cz", password: "admin" } }));

    expect(res.status).toBe(200);
  });
});
