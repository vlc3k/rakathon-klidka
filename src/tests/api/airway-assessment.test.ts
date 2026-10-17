import { describe, expect, test } from "vitest";
import { GET as getCase } from "@/app/api/v1/cases/[caseId]/route";
import { POST as assess } from "@/app/api/v1/cases/[caseId]/airway-assessment/route";
import { createCase, createDocument, createPatient, createStaff, loginCookie } from "../support/factories";
import { params, request } from "../support/http";

async function setup() {
  const staff = await createStaff({ displayName: "MUDr. Eva Malá" });
  const { user: patient } = await createPatient();
  const row = await createCase(patient.id, staff.id);
  // tři fotky dýchacích cest od pacienta, každá s polohou
  for (const view of ["profile", "extension", "front"] as const) {
    await createDocument(row.id, patient.id, { type: "airway_photo", mimeType: "image/jpeg", meta: { jawOpen: 0.7, mouthRatio: 0.3, luma: 120, view } });
  }
  return { staff, patient, row, staffCookie: await loginCookie(staff.id), patientCookie: await loginCookie(patient.id) };
}

const post = (caseId: string, cookie: string, json: unknown) =>
  assess(request("POST", `/api/v1/cases/${caseId}/airway-assessment`, { cookie, json }), params({ caseId }));
const detail = async (caseId: string, cookie: string) =>
  (await getCase(request("GET", `/api/v1/cases/${caseId}`, { cookie }), params({ caseId }))).json();

describe("hodnocení dýchacích cest", () => {
  test("detail vrací všechny tři fotky s polohou, ústa první", async () => {
    const { row, staffCookie } = await setup();
    const data = await detail(row.id, staffCookie);
    expect(data.airwayPhotos.map((p: { view: string }) => p.view)).toEqual(["front", "profile", "extension"]);
    expect(data.airwayAssessment).toBeNull();
  });

  test("lékař uloží Mallampati a nálezy, detail je vrátí i se jménem", async () => {
    const { row, staffCookie } = await setup();
    const res = await post(row.id, staffCookie, { mallampati: 3, findings: ["dentition"], note: "protéza" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ type: "airway_assessment", status: "verified" });

    const data = await detail(row.id, staffCookie);
    expect(data.airwayAssessment).toMatchObject({ mallampati: 3, findings: ["dentition"], note: "protéza", by: "MUDr. Eva Malá" });
  });

  test("platí poslední hodnocení", async () => {
    const { row, staffCookie } = await setup();
    await post(row.id, staffCookie, { mallampati: 2, findings: [] });
    await post(row.id, staffCookie, { mallampati: null, findings: [] });
    expect((await detail(row.id, staffCookie)).airwayAssessment.mallampati).toBeNull();
  });

  test("pacient hodnotit nesmí", async () => {
    const { row, patientCookie } = await setup();
    expect((await post(row.id, patientCookie, { mallampati: 1, findings: [] })).status).toBe(403);
  });

  test("neplatná třída neprojde", async () => {
    const { row, staffCookie } = await setup();
    expect((await post(row.id, staffCookie, { mallampati: 7, findings: [] })).status).toBe(400);
  });
});
