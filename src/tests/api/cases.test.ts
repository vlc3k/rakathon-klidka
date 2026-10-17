import { describe, expect, test, vi } from "vitest";
import * as s from "@/db/schema";
import { GET as getCase, PATCH as patchCase } from "@/app/api/v1/cases/[caseId]/route";
import { POST as markSeen } from "@/app/api/v1/cases/[caseId]/mark-seen/route";
import { GET as listTasks } from "@/app/api/v1/cases/[caseId]/tasks/route";
import { GET as listCases, POST as createCaseRoute } from "@/app/api/v1/cases/route";
import { GET as patientCase } from "@/app/api/v1/users/[userId]/cases/[caseId]/route";
import { GET as userCases } from "@/app/api/v1/users/[userId]/cases/route";
import { createCase, createDocument, createInformation, createPatient, createStaff, loginCookie } from "../support/factories";
import { testDb } from "../support/db";
import { params, request } from "../support/http";

async function templateWithTasks(createdBy: string) {
  const [template] = await testDb.insert(s.templates).values({ name: "Resekce tlustého střeva", bloodLossMl: 800, createdBy }).returning();
  await testDb.insert(s.templateTasks).values([
    { templateId: template.id, sortOrder: 1, assignee: "patient", kind: "upload", title: "Krevní testy", documentType: "lab_report", informationType: "hemoglobin", validForDays: 14, dueDaysBeforeSurgery: 14 },
    { templateId: template.id, sortOrder: 2, assignee: "patient", kind: "upload", title: "EKG", documentType: "ecg", appliesFromAge: 65 },
    { templateId: template.id, sortOrder: 3, assignee: "patient", kind: "action", title: "Dojděte na odběr" },
  ]);
  return template;
}

describe("založení zákroku", () => {
  test("ze šablony předvyplní výkon a krevní ztrátu a zkopíruje úkoly s termínem", async () => {
    const staff = await createStaff();
    const cookie = await loginCookie(staff.id);
    const { user } = await createPatient({ patient: { birthDate: "1960-03-01" } });
    const template = await templateWithTasks(staff.id);

    const res = await createCaseRoute(
      request("POST", "/api/v1/cases", { cookie, json: { patientId: user.id, templateId: template.id, diagnosis: { text: "Karcinom rekta", icd10: "C20" }, surgeryDate: "2026-11-13" } }),
    );

    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created).toMatchObject({
      status: "active",
      procedureName: "Resekce tlustého střeva",
      bloodLossMl: 800,
      diagnosis: { text: "Karcinom rekta", icd10: "C20" },
      contact: { id: staff.id, displayName: staff.displayName },
    });
    const tasks = await (await listTasks(request("GET", `/api/v1/cases/${created.id}/tasks`, { cookie }), params({ caseId: created.id }))).json();
    expect(tasks.map((t: { title: string }) => t.title)).toEqual(["Krevní testy", "EKG", "Dojděte na odběr"]);
    expect(tasks[0]).toMatchObject({ status: "open", dueDate: "2026-10-30", validForDays: 14 });
  });

  test("úkol s věkovou hranicí u mladšího pacienta vynechá", async () => {
    const staff = await createStaff();
    const cookie = await loginCookie(staff.id);
    const { user } = await createPatient({ patient: { birthDate: "1990-05-05" } });
    const template = await templateWithTasks(staff.id);

    const res = await createCaseRoute(request("POST", "/api/v1/cases", { cookie, json: { patientId: user.id, templateId: template.id, diagnosis: { text: "Karcinom rekta" }, surgeryDate: "2026-11-13" } }));
    const created = await res.json();

    const tasks = await (await listTasks(request("GET", `/api/v1/cases/${created.id}/tasks`, { cookie }), params({ caseId: created.id }))).json();
    expect(tasks.map((t: { title: string }) => t.title)).toEqual(["Krevní testy", "Dojděte na odběr"]);
  });

  test("bez šablony je název výkonu povinný", async () => {
    const staff = await createStaff();
    const cookie = await loginCookie(staff.id);
    const { user } = await createPatient();

    const res = await createCaseRoute(request("POST", "/api/v1/cases", { cookie, json: { patientId: user.id, diagnosis: { text: "Karcinom rekta" } } }));

    expect(res.status).toBe(400);
  });

  test("kontaktní osoba musí být z AA", async () => {
    const staff = await createStaff();
    const cookie = await loginCookie(staff.id);
    const { user } = await createPatient();

    const res = await createCaseRoute(
      request("POST", "/api/v1/cases", { cookie, json: { patientId: user.id, procedureName: "Hysterektomie", diagnosis: { text: "Myom" }, contactId: user.id } }),
    );

    expect(res.status).toBe(400);
  });
});

