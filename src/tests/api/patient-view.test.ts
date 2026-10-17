import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import * as s from "@/db/schema";
import { GET as getCase } from "@/app/api/v1/cases/[caseId]/route";
import { GET as listTasks } from "@/app/api/v1/cases/[caseId]/tasks/route";
import { GET as queue } from "@/app/api/v1/queue/route";
import { GET as patientCase } from "@/app/api/v1/users/[userId]/cases/[caseId]/route";
import { testDb } from "../support/db";
import { createCase, createDocument, createInformation, createPatient, createStaff, createTask, loginCookie } from "../support/factories";
import { params, request } from "../support/http";

async function setup() {
  const staff = await createStaff();
  const { user: patient } = await createPatient();
  const row = await createCase(patient.id, staff.id);
  return { staff, patient, row, staffCookie: await loginCookie(staff.id), patientCookie: await loginCookie(patient.id) };
}

const view = (userId: string, caseId: string, cookie: string) => patientCase(request("GET", `/api/v1/users/${userId}/cases/${caseId}`, { cookie }), params({ userId, caseId }));

describe("přečtené úkoly", () => {
  test("když si pacient otevře přehled zákroku, jeho neuzavřené úkoly jsou přečtené", async () => {
    const { patient, row, patientCookie } = await setup();
    const open = await createTask(row.id, { title: "Krevní testy" });
    const done = await createTask(row.id, { title: "Fotka", status: "done" });
    const staffTask = await createTask(row.id, { assignee: "aa", kind: "action", title: "PBM posouzení", documentType: null, informationType: null });

    await view(patient.id, row.id, patientCookie);

    const tasks = await (await listTasks(request("GET", `/api/v1/cases/${row.id}/tasks`, { cookie: patientCookie }), params({ caseId: row.id }))).json();
    expect(tasks.find((t: { id: string }) => t.id === open.id).readAt).toEqual(expect.any(String));
    expect(tasks.find((t: { id: string }) => t.id === done.id).readAt).toBeNull();
    const [aa] = await testDb.select().from(s.tasks).where(eq(s.tasks.id, staffTask.id));
    expect(aa.readAt).toBeNull();
  });

  test("zapíše se jen poprvé a jen když přehled otevře sám pacient", async () => {
    const { patient, row, staffCookie, patientCookie } = await setup();
    const task = await createTask(row.id);

    await view(patient.id, row.id, staffCookie);
    const [afterStaff] = await testDb.select().from(s.tasks).where(eq(s.tasks.id, task.id));
    await view(patient.id, row.id, patientCookie);
    await view(patient.id, row.id, patientCookie);

    expect(afterStaff.readAt).toBeNull();
    const events = await testDb.select().from(s.events).where(eq(s.events.caseId, row.id));
    expect(events).toEqual([expect.objectContaining({ type: "task.read", actorId: patient.id, data: { taskIds: [task.id] } })]);
  });

  test("zobrazení úkolů nerozsvítí ve frontě „Nové“", async () => {
    const { patient, row, staffCookie, patientCookie } = await setup();
    await createTask(row.id);

    await view(patient.id, row.id, patientCookie);

    const { rows } = await (await queue(request("GET", "/api/v1/queue", { cookie: staffCookie }))).json();
    expect(rows.find((r: { caseId: string }) => r.caseId === row.id).isNew).toBe(false);
  });
});

describe("kdo co nahrál", () => {
  test("pacient vidí u dokumentů a hlasovek, kdo je poslal, a jména v people", async () => {
    const { staff, patient, row, patientCookie } = await setup();
    const own = await createDocument(row.id, patient.id);
    const fromStaff = await createDocument(row.id, staff.id);
    const voice = await createDocument(row.id, patient.id, { type: "voice_message", mimeType: "audio/webm", meta: { seconds: 12 } });

    const body = await (await view(patient.id, row.id, patientCookie)).json();

    // pořadí podle uploadedAt; dokumenty vložené ve stejné milisekundě ho nemají jisté
    expect(Object.fromEntries(body.documents.map((d: { id: string; uploadedBy: string }) => [d.id, d.uploadedBy]))).toEqual({
      [own.id]: patient.id,
      [fromStaff.id]: staff.id,
    });
    expect(body.voiceMessages).toEqual([expect.objectContaining({ documentId: voice.id, uploadedBy: patient.id })]);
    expect(body.people).toEqual({
      [patient.id]: { displayName: patient.displayName, role: "patient" },
      [staff.id]: { displayName: staff.displayName, role: "aa" },
    });
  });

  test("pacient se dozví, proč AI dokument nepřečetla, bez hodnot", async () => {
    const { patient, row, patientCookie } = await setup();
    const blurry = await createDocument(row.id, patient.id, { transcript: { legibility: "poor", lines: [] } });
    const cut = await createDocument(row.id, patient.id, { issues: [{ code: "partial_page", detail: "Chybí spodní část." }] });
    const fine = await createDocument(row.id, patient.id, { transcript: { legibility: "good", lines: [] } });

    const body = await (await view(patient.id, row.id, patientCookie)).json();

    const reason = (id: string) => body.documents.find((d: { id: string }) => d.id === id).statusReason;
    expect([reason(blurry.id), reason(cut.id), reason(fine.id)]).toEqual(["illegible", "partial_page", null]);
  });

  test("detail pro AA má jména všech lidí: kdo nahrál, potvrdil i schválil úkol", async () => {
    const staffB = await createStaff();
    const { staff, patient, row, staffCookie } = await setup();
    const doc = await createDocument(row.id, patient.id);
    await createInformation(row.id, { type: "hemoglobin", value: { value: 135, unit: "g/l" }, documentId: doc.id, status: "verified", verifiedBy: staffB.id });
    const approver = await createStaff();
    await createTask(row.id, { kind: "action", title: "Odběr krve", documentType: null, informationType: null, approvedBy: approver.id, approvedAt: new Date(), createdBy: approver.id });

    const body = await (await getCase(request("GET", `/api/v1/cases/${row.id}`, { cookie: staffCookie }), params({ caseId: row.id }))).json();

    expect(Object.keys(body.people).sort()).toEqual([staff.id, staffB.id, patient.id, approver.id].sort());
    expect(body.people[staffB.id]).toEqual({ displayName: staffB.displayName, role: "aa" });
  });
});
