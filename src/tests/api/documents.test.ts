import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import * as s from "@/db/schema";
import { GET as content } from "@/app/api/v1/cases/[caseId]/documents/[documentId]/content/route";
import { DELETE as removeDocument } from "@/app/api/v1/cases/[caseId]/documents/[documentId]/route";
import { GET as metadata } from "@/app/api/v1/cases/[caseId]/documents/[documentId]/metadata/route";
import { POST as upload } from "@/app/api/v1/cases/[caseId]/documents/route";
import { GET as patientCase } from "@/app/api/v1/users/[userId]/cases/[caseId]/route";
import { MAX_DOCUMENTS_PER_CASE } from "@/lib/server/services/documents";
import { memoryBlobStore } from "../support/blob";
import { testDb } from "../support/db";
import { createCase, createDocument, createInformation, createPatient, createStaff, createTask, loginCookie } from "../support/factories";
import { params, request } from "../support/http";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);

function form(file: Uint8Array<ArrayBuffer>, fields: Record<string, string> = {}, mime = "image/jpeg", name = "zprava.jpg") {
  const data = new FormData();
  data.set("file", new File([file], name, { type: mime }));
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function setup() {
  const staff = await createStaff();
  const { user: patient } = await createPatient();
  const row = await createCase(patient.id, staff.id);
  return { staff, patient, row, cookie: await loginCookie(patient.id) };
}

const post = (caseId: string, cookie: string, data: FormData) => upload(request("POST", `/api/v1/cases/${caseId}/documents`, { cookie, form: data }), params({ caseId }));

describe("nahrání dokumentu", () => {
  test("lékařská zpráva jde do úložiště a čeká na čtení AI; typ souboru určí obsah, ne klient", async () => {
    const { patient, row, cookie } = await setup();

    const res = await post(row.id, cookie, form(JPEG, {}, "application/octet-stream"));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ status: "uploaded", type: null });
    const [doc] = await testDb.select().from(s.documents).where(eq(s.documents.id, body.id));
    expect(doc).toMatchObject({ mimeType: "image/jpeg", uploadedBy: patient.id, fileName: "zprava.jpg", filePath: `cases/${row.id}/${body.id}` });
    expect(memoryBlobStore.blobs.get(doc.filePath)?.contentType).toBe("image/jpeg");
  });

  test("stejný soubor podruhé vrátí existující dokument", async () => {
    const { row, cookie } = await setup();
    const first = await (await post(row.id, cookie, form(JPEG))).json();

    const res = await post(row.id, cookie, form(JPEG));

    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(first.id);
    expect(memoryBlobStore.blobs.size).toBe(1);
  });

  test("HTML vydávané za obrázek odmítne a nic neuloží", async () => {
    const { row, cookie } = await setup();

    const res = await post(row.id, cookie, form(new TextEncoder().encode("<html><script>alert(1)</script></html>")));

    expect(res.status).toBe(415);
    expect(memoryBlobStore.blobs.size).toBe(0);
  });

  test("soubor nad 10 MB odmítne", async () => {
    const { row, cookie } = await setup();
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(JPEG);

    const res = await post(row.id, cookie, form(big));

    expect(res.status).toBe(413);
  });

  test("nahrání přes úkol ho posune do stavu, kdy AI dokument čte", async () => {
    const { row, cookie } = await setup();
    const task = await createTask(row.id);

    const res = await post(row.id, cookie, form(JPEG, { taskId: task.id }));

    const body = await res.json();
    const [updated] = await testDb.select().from(s.tasks).where(eq(s.tasks.id, task.id));
    expect(updated).toMatchObject({ status: "submitted", documentId: body.id });
  });

  test("fotka pacienta úkol na krevní testy nesplní", async () => {
    const { row, cookie } = await setup();
    const task = await createTask(row.id, { title: "Krevní testy", documentType: "lab_report" });

    const res = await post(row.id, cookie, form(PNG, { type: "portrait", taskId: task.id }, "image/png"));

    expect(res.status).toBe(400);
    const [unchanged] = await testDb.select().from(s.tasks).where(eq(s.tasks.id, task.id));
    expect(unchanged).toMatchObject({ status: "open", documentId: null });
  });

  test("podpis přes úkol souhlasu úkol splní", async () => {
    const { patient, row, cookie } = await setup();
    const task = await createTask(row.id, { title: "Souhlas s anestezií", documentType: "consent_signature", informationType: null });

    const res = await post(row.id, cookie, form(PNG, { type: "consent_signature", taskId: task.id, meta: JSON.stringify({ consentVersion: "ukazka-2026-10" }) }, "image/png"));

    expect(res.status).toBe(201);
    const [done] = await testDb.select().from(s.tasks).where(eq(s.tasks.id, task.id));
    expect(done).toMatchObject({ status: "done", completedBy: patient.id });
  });

  test("do zrušeného úkolu nahrát nejde", async () => {
    const { row, cookie } = await setup();
    const task = await createTask(row.id, { status: "cancelled", statusNote: "Není potřeba." });

    const res = await post(row.id, cookie, form(JPEG, { taskId: task.id }));

    expect(res.status).toBe(409);
  });

  test("stejný soubor znovu přes úkol úkol posune, i když už je nahraný", async () => {
    const { row, cookie } = await setup();
    const first = await (await post(row.id, cookie, form(JPEG))).json();
    const task = await createTask(row.id);

    const res = await post(row.id, cookie, form(JPEG, { taskId: task.id }));

    expect(res.status).toBe(200);
    const [updated] = await testDb.select().from(s.tasks).where(eq(s.tasks.id, task.id));
    expect(updated).toMatchObject({ status: "submitted", documentId: first.id });
  });

  test("stejný soubor jako jiný druh odmítne místo vrácení cizího dokumentu", async () => {
    const { row, cookie } = await setup();
    await post(row.id, cookie, form(PNG, { type: "portrait" }, "image/png"));

    const res = await post(row.id, cookie, form(PNG, { type: "consent_signature", meta: JSON.stringify({ consentVersion: "ukazka-2026-10" }) }, "image/png"));

    expect(res.status).toBe(409);
  });

  test("úkol z jiného zákroku nepřijme", async () => {
    const { staff, patient, row, cookie } = await setup();
    const other = await createCase(patient.id, staff.id);
    const task = await createTask(other.id);

    const res = await post(row.id, cookie, form(JPEG, { taskId: task.id }));

    expect(res.status).toBe(404);
  });

  test("fotka pacienta a hlasová zpráva se nečtou a uloží metadata od klienta", async () => {
    const { row, cookie } = await setup();

    const portrait = await post(row.id, cookie, form(PNG, { type: "portrait" }, "image/png", "ja.png"));
    const voice = await post(row.id, cookie, form(WEBM, { type: "voice_message", meta: JSON.stringify({ seconds: 12 }) }, "audio/webm", "zprava.webm"));

    expect(portrait.status).toBe(201);
    expect(await portrait.json()).toMatchObject({ status: "processed", type: "portrait" });
    const voiceBody = await voice.json();
    const [doc] = await testDb.select().from(s.documents).where(eq(s.documents.id, voiceBody.id));
    expect(doc).toMatchObject({ type: "voice_message", mimeType: "audio/webm", meta: { seconds: 12 } });
  });

  test("špatná metadata a nepovolený typ odmítne", async () => {
    const { row, cookie } = await setup();

    expect((await post(row.id, cookie, form(WEBM, { type: "voice_message", meta: JSON.stringify({ seconds: "dlouho" }) }, "audio/webm"))).status).toBe(400);
    expect((await post(row.id, cookie, form(JPEG, { type: "lab_report" }))).status).toBe(400);
  });

  test("podpis souhlasu musí být PNG", async () => {
    const { row, cookie } = await setup();

    const res = await post(row.id, cookie, form(JPEG, { type: "consent_signature", meta: JSON.stringify({ consentVersion: "ukazka-2026-10" }) }));

    expect(res.status).toBe(415);
  });

  test("do zrušeného zákroku pacient nenahraje, AA ano", async () => {
    const { staff, patient } = await setup();
    const cancelled = await createCase(patient.id, staff.id, { status: "cancelled" });

    expect((await post(cancelled.id, await loginCookie(patient.id), form(JPEG))).status).toBe(409);
    expect((await post(cancelled.id, await loginCookie(staff.id), form(JPEG))).status).toBe(201);
  });

  test("počet dokumentů na zákrok je omezený", async () => {
    const { patient, row, cookie } = await setup();
    await testDb.insert(s.documents).values(
      Array.from({ length: MAX_DOCUMENTS_PER_CASE }, (_, i) => ({ caseId: row.id, uploadedBy: patient.id, filePath: `cases/${row.id}/x${i}`, mimeType: "image/jpeg", sha256: `limit-${i}` })),
    );

    const res = await post(row.id, cookie, form(JPEG));

    expect(res.status).toBe(409);
    expect(memoryBlobStore.blobs.size).toBe(0);
  });

  test("do cizího zákroku pacient nenahraje", async () => {
    const { row } = await setup();
    const { user: other } = await createPatient();

    const res = await post(row.id, await loginCookie(other.id), form(JPEG));

    expect(res.status).toBe(404);
  });
});