describe("seznam a úprava zákroků", () => {
  test("filtruje podle termínu a zrušené vrátí jen na požádání", async () => {
    const staff = await createStaff();
    const cookie = await loginCookie(staff.id);
    const { user } = await createPatient();
    await createCase(user.id, staff.id, { procedureName: "Brzy", surgeryDate: "2026-10-30" });
    await createCase(user.id, staff.id, { procedureName: "Později", surgeryDate: "2026-12-30" });
    await createCase(user.id, staff.id, { procedureName: "Zrušený", surgeryDate: "2026-11-01", status: "cancelled" });

    const inOctober = await (await listCases(request("GET", "/api/v1/cases?from=2026-10-01&to=2026-11-30", { cookie }))).json();
    const cancelled = await (await listCases(request("GET", "/api/v1/cases?status=cancelled", { cookie }))).json();

    expect(inOctober.map((c: { procedureName: string }) => c.procedureName)).toEqual(["Brzy"]);
    expect(cancelled.map((c: { procedureName: string }) => c.procedureName)).toEqual(["Zrušený"]);
  });

  test("změna termínu přepočítá termíny úkolů ze šablony", async () => {
    const staff = await createStaff();
    const cookie = await loginCookie(staff.id);
    const { user } = await createPatient();
    const template = await templateWithTasks(staff.id);
    const created = await (
      await createCaseRoute(request("POST", "/api/v1/cases", { cookie, json: { patientId: user.id, templateId: template.id, diagnosis: { text: "Karcinom rekta" }, surgeryDate: "2026-11-13" } }))
    ).json();

    const res = await patchCase(request("PATCH", `/api/v1/cases/${created.id}`, { cookie, json: { surgeryDate: "2026-11-20" } }), params({ caseId: created.id }));

    expect(res.status).toBe(200);
    const tasks = await (await listTasks(request("GET", `/api/v1/cases/${created.id}/tasks`, { cookie }), params({ caseId: created.id }))).json();
    expect(tasks[0].dueDate).toBe("2026-11-06");
  });

  test("změna diagnózy založí novou informaci a starou nahradí", async () => {
    const staff = await createStaff();
    const cookie = await loginCookie(staff.id);
    const { user } = await createPatient();
    const created = await (
      await createCaseRoute(request("POST", "/api/v1/cases", { cookie, json: { patientId: user.id, procedureName: "Hysterektomie", diagnosis: { text: "Myom" } } }))
    ).json();

    const res = await patchCase(request("PATCH", `/api/v1/cases/${created.id}`, { cookie, json: { diagnosis: { text: "Myomatóza dělohy", icd10: "D25" } } }), params({ caseId: created.id }));

    expect(await res.json()).toMatchObject({ diagnosis: { text: "Myomatóza dělohy", icd10: "D25" } });
    const detail = await (await getCase(request("GET", `/api/v1/cases/${created.id}`, { cookie }), params({ caseId: created.id }))).json();
    const diagnoses = detail.information.filter((i: { type: string }) => i.type === "diagnosis");
    expect(diagnoses.map((i: { status: string }) => i.status).sort()).toEqual(["rejected", "verified"]);
  });

  test("zrušení je změna stavu, zákrok zůstane", async () => {
    const staff = await createStaff();
    const cookie = await loginCookie(staff.id);
    const { user } = await createPatient();
    const row = await createCase(user.id, staff.id);

    const res = await patchCase(request("PATCH", `/api/v1/cases/${row.id}`, { cookie, json: { status: "cancelled" } }), params({ caseId: row.id }));

    expect(await res.json()).toMatchObject({ id: row.id, status: "cancelled" });
  });
});

