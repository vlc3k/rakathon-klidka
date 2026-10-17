import { describe, expect, test } from "vitest";
import { GET as getCase } from "@/app/api/v1/cases/[caseId]/route";
import { GET as caseEvents } from "@/app/api/v1/cases/[caseId]/events/route";
import { POST as reject } from "@/app/api/v1/cases/[caseId]/information/[informationId]/reject/route";
import { POST as unverify } from "@/app/api/v1/cases/[caseId]/information/unverify/route";
import { POST as verify } from "@/app/api/v1/cases/[caseId]/information/verify/route";
import { createCase, createDocument, createInformation, createPatient, createStaff, loginCookie } from "../support/factories";
import { params, request } from "../support/http";

async function setup() {
  const staff = await createStaff();
  const { user: patient } = await createPatient();
  const row = await createCase(patient.id, staff.id);
  const doc = await createDocument(row.id, patient.id);
  const hb = await createInformation(row.id, { type: "hemoglobin", value: { value: 98, unit: "g/l" }, documentId: doc.id, observedDate: "2026-10-10", rawText: "HGB 9,8 g/dl" });
  const med = await createInformation(row.id, { type: "medication", value: { name: "Concor", strength: "5 mg" }, documentId: doc.id });
  return { staff, patient, row, doc, hb, med, staffCookie: await loginCookie(staff.id), patientCookie: await loginCookie(patient.id) };
}

const verifyIds = (caseId: string, cookie: string, ids: string[]) =>
  verify(request("POST", `/api/v1/cases/${caseId}/information/verify`, { cookie, json: { ids } }), params({ caseId }));
const unverifyIds = (caseId: string, cookie: string, ids: string[]) =>
  unverify(request("POST", `/api/v1/cases/${caseId}/information/unverify`, { cookie, json: { ids } }), params({ caseId }));
const rejectOne = (caseId: string, informationId: string, cookie: string, json: unknown) =>
  reject(request("POST", `/api/v1/cases/${caseId}/information/${informationId}/reject`, { cookie, json }), params({ caseId, informationId }));

describe("ověření nálezů AI", () => {
  test("lékař ověří víc hodnot naráz a zapíše se, kdo to byl", async () => {
    const { staff, row, hb, med, staffCookie } = await setup();

    const res = await verifyIds(row.id, staffCookie, [hb.id, med.id]);

    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r).toMatchObject({ status: "verified", verifiedBy: staff.id, verifiedAt: expect.any(String) });
  });

  test("ověření se zapíše do časové osy", async () => {
    const { staff, row, hb, staffCookie } = await setup();
    await verifyIds(row.id, staffCookie, [hb.id]);

    const res = await caseEvents(request("GET", `/api/v1/cases/${row.id}/events`, { cookie: staffCookie }), params({ caseId: row.id }));

    expect(await res.json()).toEqual([expect.objectContaining({ type: "information.verified", subjectId: hb.id, actor: { id: staff.id, displayName: staff.displayName, role: "aa" } })]);
  });

  test("odpověď ověření počítá kontroly čtení stejně jako detail zákroku", async () => {
    const { staff, patient, staffCookie } = await setup();
    const row = await createCase(patient.id, staff.id);
    const doc = await createDocument(row.id, patient.id, { issuedDate: "2026-10-01" });
    const late = await createInformation(row.id, { type: "hemoglobin", value: { value: 140, unit: "g/l" }, documentId: doc.id, observedDate: "2026-10-05" });

    const [verified] = await (await verifyIds(row.id, staffCookie, [late.id])).json();

    expect(verified.checks).toMatchObject({ status: "uncertain", reasons: [expect.stringMatching(/pozdější než zpráva/)] });
  });

  test("pacient hodnoty od AI ověřovat nesmí", async () => {
    const { row, hb, patientCookie } = await setup();

    const res = await verifyIds(row.id, patientCookie, [hb.id]);

    expect(res.status).toBe(403);
  });

  test("informace z jiného zákroku nepřijme", async () => {
    const { staff, patient, row, staffCookie } = await setup();
    const other = await createCase(patient.id, staff.id);
    const foreign = await createInformation(other.id, { type: "note", value: { text: "x" }, status: "verified", enteredBy: staff.id, verifiedBy: staff.id });

    const res = await verifyIds(row.id, staffCookie, [foreign.id]);

    expect(res.status).toBe(404);
  });
});