describe("čtení dokumentu", () => {
  test("metadata vrátí stav bez vyčtených hodnot", async () => {
    const { row, cookie } = await setup();
    const { id } = await (await post(row.id, cookie, form(JPEG))).json();

    const res = await metadata(request("GET", `/api/v1/cases/${row.id}/documents/${id}/metadata`, { cookie }), params({ caseId: row.id, documentId: id }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id, status: "uploaded", type: null, issuedDate: null, pageLabel: null });
    expect(body).not.toHaveProperty("aiOutput");
  });

  test("obsah vrátí originál se správným typem a bez sdílené cache", async () => {
    const { row, cookie } = await setup();
    const { id } = await (await post(row.id, cookie, form(JPEG))).json();

    const res = await content(request("GET", `/api/v1/cases/${row.id}/documents/${id}/content`, { cookie }), params({ caseId: row.id, documentId: id }));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
  });

  test("pacient vidí a stáhne všechny dokumenty svého zákroku, i ty, které nahrála AA", async () => {
    const { staff, patient, row, cookie } = await setup();
    const own = await (await post(row.id, cookie, form(JPEG))).json();
    const fromStaff = await (await post(row.id, await loginCookie(staff.id), form(PNG, {}, "image/png"))).json();

    const view = await (await patientCase(request("GET", `/api/v1/users/${patient.id}/cases/${row.id}`, { cookie }), params({ userId: patient.id, caseId: row.id }))).json();
    const download = await content(request("GET", `/api/v1/cases/${row.id}/documents/${fromStaff.id}/content`, { cookie }), params({ caseId: row.id, documentId: fromStaff.id }));

    expect(view.documents.map((d: { id: string }) => d.id)).toEqual([own.id, fromStaff.id]);
    expect(download.status).toBe(200);
  });

  test("lékař otevře dokument pacienta, jiný pacient ne", async () => {
    const { staff, row, cookie } = await setup();
    const { id } = await (await post(row.id, cookie, form(JPEG))).json();
    const { user: other } = await createPatient();
    const get = (c: string) => content(request("GET", `/api/v1/cases/${row.id}/documents/${id}/content`, { cookie: c }), params({ caseId: row.id, documentId: id }));

    expect((await get(await loginCookie(staff.id))).status).toBe(200);
    expect((await get(await loginCookie(other.id))).status).toBe(404);
  });
});

