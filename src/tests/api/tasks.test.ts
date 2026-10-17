import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import * as s from "@/db/schema";
import { GET as getTask, PATCH as patchTask } from "@/app/api/v1/cases/[caseId]/tasks/[taskId]/route";
import { GET as listTasks, POST as createTaskRoute } from "@/app/api/v1/cases/[caseId]/tasks/route";
import { testDb } from "../support/db";
import { createCase, createPatient, createStaff, createTask, loginCookie } from "../support/factories";
import { params, request } from "../support/http";

async function setup() {
  const staff = await createStaff();
  const { user: patient } = await createPatient();
  const row = await createCase(patient.id, staff.id);
  return { staff, patient, row, staffCookie: await loginCookie(staff.id), patientCookie: await loginCookie(patient.id) };
}

describe("vytvoření úkolu", () => {
  test("odběr krve pro pacienta schválí ten, kdo ho zadal", async () => {
    const { staff, row, staffCookie } = await setup();

    const res = await createTaskRoute(
      request("POST", `/api/v1/cases/${row.id}/tasks`, {
        cookie: staffCookie,
        json: { assignee: "patient", kind: "action", title: "Odběr krve u praktika", payload: { tests: ["hemoglobin", "ferritin"] }, process: "pbm" },
      }),
      params({ caseId: row.id }),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ status: "open", approvedBy: staff.id, payload: { tests: ["hemoglobin", "ferritin"] }, process: "pbm" });
  });

  test("vyžádané výsledky krve kvůli Hb (PBM) schválí ten, kdo je zadal", async () => {
    const { staff, row, staffCookie } = await setup();

    const res = await createTaskRoute(
      request("POST", `/api/v1/cases/${row.id}/tasks`, {
        cookie: staffCookie,
        json: { assignee: "patient", kind: "upload", title: "Laboratorní výsledky", documentType: "lab_report", informationType: "hemoglobin", payload: { tests: ["krevní obraz"] }, process: "pbm" },
      }),
      params({ caseId: row.id }),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ status: "open", approvedBy: staff.id, process: "pbm" });
  });

  test("úkol nahrát dokument bez typu dokumentu ani informace odmítne", async () => {
    const { row, staffCookie } = await setup();

    const res = await createTaskRoute(request("POST", `/api/v1/cases/${row.id}/tasks`, { cookie: staffCookie, json: { assignee: "patient", kind: "upload", title: "Něco" } }), params({ caseId: row.id }));

    expect(res.status).toBe(400);
  });

  test("neznámý typ informace odmítne", async () => {
    const { row, staffCookie } = await setup();

    const res = await createTaskRoute(
      request("POST", `/api/v1/cases/${row.id}/tasks`, { cookie: staffCookie, json: { assignee: "patient", kind: "question", title: "Krevní skupina", informationType: "blood_type" } }),
      params({ caseId: row.id }),
    );

    expect(res.status).toBe(400);
  });

  test("pacient úkoly vytvářet nesmí", async () => {
    const { row, patientCookie } = await setup();

    const res = await createTaskRoute(
      request("POST", `/api/v1/cases/${row.id}/tasks`, { cookie: patientCookie, json: { assignee: "patient", kind: "question", title: "Váha", informationType: "weight" } }),
      params({ caseId: row.id }),
    );

    expect(res.status).toBe(403);
  });
});

describe("seznam úkolů", () => {
  test("pacient vidí jen své úkoly a bez interních podkladů", async () => {
    const { row, patientCookie } = await setup();
    await createTask(row.id, { title: "Krevní testy" });
    await createTask(row.id, { assignee: "aa", kind: "action", title: "PBM posouzení", evidence: { hb: 98 } });

    const res = await listTasks(request("GET", `/api/v1/cases/${row.id}/tasks`, { cookie: patientCookie }), params({ caseId: row.id }));

    const tasks = await res.json();
    expect(tasks.map((t: { title: string }) => t.title)).toEqual(["Krevní testy"]);
    expect(tasks[0]).not.toHaveProperty("evidence");
  });

  test("lékař vidí všechny a může filtrovat podle stavu", async () => {
    const { row, staffCookie } = await setup();
    await createTask(row.id, { title: "Otevřený" });
    await createTask(row.id, { title: "Hotový", status: "done" });

    const res = await listTasks(request("GET", `/api/v1/cases/${row.id}/tasks?status=done`, { cookie: staffCookie }), params({ caseId: row.id }));

    expect((await res.json()).map((t: { title: string }) => t.title)).toEqual(["Hotový"]);
  });

  test("úkoly cizího pacienta nevydá", async () => {
    const { row } = await setup();
    const { user: other } = await createPatient();
    const cookie = await loginCookie(other.id);

    const res = await listTasks(request("GET", `/api/v1/cases/${row.id}/tasks`, { cookie }), params({ caseId: row.id }));

    expect(res.status).toBe(404);
  });
});