describe("pacient a jeho zákroky", () => {
  test("pacient vidí seznam svých zákroků, cizí ne", async () => {
    const staff = await createStaff();
    const { user: me } = await createPatient();
    const { user: other } = await createPatient();
    await createCase(me.id, staff.id, { surgeryDate: "2026-11-13" });
    await createCase(other.id, staff.id);
    const cookie = await loginCookie(me.id);

    const mine = await userCases(request("GET", `/api/v1/users/${me.id}/cases`, { cookie }), params({ userId: me.id }));
    const theirs = await userCases(request("GET", `/api/v1/users/${other.id}/cases`, { cookie }), params({ userId: other.id }));

    expect(mine.status).toBe(200);
    expect(await mine.json()).toEqual([expect.objectContaining({ procedureName: "Resekce tlustého střeva", surgeryDate: "2026-11-13", status: "active" })]);
    expect(theirs.status).toBe(404);
  });

  test("přehled pro pacienta neobsahuje hodnoty, upozornění ani diagnózu", async () => {
    const staff = await createStaff();
    const { user } = await createPatient();
    const row = await createCase(user.id, staff.id);
    const doc = await createDocument(row.id, user.id);
    await createInformation(row.id, { type: "hemoglobin", value: { value: 98, unit: "g/l" }, documentId: doc.id, observedDate: "2026-10-10" });
    await createInformation(row.id, { type: "diagnosis", value: { text: "Karcinom rekta" }, status: "verified", enteredBy: staff.id, verifiedBy: staff.id });
    const cookie = await loginCookie(user.id);

    const res = await patientCase(request("GET", `/api/v1/users/${user.id}/cases/${row.id}`, { cookie }), params({ userId: user.id, caseId: row.id }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ procedureName: "Resekce tlustého střeva", contact: { displayName: staff.displayName, phone: staff.phone } });
    expect(body.documents).toEqual([expect.objectContaining({ id: doc.id, type: "lab_report" })]);
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/"value":\s*98/);
    expect(text).not.toContain("g/l");
    expect(text).not.toContain("Karcinom");
    expect(body).not.toHaveProperty("information");
    expect(body).not.toHaveProperty("alerts");
  });

  test("pacient slyší „v pořádku“ jen z hemoglobinu, který ověřila AA", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-17T08:00:00Z"));
    const staff = await createStaff();
    const { user } = await createPatient();
    const row = await createCase(user.id, staff.id);
    const doc = await createDocument(row.id, user.id, { issuedDate: "2026-10-10" });
    await createInformation(row.id, { type: "hemoglobin", value: { value: 135, unit: "g/l" }, documentId: doc.id, observedDate: "2026-10-10" });
    const cookie = await loginCookie(user.id);
    const view = async () => (await patientCase(request("GET", `/api/v1/users/${user.id}/cases/${row.id}`, { cookie }), params({ userId: user.id, caseId: row.id }))).json();

    expect(await view()).toMatchObject({ statusKey: "reviewing" });

    await testDb.update(s.information).set({ status: "verified", verifiedBy: staff.id, verifiedAt: new Date() });

    expect(await view()).toMatchObject({ statusKey: "ok" });
  });

  test("cizí zákrok přes vlastní userId nevydá", async () => {
    const staff = await createStaff();
    const { user: me } = await createPatient();
    const { user: other } = await createPatient();
    const theirs = await createCase(other.id, staff.id);
    const cookie = await loginCookie(me.id);

    const res = await patientCase(request("GET", `/api/v1/users/${me.id}/cases/${theirs.id}`, { cookie }), params({ userId: me.id, caseId: theirs.id }));

    expect(res.status).toBe(404);
  });

  test("lékařský detail zákroku pacient neotevře", async () => {
    const staff = await createStaff();
    const { user } = await createPatient();
    const row = await createCase(user.id, staff.id);
    const cookie = await loginCookie(user.id);

    const res = await getCase(request("GET", `/api/v1/cases/${row.id}`, { cookie }), params({ caseId: row.id }));

    expect(res.status).toBe(403);
  });
});

