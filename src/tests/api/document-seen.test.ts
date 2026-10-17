import { describe, expect, test } from "vitest";
import { GET as getCase } from "@/app/api/v1/cases/[caseId]/route";
import { GET as caseEvents } from "@/app/api/v1/cases/[caseId]/events/route";
import { POST as seen } from "@/app/api/v1/cases/[caseId]/documents/[documentId]/seen/route";
import { createCase, createDocument, createPatient, createStaff, loginCookie } from "../support/factories";
import { params, request } from "../support/http";

async function setup() {
  const staff = await createStaff();
  const { user: patient } = await createPatient();
  const row = await createCase(patient.id, staff.id);
  const doc = await createDocument(row.id, patient.id);
  return { staff, patient, row, doc, staffCookie: await loginCookie(staff.id), patientCookie: await loginCookie(patient.id) };
}

const markSeen = (caseId: string, documentId: string, cookie: string) =>
  seen(request("POST", `/api/v1/cases/${caseId}/documents/${documentId}/seen`, { cookie }), params({ caseId, documentId }));
const detailOf = async (caseId: string, cookie: string) => (await getCase(request("GET", `/api/v1/cases/${caseId}`, { cookie }), params({ caseId }))).json();
const eventsOf = async (caseId: string, cookie: string) => (await caseEvents(request("GET", `/api/v1/cases/${caseId}/events`, { cookie }), params({ caseId }))).json();

describe("dokument viděl zaměstnanec", () => {
  test("první otevření se zapíše i s tím, kdo to byl, a detail zákroku ho ukáže u dokumentu", async () => {
    const { staff, row, doc, staffCookie } = await setup();

    const res = await markSeen(row.id, doc.id, staffCookie);

    expect(res.status).toBe(204);
    const detail = await detailOf(row.id, staffCookie);
    expect(detail.documents.find((d: { id: string }) => d.id === doc.id)).toMatchObject({ seenAt: expect.any(String), seenBy: staff.id });
  });

  test("další otevření už nic nepřidá a čas prvního zůstane", async () => {
    const { row, doc, staffCookie } = await setup();
    const other = await createStaff({ email: "druhy@vfn.cz" });
    await markSeen(row.id, doc.id, staffCookie);
    const first = (await detailOf(row.id, staffCookie)).documents[0];

    await markSeen(row.id, doc.id, await loginCookie(other.id));

    const events = (await eventsOf(row.id, staffCookie)).filter((e: { type: string }) => e.type === "document.seen");
    expect(events).toHaveLength(1);
    expect((await detailOf(row.id, staffCookie)).documents[0]).toMatchObject({ seenAt: first.seenAt, seenBy: first.seenBy });
  });

  test("bez otevření je seenAt prázdné", async () => {
    const { row, staffCookie } = await setup();

    expect((await detailOf(row.id, staffCookie)).documents[0]).toMatchObject({ seenAt: null, seenBy: null });
  });

  test("pacient to zapsat nesmí", async () => {
    const { row, doc, patientCookie } = await setup();

    expect((await markSeen(row.id, doc.id, patientCookie)).status).toBe(403);
  });

  test("dokument z jiného zákroku nepřijme", async () => {
    const { staff, patient, row, staffCookie } = await setup();
    const other = await createCase(patient.id, staff.id);
    const foreign = await createDocument(other.id, patient.id);

    expect((await markSeen(row.id, foreign.id, staffCookie)).status).toBe(404);
  });
});