describe("zamítnutí a oprava", () => {
  test("oprava vznikne jako nová ověřená informace, původní je zamítnutá a hemoglobin se počítá z opravy", async () => {
    const { staff, row, doc, hb, staffCookie } = await setup();

    const res = await rejectOne(row.id, hb.id, staffCookie, { correction: { value: { value: 128, unit: "g/l" } } });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rejected).toMatchObject({ id: hb.id, status: "rejected", verifiedBy: staff.id });
    expect(body.correction).toMatchObject({ status: "verified", replacesId: hb.id, documentId: doc.id, value: { value: 128, unit: "g/l" }, observedDate: "2026-10-10" });
    const detail = await (await getCase(request("GET", `/api/v1/cases/${row.id}`, { cookie: staffCookie }), params({ caseId: row.id }))).json();
    expect(detail.hb).toMatchObject({ value: 128, informationId: body.correction.id });
  });

  test("oprava ve špatném tvaru neprojde", async () => {
    const { row, hb, staffCookie } = await setup();

    const res = await rejectOne(row.id, hb.id, staffCookie, { correction: { value: { value: "hodně" } } });

    expect(res.status).toBe(400);
    expect((await res.json()).issues[0].path).toMatch(/^correction\.value/);
  });

  test("bez opravy je potřeba aspoň důvod", async () => {
    const { row, hb, staffCookie } = await setup();

    expect((await rejectOne(row.id, hb.id, staffCookie, {})).status).toBe(400);
    expect((await rejectOne(row.id, hb.id, staffCookie, { note: "Na fotce je jiná hodnota, nečitelné." })).status).toBe(200);
  });

  test("zamítnutou informaci nejde ověřit", async () => {
    const { row, hb, staffCookie } = await setup();
    await rejectOne(row.id, hb.id, staffCookie, { note: "Nesedí." });

    const res = await verifyIds(row.id, staffCookie, [hb.id]);

    expect(res.status).toBe(409);
  });
});

describe("odvolání potvrzení", () => {
  test("potvrzené hodnoty se vrátí mezi nálezy AI a zmizí, kdo a kdy je potvrdil", async () => {
    const { row, hb, med, staffCookie } = await setup();
    await verifyIds(row.id, staffCookie, [hb.id, med.id]);

    const res = await unverifyIds(row.id, staffCookie, [hb.id, med.id]);

    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r).toMatchObject({ status: "ai_extracted", verifiedBy: null, verifiedAt: null });
  });

  test("v časové ose zůstane, kdo hodnotu potvrdil a kdo potvrzení odvolal", async () => {
    const { staff, row, hb, staffCookie } = await setup();
    await verifyIds(row.id, staffCookie, [hb.id]);
    await unverifyIds(row.id, staffCookie, [hb.id]);

    const timeline = await (await caseEvents(request("GET", `/api/v1/cases/${row.id}/events`, { cookie: staffCookie }), params({ caseId: row.id }))).json();

    expect(timeline[0]).toMatchObject({
      type: "information.unverified",
      subjectId: hb.id,
      actor: { id: staff.id, displayName: staff.displayName, role: "aa" },
      data: { verifiedBy: staff.id, verifiedAt: expect.any(String) },
    });
  });

  test("nepotvrzená hodnota projde beze změny a bez události", async () => {
    const { row, hb, staffCookie } = await setup();

    const [same] = await (await unverifyIds(row.id, staffCookie, [hb.id])).json();
    const events = await (await caseEvents(request("GET", `/api/v1/cases/${row.id}/events`, { cookie: staffCookie }), params({ caseId: row.id }))).json();

    expect(same).toMatchObject({ status: "ai_extracted" });
    expect(events).toEqual([]);
  });

  test("pacient potvrzení odvolat nesmí", async () => {
    const { row, hb, staffCookie, patientCookie } = await setup();
    await verifyIds(row.id, staffCookie, [hb.id]);

    expect((await unverifyIds(row.id, patientCookie, [hb.id])).status).toBe(403);
  });

  test("zamítnutou hodnotu ani hodnotu zadanou člověkem mezi nálezy AI vrátit nejde", async () => {
    const { staff, row, hb, med, staffCookie } = await setup();
    const { correction } = await (await rejectOne(row.id, hb.id, staffCookie, { correction: { value: { value: 89, unit: "g/l" } } })).json();
    await verifyIds(row.id, staffCookie, [med.id]);

    expect((await unverifyIds(row.id, staffCookie, [hb.id])).status).toBe(409);
    expect((await unverifyIds(row.id, staffCookie, [correction.id, med.id])).status).toBe(409);
    expect(correction.enteredBy).toBe(staff.id);
  });

  test("informace z jiného zákroku nepřijme", async () => {
    const { staff, patient, row, staffCookie } = await setup();
    const other = await createCase(patient.id, staff.id);
    const foreign = await createInformation(other.id, { type: "note", value: { text: "x" }, status: "verified", enteredBy: staff.id, verifiedBy: staff.id });

    expect((await unverifyIds(row.id, staffCookie, [foreign.id])).status).toBe(404);
  });
});