describe("detail zákroku pro lékaře", () => {
  test("ukáže stav hemoglobinu, informace s kontrolami a upozornění", async () => {
    const staff = await createStaff();
    const cookie = await loginCookie(staff.id);
    const { user } = await createPatient();
    const row = await createCase(user.id, staff.id, { surgeryDate: "2026-11-13", bloodLossMl: 800 });
    const doc = await createDocument(row.id, user.id, { issuedDate: "2026-10-10" });
    const hb = await createInformation(row.id, {
      type: "hemoglobin",
      value: { value: 98, unit: "g/l", refLow: 135, refHigh: 175, flag: "L" },
      documentId: doc.id,
      observedDate: "2026-10-10",
      bbox: { x: 0.1, y: 0.2, w: 0.05, h: 0.02 },
      confidence: 0.95,
    });

    const res = await getCase(request("GET", `/api/v1/cases/${row.id}`, { cookie }), params({ caseId: row.id }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hb).toMatchObject({ status: "alert", value: 98, informationId: hb.id });
    expect(body.pbm).toMatchObject({ status: "indicated" });
    expect(body.alerts).toEqual([expect.objectContaining({ key: `pbm.hb_low:${hb.id}`, informationIds: [hb.id] })]);
    expect(body.information).toEqual([expect.objectContaining({ id: hb.id, area: "labs", status: "ai_extracted", bbox: { x: 0.1, y: 0.2, w: 0.05, h: 0.02 }, checks: { status: "ok", reasons: [] } })]);
    expect(body.documents).toEqual([expect.objectContaining({ id: doc.id, patientMatch: "match" })]);
    expect(body.patient.birthNumber).toBeNull();
  });

  test("hemoglobin jen s datem zprávy je nejistý a ukáže se jako upozornění", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-17T08:00:00Z"));
    const staff = await createStaff();
    const cookie = await loginCookie(staff.id);
    const { user } = await createPatient();
    const row = await createCase(user.id, staff.id);
    const doc = await createDocument(row.id, user.id, { issuedDate: "2026-10-14" });
    const hb = await createInformation(row.id, {
      type: "hemoglobin",
      value: { value: 135, unit: "g/l" },
      documentId: doc.id,
      observedDate: "2026-10-14",
      isObservedDateEstimated: true,
      status: "verified",
      verifiedBy: staff.id,
    });

    const body = await (await getCase(request("GET", `/api/v1/cases/${row.id}`, { cookie }), params({ caseId: row.id }))).json();

    expect(body.hb).toMatchObject({ status: "uncertain", reason: "no_date", value: 135, informationId: hb.id });
    expect(body.alerts).toEqual([expect.objectContaining({ key: `hb.uncertain:${hb.id}`, informationIds: [hb.id] })]);
  });

  test("otevření v AA zhasne „nové“", async () => {
    const staff = await createStaff();
    const cookie = await loginCookie(staff.id);
    const { user } = await createPatient();
    const row = await createCase(user.id, staff.id);

    const res = await markSeen(request("POST", `/api/v1/cases/${row.id}/mark-seen`, { cookie }), params({ caseId: row.id }));

    expect(res.status).toBe(204);
    const detail = await (await getCase(request("GET", `/api/v1/cases/${row.id}`, { cookie }), params({ caseId: row.id }))).json();
    expect(detail.case.aaSeenAt).not.toBeNull();
  });
});