describe("změna stavu úkolu", () => {
  test("zrušení bez důvodu odmítne, s důvodem projde", async () => {
    const { row, staffCookie } = await setup();
    const task = await createTask(row.id);
    const patch = (json: unknown) => patchTask(request("PATCH", `/api/v1/cases/${row.id}/tasks/${task.id}`, { cookie: staffCookie, json }), params({ caseId: row.id, taskId: task.id }));

    expect((await patch({ status: "cancelled" })).status).toBe(400);
    const res = await patch({ status: "cancelled", statusNote: "Není potřeba, výsledek máme z nemocnice." });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "cancelled", statusNote: "Není potřeba, výsledek máme z nemocnice." });
  });

  test("odložení potřebuje datum", async () => {
    const { row, staffCookie } = await setup();
    const task = await createTask(row.id);

    const res = await patchTask(
      request("PATCH", `/api/v1/cases/${row.id}/tasks/${task.id}`, { cookie: staffCookie, json: { status: "snoozed", statusNote: "Pacient je v nemocnici." } }),
      params({ caseId: row.id, taskId: task.id }),
    );

    expect(res.status).toBe(400);
  });

  test("hotovo zapíše, kdo a kdy úkol uzavřel", async () => {
    const { staff, row, staffCookie } = await setup();
    const task = await createTask(row.id);

    const res = await patchTask(request("PATCH", `/api/v1/cases/${row.id}/tasks/${task.id}`, { cookie: staffCookie, json: { status: "done" } }), params({ caseId: row.id, taskId: task.id }));

    expect(await res.json()).toMatchObject({ status: "done", completedBy: staff.id, completedAt: expect.any(String) });
  });

  test("hotový úkol nejde odložit, jen znovu otevřít", async () => {
    const { row, staffCookie } = await setup();
    const task = await createTask(row.id, { status: "done" });
    const patch = (json: unknown) => patchTask(request("PATCH", `/api/v1/cases/${row.id}/tasks/${task.id}`, { cookie: staffCookie, json }), params({ caseId: row.id, taskId: task.id }));

    expect((await patch({ status: "snoozed", statusNote: "Později.", snoozedUntil: "2026-11-01T08:00:00Z" })).status).toBe(409);
    expect((await patch({ status: "open" })).status).toBe(200);
  });

  test("úkol z jiného zákroku přes cizí cestu nevydá", async () => {
    const { staff, patient, row, staffCookie } = await setup();
    const otherCase = await createCase(patient.id, staff.id);
    const task = await createTask(otherCase.id);

    const res = await getTask(request("GET", `/api/v1/cases/${row.id}/tasks/${task.id}`, { cookie: staffCookie }), params({ caseId: row.id, taskId: task.id }));

    expect(res.status).toBe(404);
  });
});