describe("odebrání dokumentu", () => {
  const remove = (caseId: string, documentId: string, cookie: string) =>
    removeDocument(request("DELETE", `/api/v1/cases/${caseId}/documents/${documentId}`, { cookie }), params({ caseId, documentId }));
  const meta = (caseId: string, documentId: string, cookie: string) =>
    metadata(request("GET", `/api/v1/cases/${caseId}/documents/${documentId}/metadata`, { cookie }), params({ caseId, documentId }));

  test("pacient smaže omylem nahranou fotku: API ji už nevydá, soubor v úložišti zůstane, úkol se znovu otevře", async () => {
    const { patient, row, cookie } = await setup();
    const task = await createTask(row.id, { title: "Fotka úst", documentType: "airway_photo", informationType: null });
    const photo = await (await post(row.id, cookie, form(JPEG, { type: "airway_photo", taskId: task.id }))).json();

    const res = await remove(row.id, photo.id, cookie);

    expect(res.status).toBe(204);
    expect((await meta(row.id, photo.id, cookie)).status).toBe(404);
    const [doc] = await testDb.select().from(s.documents).where(eq(s.documents.id, photo.id));
    expect(doc).toMatchObject({ removedBy: patient.id, removedAt: expect.any(Date) });
    expect(memoryBlobStore.blobs.has(doc.filePath)).toBe(true);
    const [reopened] = await testDb.select().from(s.tasks).where(eq(s.tasks.id, task.id));
    expect(reopened).toMatchObject({ status: "open", documentId: null, completedAt: null });
    const view = await (await patientCase(request("GET", `/api/v1/users/${patient.id}/cases/${row.id}`, { cookie }), params({ userId: patient.id, caseId: row.id }))).json();
    expect(view.airwayPhoto).toBeNull();
  });

  test("když úkol splňuje ještě jiná stránka nahraná přes něj, zůstane splněný", async () => {
    const { row, cookie } = await setup();
    const task = await createTask(row.id);
    const first = await (await post(row.id, cookie, form(JPEG, { taskId: task.id }))).json();
    const second = await (await post(row.id, cookie, form(PNG, { taskId: task.id }, "image/png", "strana2.png"))).json();

    await remove(row.id, second.id, cookie);

    const [kept] = await testDb.select().from(s.tasks).where(eq(s.tasks.id, task.id));
    expect(kept).toMatchObject({ status: "submitted", documentId: first.id });
  });

  test("stejný soubor jde po odebrání nahrát znovu jako nový dokument", async () => {
    const { row, cookie } = await setup();
    const first = await (await post(row.id, cookie, form(JPEG))).json();
    await remove(row.id, first.id, cookie);

    const res = await post(row.id, cookie, form(JPEG));

    expect(res.status).toBe(201);
    expect((await res.json()).id).not.toBe(first.id);
  });

  test("pacient nesmaže dokument od AA ani ten, se kterým AA už pracovala", async () => {
    const { staff, patient, row, cookie } = await setup();
    const fromStaff = await createDocument(row.id, staff.id);
    const handled = await createDocument(row.id, patient.id);
    await createInformation(row.id, { type: "hemoglobin", value: { value: 98, unit: "g/l" }, documentId: handled.id, status: "verified", verifiedBy: staff.id });

    expect((await remove(row.id, fromStaff.id, cookie)).status).toBe(403);
    expect((await remove(row.id, handled.id, cookie)).status).toBe(409);
  });

  test("AA odebere cizí stránku: neověřené hodnoty zmizí, ověřené se zamítnou a zapíše se to do časové osy", async () => {
    const { staff, patient, row } = await setup();
    const doc = await createDocument(row.id, patient.id);
    const draft = await createInformation(row.id, { type: "platelets", value: { value: 250, unit: "10^9/l" }, documentId: doc.id });
    const verified = await createInformation(row.id, { type: "hemoglobin", value: { value: 98, unit: "g/l" }, documentId: doc.id, status: "verified", verifiedBy: staff.id });

    const res = await remove(row.id, doc.id, await loginCookie(staff.id));

    expect(res.status).toBe(204);
    const left = await testDb.select().from(s.information).where(eq(s.information.documentId, doc.id));
    expect(left.map((i) => i.id)).toEqual([verified.id]);
    expect(left[0]).toMatchObject({ status: "rejected", verifiedBy: staff.id, note: "Dokument odebrán." });
    expect(left.some((i) => i.id === draft.id)).toBe(false);
    const events = await testDb.select().from(s.events).where(eq(s.events.subjectId, doc.id));
    expect(events).toEqual([expect.objectContaining({ type: "document.removed", actorId: staff.id })]);
  });

  test("odebraný dokument podruhé ani cizí zákrok nevydá", async () => {
    const { row, cookie } = await setup();
    const doc = await (await post(row.id, cookie, form(JPEG))).json();
    await remove(row.id, doc.id, cookie);
    const { user: other } = await createPatient();

    expect((await remove(row.id, doc.id, cookie)).status).toBe(404);
    expect((await remove(row.id, doc.id, await loginCookie(other.id))).status).toBe(404);
  });
});
