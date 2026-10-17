import { eq } from "drizzle-orm";
import { describe, expect, test, vi } from "vitest";
import * as s from "@/db/schema";
import { POST as acceptInvite } from "@/app/api/auth/helper/route";
import { GET as session } from "@/app/api/auth/session/route";
import { GET as caseDetail } from "@/app/api/v1/cases/[caseId]/route";
import { POST as upload } from "@/app/api/v1/cases/[caseId]/documents/route";
import { DELETE as revoke } from "@/app/api/v1/helpers/[helperId]/route";
import { GET as listHelpers, POST as invite } from "@/app/api/v1/helpers/route";
import { GET as userCases } from "@/app/api/v1/users/[userId]/cases/route";
import { GET as patientCase } from "@/app/api/v1/users/[userId]/cases/[caseId]/route";
import { testDb } from "../support/db";
import { createCase, createPatient, createStaff, createTask, loginCookie } from "../support/factories";
import { params, request, sessionCookieFrom } from "../support/http";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
const BIRTH_DATE = "1960-03-01"; // výchozí v createPatient

function form(file: Uint8Array<ArrayBuffer>, fields: Record<string, string> = {}, mime = "image/jpeg", name = "zprava.jpg") {
  const data = new FormData();
  data.set("file", new File([file], name, { type: mime }));
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const INVITE = { displayName: "Petra", relation: "daughter", consent: true };

async function setup() {
  const staff = await createStaff();
  const { user: patient } = await createPatient({ user: { firstName: "Jan" } });
  const row = await createCase(patient.id, staff.id);
  return { staff, patient, row, cookie: await loginCookie(patient.id) };
}

const postInvite = (cookie: string, json: unknown = INVITE) => invite(request("POST", "/api/v1/helpers", { cookie, json }));
const accept = (token: string, birthDate = BIRTH_DATE) => acceptInvite(request("POST", "/api/auth/helper", { json: { token, birthDate } }));
const postUpload = (caseId: string, cookie: string, data: FormData) => upload(request("POST", `/api/v1/cases/${caseId}/documents`, { cookie, form: data }), params({ caseId }));

// Pacient pozve, pomocník přijme. Vrací cookie pomocníka a id pozvánky.
async function joinedHelper(patientCookie: string) {
  const created = await (await postInvite(patientCookie)).json();
  const res = await accept(created.token);
  expect(res.status).toBe(200);
  return { helperId: created.helper.id as string, token: created.token as string, cookie: sessionCookieFrom(res), session: await res.json() };
}

describe("pozvání pomocníka", () => {
  test("pacient pozve pomocníka; v databázi je jen hash tokenu a souhlas", async () => {
    const { patient, row, cookie } = await setup();

    const res = await postInvite(cookie);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.helper).toMatchObject({ displayName: "Petra", relation: "daughter", joinedAt: null });
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [stored] = await testDb.select().from(s.helpers).where(eq(s.helpers.id, body.helper.id));
    expect(stored).toMatchObject({ patientId: patient.id, userId: null, createdBy: patient.id });
    expect(stored.inviteTokenHash).not.toContain(body.token);
    expect(stored.consentAt).toBeInstanceOf(Date);
    const days = (stored.inviteExpiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
    const events = await testDb.select().from(s.events).where(eq(s.events.caseId, row.id));
    expect(events.map((e) => e.type)).toEqual(["helper.invited"]);
  });

  test("bez výslovného souhlasu pozvat nejde", async () => {
    const { cookie } = await setup();

    const res = await postInvite(cookie, { ...INVITE, consent: false });

    expect(res.status).toBe(400);
  });

  test("neznámý vztah odmítne", async () => {
    const { cookie } = await setup();

    const res = await postInvite(cookie, { ...INVITE, relation: "soused" });

    expect(res.status).toBe(400);
  });

  test("AA pomocníka za pacienta nepozve", async () => {
    const { staff } = await setup();

    const res = await postInvite(await loginCookie(staff.id));

    expect(res.status).toBe(403);
  });

  test("pomocník nemůže zvát další pomocníky ani je vypsat", async () => {
    const { cookie } = await setup();
    const helper = await joinedHelper(cookie);

    expect((await postInvite(helper.cookie, { ...INVITE, displayName: "Soused" })).status).toBe(403);
    expect((await listHelpers(request("GET", "/api/v1/helpers", { cookie: helper.cookie }))).status).toBe(403);
  });

  test("bez přihlášení 401", async () => {
    const res = await invite(request("POST", "/api/v1/helpers", { json: INVITE }));

    expect(res.status).toBe(401);
  });
});

describe("přijetí pozvánky", () => {
  test("se správným datem narození vznikne účet pomocníka a session za pacienta", async () => {
    const { patient, row, cookie } = await setup();

    const helper = await joinedHelper(cookie);

    expect(helper.session).toMatchObject({ role: "helper", displayName: "Petra", helping: { patientId: patient.id, patientName: patient.displayName } });
    const [stored] = await testDb.select().from(s.helpers).where(eq(s.helpers.id, helper.helperId));
    expect(stored.userId).toBe(helper.session.id);
    expect(stored.joinedAt).toBeInstanceOf(Date);
    const me = await (await session(request("GET", "/api/auth/session", { cookie: helper.cookie }))).json();
    expect(me.helping.patientId).toBe(patient.id);
    const events = await testDb.select().from(s.events).where(eq(s.events.caseId, row.id));
    expect(events.map((e) => e.type).sort()).toEqual(["helper.invited", "helper.joined"]);
  });

  test("se špatným datem narození 401 a žádný účet", async () => {
    const { cookie } = await setup();
    const created = await (await postInvite(cookie)).json();

    const res = await accept(created.token, "1961-03-01");

    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await testDb.select().from(s.users).where(eq(s.users.role, "helper"))).toHaveLength(0);
  });

  test("zkoušení data narození se po limitu zastaví (429), i se správným datem", async () => {
    const { cookie } = await setup();
    const created = await (await postInvite(cookie)).json();
    for (let i = 0; i < 5; i++) expect((await accept(created.token, `1950-01-0${i + 1}`)).status).toBe(401);

    const res = await accept(created.token);

    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  test("neznámý token 404", async () => {
    const res = await accept("x".repeat(43));

    expect(res.status).toBe(404);
  });

  test("prošlá pozvánka (po 14 dnech) neplatí", async () => {
    const { cookie } = await setup();
    const created = await (await postInvite(cookie)).json();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 15 * 86_400_000);

    const res = await accept(created.token);

    expect(res.status).toBe(404);
  });

  test("opakované přijetí stejné pozvánky použije stejný účet", async () => {
    const { cookie } = await setup();
    const created = await (await postInvite(cookie)).json();
    const first = await (await accept(created.token)).json();

    const second = await (await accept(created.token)).json();

    expect(second.id).toBe(first.id);
    expect(await testDb.select().from(s.users).where(eq(s.users.role, "helper"))).toHaveLength(1);
  });
});

describe("pomocník pomáhá", () => {
  test("vidí zákroky svého pacienta, ne cizí", async () => {
    const { staff, patient, row, cookie } = await setup();
    const { user: other } = await createPatient();
    const otherCase = await createCase(other.id, staff.id);
    const helper = await joinedHelper(cookie);

    const list = await userCases(request("GET", `/api/v1/users/${patient.id}/cases`, { cookie: helper.cookie }), params({ userId: patient.id }));
    expect(list.status).toBe(200);
    expect((await list.json()).map((c: { id: string }) => c.id)).toEqual([row.id]);

    const foreign = await patientCase(request("GET", `/api/v1/users/${other.id}/cases/${otherCase.id}`, { cookie: helper.cookie }), params({ userId: other.id, caseId: otherCase.id }));
    expect(foreign.status).toBe(404);
  });

  test("nahraje lékařskou zprávu, fotku a hlasovou zprávu; dokument má jako autora pomocníka", async () => {
    const { row, cookie } = await setup();
    const helper = await joinedHelper(cookie);

    const report = await postUpload(row.id, helper.cookie, form(JPEG));
    const photo = await postUpload(row.id, helper.cookie, form(PNG, { type: "airway_photo" }, "image/png", "pusa.png"));
    const voice = await postUpload(row.id, helper.cookie, form(WEBM, { type: "voice_message", meta: JSON.stringify({ seconds: 12 }) }, "audio/webm", "zprava.webm"));

    expect([report.status, photo.status, voice.status]).toEqual([201, 201, 201]);
    const [doc] = await testDb.select().from(s.documents).where(eq(s.documents.id, (await report.json()).id));
    expect(doc.uploadedBy).toBe(helper.session.id);
  });

  test("nepodepíše souhlas s anestezií (403), úkol zůstane otevřený", async () => {
    const { row, cookie } = await setup();
    const task = await createTask(row.id, { title: "Souhlas s anestezií", documentType: "consent_signature", informationType: null });
    const helper = await joinedHelper(cookie);

    const res = await postUpload(row.id, helper.cookie, form(PNG, { type: "consent_signature", taskId: task.id, meta: JSON.stringify({ consentVersion: "ukazka-2026-10" }) }, "image/png", "podpis.png"));

    expect(res.status).toBe(403);
    const [stored] = await testDb.select().from(s.tasks).where(eq(s.tasks.id, task.id));
    expect(stored.status).toBe("open");
    expect(await testDb.select().from(s.documents)).toHaveLength(0);
  });

  test("nemůže ukončit přístup jinému pomocníkovi ani sobě", async () => {
    const { cookie } = await setup();
    const helper = await joinedHelper(cookie);

    const res = await revoke(request("DELETE", `/api/v1/helpers/${helper.helperId}`, { cookie: helper.cookie }), params({ helperId: helper.helperId }));

    expect(res.status).toBe(403);
  });

  test("ambulance vidí, kdo dokument nahrál a kdo pacientovi pomáhá", async () => {
    const { staff, row, cookie } = await setup();
    const helper = await joinedHelper(cookie);
    const uploaded = await (await postUpload(row.id, helper.cookie, form(JPEG))).json();

    const res = await caseDetail(request("GET", `/api/v1/cases/${row.id}`, { cookie: await loginCookie(staff.id) }), params({ caseId: row.id }));

    const detail = await res.json();
    expect(detail.helpers).toEqual([expect.objectContaining({ displayName: "Petra", relation: "daughter" })]);
    const doc = detail.documents.find((d: { id: string }) => d.id === uploaded.id);
    expect(detail.people[doc.uploadedBy]).toEqual({ displayName: "Petra", role: "helper", relation: "daughter" });
  });
});

describe("ukončení přístupu", () => {
  test("pacient ukončí přístup: session pomocníka přestane platit a pozvánka už nejde použít", async () => {
    const { row, cookie } = await setup();
    const helper = await joinedHelper(cookie);

    const res = await revoke(request("DELETE", `/api/v1/helpers/${helper.helperId}`, { cookie }), params({ helperId: helper.helperId }));

    expect(res.status).toBe(204);
    expect((await session(request("GET", "/api/auth/session", { cookie: helper.cookie }))).status).toBe(401);
    expect((await postUpload(row.id, helper.cookie, form(JPEG))).status).toBe(401);
    expect((await accept(helper.token)).status).toBe(404);
    expect(await testDb.select().from(s.sessions).where(eq(s.sessions.userId, helper.session.id))).toHaveLength(0);
    const list = await (await listHelpers(request("GET", "/api/v1/helpers", { cookie }))).json();
    expect(list).toEqual([]);
    const events = await testDb.select().from(s.events).where(eq(s.events.caseId, row.id));
    expect(events.map((e) => e.type)).toContain("helper.revoked");
  });

  test("zrušený pomocník neprojde ani se session, kterou by úklid minul", async () => {
    const { row, cookie } = await setup();
    const helper = await joinedHelper(cookie);
    await testDb.update(s.helpers).set({ revokedAt: new Date() }).where(eq(s.helpers.id, helper.helperId));

    const res = await userCases(request("GET", `/api/v1/users/${row.patientId}/cases`, { cookie: helper.cookie }), params({ userId: row.patientId }));

    expect(res.status).toBe(401);
  });

  test("cizí pacient pomocníka neodebere (404)", async () => {
    const { cookie } = await setup();
    const helper = await joinedHelper(cookie);
    const { user: other } = await createPatient();

    const res = await revoke(request("DELETE", `/api/v1/helpers/${helper.helperId}`, { cookie: await loginCookie(other.id) }), params({ helperId: helper.helperId }));

    expect(res.status).toBe(404);
  });
});