describe("pacient plní své úkoly", () => {
  const patch = (caseId: string, taskId: string, cookie: string, json: unknown) =>
    patchTask(request("PATCH", `/api/v1/cases/${caseId}/tasks/${taskId}`, { cookie, json }), params({ caseId, taskId }));
  const question = (caseId: string, informationType: string) => createTask(caseId, { kind: "question", title: "Otázka", documentType: null, informationType });
  const answersOf = (taskId: string) => testDb.select().from(s.information).where(eq(s.information.taskId, taskId));

  test("odpověď na otázku uloží informaci, kterou zadal pacient, a úkol je hotový", async () => {
    const { patient, row, patientCookie } = await setup();
    const task = await question(row.id, "weight");

    const res = await patch(row.id, task.id, patientCookie, { status: "done", answer: { value: 82, unit: "kg" } });

    expect(res.status).toBe(200);
    const body = await res.json();
    const [info] = await answersOf(task.id);
    expect(body).toMatchObject({ status: "done", completedBy: patient.id, informationId: info.id });
    expect(info).toMatchObject({ type: "weight", value: { value: 82, unit: "kg" }, status: "verified", enteredBy: patient.id, verifiedBy: patient.id, documentId: null });
  });

  test("nová odpověď nahradí předchozí", async () => {
    const { row, patientCookie } = await setup();
    const task = await question(row.id, "height");
    await patch(row.id, task.id, patientCookie, { status: "done", answer: { value: 187, unit: "cm" } });

    const res = await patch(row.id, task.id, patientCookie, { status: "done", answer: { value: 178, unit: "cm" } });

    expect(res.status).toBe(200);
    const answers = await answersOf(task.id);
    const old = answers.find((a) => a.status === "rejected")!;
    const current = answers.find((a) => a.status === "verified")!;
    expect(old.value).toEqual({ value: 187, unit: "cm" });
    expect(current).toMatchObject({ value: { value: 178, unit: "cm" }, replacesId: old.id });
    expect((await res.json()).informationId).toBe(current.id);
  });

  test("u seznamu (alergie) jde odpovědět víc položkami najednou", async () => {
    const { row, patientCookie } = await setup();
    const task = await question(row.id, "allergy");

    const res = await patch(row.id, task.id, patientCookie, { status: "done", answer: [{ substance: "Penicilin", reaction: "vyrážka" }, { substance: "Ořechy" }] });

    expect(res.status).toBe(200);
    expect((await answersOf(task.id)).map((a) => a.value)).toEqual([{ substance: "Penicilin", reaction: "vyrážka" }, { substance: "Ořechy" }]);
  });

  test("odpověď ve špatném tvaru odmítne s cestou k poli, bez odpovědi taky", async () => {
    const { row, patientCookie } = await setup();
    const task = await question(row.id, "weight");

    const bad = await patch(row.id, task.id, patientCookie, { status: "done", answer: { value: 900, unit: "kg" } });
    const missing = await patch(row.id, task.id, patientCookie, { status: "done" });

    expect(bad.status).toBe(400);
    expect((await bad.json()).issues).toEqual([expect.objectContaining({ path: "answer.value" })]);
    expect(missing.status).toBe(400);
    expect((await missing.json()).issues).toEqual([expect.objectContaining({ path: "answer" })]);
  });

  test("akci (odběr) pacient nahlásí, potvrdí ji AA; opakované nahlášení nic nezmění", async () => {
    const { staff, row, patientCookie, staffCookie } = await setup();
    const task = await createTask(row.id, { kind: "action", title: "Odběr krve", documentType: null, informationType: null, process: "pbm", approvedBy: staff.id, approvedAt: new Date() });

    const first = await patch(row.id, task.id, patientCookie, { status: "done" });
    const again = await patch(row.id, task.id, patientCookie, { status: "done" });
    const confirmed = await patch(row.id, task.id, staffCookie, { status: "done" });

    expect(await first.json()).toMatchObject({ status: "submitted", completedBy: null });
    expect(await again.json()).toMatchObject({ status: "submitted" });
    expect(await confirmed.json()).toMatchObject({ status: "done", completedBy: staff.id });
  });

  test("pacient úkol neodloží ani nezruší, upload nesplní přes PATCH a úkol AA neuvidí", async () => {
    const { row, patientCookie } = await setup();
    const upload = await createTask(row.id);
    const staffTask = await createTask(row.id, { assignee: "aa", kind: "action", title: "PBM posouzení", documentType: null, informationType: null });

    expect((await patch(row.id, upload.id, patientCookie, { status: "cancelled", statusNote: "Nechci." })).status).toBe(403);
    expect((await patch(row.id, upload.id, patientCookie, { status: "done" })).status).toBe(409);
    expect((await patch(row.id, staffTask.id, patientCookie, { status: "done" })).status).toBe(404);
  });

  test("ve skončeném zákroku pacient úkoly neplní", async () => {
    const { staff, patient, patientCookie } = await setup();
    const closed = await createCase(patient.id, staff.id, { status: "closed" });
    const task = await question(closed.id, "weight");

    const res = await patch(closed.id, task.id, patientCookie, { status: "done", answer: { value: 82, unit: "kg" } });

    expect(res.status).toBe(409);
  });

  test("AA může odpovědět za pacienta (třeba po telefonu), odpověď jen s hotovým úkolem", async () => {
    const { staff, row, staffCookie } = await setup();
    const task = await question(row.id, "known_anemia");

    const early = await patch(row.id, task.id, staffCookie, { status: "open", answer: { value: true } });
    const res = await patch(row.id, task.id, staffCookie, { status: "done", answer: { value: true } });

    expect(early.status).toBe(400);
    expect(res.status).toBe(200);
    expect(await answersOf(task.id)).toEqual([expect.objectContaining({ enteredBy: staff.id, value: { value: true } })]);
  });

  test("znovu otevřený úkol je pro pacienta zase nepřečtený", async () => {
    const { row, staffCookie } = await setup();
    const task = await createTask(row.id, { status: "done", readAt: new Date() });

    const res = await patch(row.id, task.id, staffCookie, { status: "open" });

    expect(await res.json()).toMatchObject({ status: "open", readAt: null });
  });
});
