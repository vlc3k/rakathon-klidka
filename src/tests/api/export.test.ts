import { describe, expect, test } from "vitest";
import { GET as getCase, PATCH as patchCase } from "@/app/api/v1/cases/[caseId]/route";
import { DELETE as reopenCase, POST as closeCase } from "@/app/api/v1/cases/[caseId]/close/route";
import { POST as verify } from "@/app/api/v1/cases/[caseId]/information/verify/route";
import { POST as createTask } from "@/app/api/v1/cases/[caseId]/tasks/route";
import { createCase, createDocument, createInformation, createPatient, createStaff, loginCookie } from "../support/factories";
import { params, request } from "../support/http";

describe("export: uzavření zákroku", () => {
  test("AA uzavře zákrok, detail ukáže kdo a kdy, a pak už nejde nic upravit", async () => {
    const staff = await createStaff();
    const cookie = await loginCookie(staff.id);
    const { user } = await createPatient();
    const row = await createCase(user.id, staff.id);
    const doc = await createDocument(row.id, user.id);
    const info = await createInformation(row.id, { type: "hemoglobin", value: { value: 132, unit: "g/l" }, documentId: doc.id });
    const ctx = params({ caseId: row.id });

    const closed = await closeCase(request("POST", `/api/v1/cases/${row.id}/close`, { cookie }), ctx);
    expect(await closed.json()).toMatchObject({ id: row.id, status: "closed" });

    const detail = await (await getCase(request("GET", `/api/v1/cases/${row.id}`, { cookie }), ctx)).json();
    expect(detail.closed).toMatchObject({ by: staff.id });
    expect(detail.people[staff.id]).toMatchObject({ displayName: staff.displayName });

    const patch = await patchCase(request("PATCH", `/api/v1/cases/${row.id}`, { cookie, json: { procedureName: "Jiný výkon" } }), ctx);
    const verified = await verify(request("POST", `/api/v1/cases/${row.id}/information/verify`, { cookie, json: { ids: [info.id] } }), ctx);
    const task = await createTask(request("POST", `/api/v1/cases/${row.id}/tasks`, { cookie, json: { assignee: "aa", kind: "action", title: "Zavolat" } }), ctx);
    expect([patch.status, verified.status, task.status]).toEqual([409, 409, 409]);
    expect((await closeCase(request("POST", `/api/v1/cases/${row.id}/close`, { cookie }), ctx)).status).toBe(409);
  });

  test("znovu otevřený zákrok jde zase upravovat", async () => {
    const staff = await createStaff();
    const cookie = await loginCookie(staff.id);
    const { user } = await createPatient();
    const row = await createCase(user.id, staff.id, { status: "closed" });
    const ctx = params({ caseId: row.id });

    const reopened = await reopenCase(request("DELETE", `/api/v1/cases/${row.id}/close`, { cookie }), ctx);
    expect(await reopened.json()).toMatchObject({ status: "active" });
    const patch = await patchCase(request("PATCH", `/api/v1/cases/${row.id}`, { cookie, json: { procedureName: "Jiný výkon" } }), ctx);
    expect(patch.status).toBe(200);
  });

  test("uzavřít jde jen exportem, ne přes PATCH, a pacient uzavřít nemůže", async () => {
    const staff = await createStaff();
    const { user } = await createPatient();
    const row = await createCase(user.id, staff.id);
    const ctx = params({ caseId: row.id });

    const patch = await patchCase(request("PATCH", `/api/v1/cases/${row.id}`, { cookie: await loginCookie(staff.id), json: { status: "closed" } }), ctx);
    const byPatient = await closeCase(request("POST", `/api/v1/cases/${row.id}/close`, { cookie: await loginCookie(user.id) }), ctx);
    expect(patch.status).toBe(400);
    expect(byPatient.status).toBe(403);
  });
});
