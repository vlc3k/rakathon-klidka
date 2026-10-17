import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vitest";
import * as s from "@/db/schema";
import { POST as transcribe } from "@/app/api/v1/cases/[caseId]/documents/[documentId]/transcribe/route";
import { POST as createTranscript } from "@/app/api/v1/cases/[caseId]/transcripts/route";
import { POST as readInBackground } from "@/app/api/v1/cases/[caseId]/transcripts/background/route";
import { AiError, callStructured } from "@/lib/server/transcripts/model";
import type { Extraction, PageTranscript, PageTranscriptOutput } from "@/lib/server/transcripts/schema";
import { memoryBlobStore } from "../support/blob";
import { testDb } from "../support/db";
import { createCase, createDocument, createInformation, createPatient, createStaff, createTask, loginCookie } from "../support/factories";
import { params, request } from "../support/http";

// Model se v testech nevolá: callStructured vrací připravené odpovědi, zbytek (mapování, databáze, audit) je skutečný.
vi.mock("@/lib/server/transcripts/model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/transcripts/model")>();
  return { ...actual, callStructured: vi.fn() };
});
const ai = vi.mocked(callStructured);

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

const PAGE: PageTranscriptOutput = {
  legibility: "good",
  lines: [
    { text: "Laboratoř VFN", box: [50, 40, 600, 70], confidence: 98 },
    { text: "Jan Novák  RČ 600301/0002", box: [50, 90, 700, 120], confidence: 96 },
    { text: "Datum odběru: 12. 10. 2026", box: [50, 140, 500, 170], confidence: 97 },
    { text: "B-Hemoglobin | 104 | g/l | 120–160 | L", box: [50, 300, 900, 330], confidence: 88 },
    { text: "  ", box: null, confidence: 10 },
  ],
};

const EXTRACTION: Extraction = {
  document: { type: "lab_report", issuedDate: "2026-10-13", institution: "Laboratoř VFN", lines: ["p1-l1"] },
  patient: { name: { text: "Jan Novák", confidence: 96, lines: ["p1-l2"] }, birthNumber: { text: "600301/0002", confidence: 96, lines: ["p1-l2"] } },
  labs: [
    { type: "hemoglobin", name: "B-Hemoglobin", value: 104, valueText: "104", unit: "g/l", refLow: 120, refHigh: 160, flag: "L", observedDate: "2026-10-12", dateKind: "collection", confidence: 95, lines: ["p1-l3", "p1-l4"] },
    { type: "ferritin", name: "S-Ferritin", value: 9, valueText: "9", unit: "µg/l", refLow: 15, refHigh: 150, flag: "L", observedDate: null, dateKind: "document", confidence: 90, lines: ["p2-l1"] },
  ],
  medications: [{ name: "Concor", strength: "5 mg", dose: null, confidence: 80, lines: ["p2-l2"] }],
  allergies: { status: "denied", items: [], lines: ["p2-l3"] },
  conditions: [{ text: "Hypertenze", icd10: "I10", confidence: 85, lines: [] }],
  procedure: null,
  issues: [{ code: "missing_sample_date", detail: "Ferritin bez data odběru.", lines: ["p2-l1"] }],
};

const PAGE_2: PageTranscript = {
  legibility: "good",
  lines: [
    { id: "l1", text: "S-Ferritin | 9 | µg/l | 15–150", box: [60, 200, 880, 230], confidence: 92 },
    { id: "l2", text: "Medikace: Concor 5 mg", box: [60, 400, 700, 430], confidence: 75 },
    { id: "l3", text: "Alergie: neguje", box: [60, 450, 500, 480], confidence: 99 },
  ],
};

const meta = (data: unknown) => ({ data, model: "gpt-test", usage: { input: 100, output: 50, total: 150 }, durationMs: 1200, attempts: 1 });

// Pacient s RČ jako na dokumentu. Druhý pacient (cizí zákrok) RČ nemá, RČ je v databázi unikátní.
async function setup(birthNumber: string | null = "6003010002") {
  const staff = await createStaff();
  const { user: patient } = await createPatient({ user: { firstName: "Jan", lastName: "Novák" }, patient: { birthNumber } });
  const row = await createCase(patient.id, staff.id);
  return { staff, patient, row, cookie: await loginCookie(patient.id), staffCookie: await loginCookie(staff.id) };
}

async function uploadedPage(caseId: string, uploadedBy: string, overrides: Partial<typeof s.documents.$inferInsert> = {}) {
  const doc = await createDocument(caseId, uploadedBy, { status: "uploaded", type: null, patientMatch: "pending", ...overrides });
  await memoryBlobStore.put(doc.filePath, JPEG, doc.mimeType);
  return doc;
}

const postTranscribe = (caseId: string, documentId: string, cookie: string) =>
  transcribe(request("POST", `/api/v1/cases/${caseId}/documents/${documentId}/transcribe`, { cookie }), params({ caseId, documentId }));

const postTranscript = (caseId: string, cookie: string, json: unknown) =>
  createTranscript(request("POST", `/api/v1/cases/${caseId}/transcripts`, { cookie, json }), params({ caseId }));

beforeEach(() => {
  ai.mockReset();
});

describe("přepis stránky", () => {
  test("AI přepíše stránku: řádky s id, text, model a metadata v dokumentu, záznam v časové ose", async () => {
    const { patient, row, cookie } = await setup();
    const doc = await uploadedPage(row.id, patient.id);
    ai.mockResolvedValueOnce(meta(PAGE));

    const res = await postTranscribe(row.id, doc.id, cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: doc.id, status: "processed" });
    expect(ai).toHaveBeenCalledWith(expect.objectContaining({ step: "transcription" }));
    const image = ai.mock.calls[0][0].user.find((part) => part.type === "image_url");
    expect(image?.type === "image_url" && image.image_url.url.startsWith("data:image/jpeg;base64,")).toBe(true);

    const [saved] = await testDb.select().from(s.documents).where(eq(s.documents.id, doc.id));
    expect(saved.transcript).toEqual({
      legibility: "good",
      lines: [
        { id: "l1", text: "Laboratoř VFN", box: [50, 40, 600, 70], confidence: 98 },
        { id: "l2", text: "Jan Novák  RČ 600301/0002", box: [50, 90, 700, 120], confidence: 96 },
        { id: "l3", text: "Datum odběru: 12. 10. 2026", box: [50, 140, 500, 170], confidence: 97 },
        { id: "l4", text: "B-Hemoglobin | 104 | g/l | 120–160 | L", box: [50, 300, 900, 330], confidence: 88 },
      ],
    });
    expect(saved.transcriptText).toBe("Laboratoř VFN\nJan Novák  RČ 600301/0002\nDatum odběru: 12. 10. 2026\nB-Hemoglobin | 104 | g/l | 120–160 | L");
    expect(saved).toMatchObject({ aiModel: "gpt-test", error: null, aiMeta: expect.objectContaining({ step: "transcription", model: "gpt-test", schemaVersion: 1, attempts: 1 }) });
    const events = await testDb.select().from(s.events).where(eq(s.events.subjectId, doc.id));
    expect(events.map((e) => e.type)).toContain("document.transcribed");
  });

  test("už přepsanou stránku nečte znovu", async () => {
    const { patient, row, cookie } = await setup();
    const doc = await uploadedPage(row.id, patient.id, { status: "processed", transcript: PAGE_2 });

    const res = await postTranscribe(row.id, doc.id, cookie);

    expect(res.status).toBe(200);
    expect(ai).not.toHaveBeenCalled();
  });

  test("chyba AI: 502, stránka failed s důvodem v error, záznam v časové ose; další pokus projde", async () => {
    const { patient, row, cookie, staffCookie } = await setup();
    const doc = await uploadedPage(row.id, patient.id);
    ai.mockRejectedValueOnce(new AiError("timeout", "transcription"));

    const res = await postTranscribe(row.id, doc.id, cookie);

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/Zkuste to znovu/);
    const [failed] = await testDb.select().from(s.documents).where(eq(s.documents.id, doc.id));
    expect(failed).toMatchObject({ status: "failed", transcript: null });
    expect(failed.error).toMatch(/^timeout:/);
    const events = await testDb.select().from(s.events).where(eq(s.events.subjectId, doc.id));
    expect(events.find((e) => e.type === "document.transcription_failed")?.data).toEqual({ code: "timeout" });

    ai.mockResolvedValueOnce(meta(PAGE));
    expect((await postTranscribe(row.id, doc.id, staffCookie)).status).toBe(200);
  });

  test("PDF zatím nepřečte: 422 a stránka failed", async () => {
    const { patient, row, cookie } = await setup();
    const doc = await uploadedPage(row.id, patient.id, { mimeType: "application/pdf" });

    const res = await postTranscribe(row.id, doc.id, cookie);

    expect(res.status).toBe(422);
    expect(ai).not.toHaveBeenCalled();
    const [failed] = await testDb.select().from(s.documents).where(eq(s.documents.id, doc.id));
    expect(failed.status).toBe("failed");
  });

  test("fotka pacienta se nečte, cizí zákrok vrátí 404", async () => {
    const { patient, row, cookie } = await setup();
    const portrait = await uploadedPage(row.id, patient.id, { type: "portrait", status: "processed" });
    const other = await setup(null);

    expect((await postTranscribe(row.id, portrait.id, cookie)).status).toBe(400);
    expect((await postTranscribe(other.row.id, portrait.id, other.cookie)).status).toBe(404);
  });
});

describe("přepis dokumentu a hodnoty", () => {
  async function twoPages() {
    const ctx = await setup();
    const first = await uploadedPage(ctx.row.id, ctx.patient.id, {
      status: "processed",
      transcript: { legibility: "good", lines: PAGE.lines.slice(0, 4).map((line, i) => ({ id: `l${i + 1}`, ...line, box: line.box as [number, number, number, number] })) },
    });
    const second = await uploadedPage(ctx.row.id, ctx.patient.id, { status: "processed", transcript: PAGE_2 });
    return { ...ctx, first, second };
  }

  test("hodnoty jdou do information podle katalogu: typ, tvar, datum, poloha a jistota z řádků přepisu", async () => {
    const { row, cookie, first, second } = await twoPages();
    ai.mockResolvedValueOnce(meta(EXTRACTION));

    const res = await postTranscript(row.id, cookie, { documentIds: [first.id, second.id] });

    expect(res.status).toBe(201);
    const body = await res.json();
    // Pacient dostane jen stav a počet, žádné hodnoty, model ani chybu.
    expect(body).toEqual({ id: body.id, status: "processed", documentType: "lab_report", pageCount: 2, informationCount: 5, createdAt: expect.any(String), finishedAt: expect.any(String) });
    const prompt = ai.mock.calls[0][0].user[0];
    expect(prompt.type === "text" && prompt.text).toContain("[p2-l1] S-Ferritin | 9 | µg/l | 15–150");

    const rows = await testDb.select().from(s.information).where(eq(s.information.caseId, row.id));
    const hb = rows.find((r) => r.type === "hemoglobin")!;
    expect(hb).toMatchObject({
      value: { value: 104, unit: "g/l", refLow: 120, refHigh: 160, flag: "L" },
      rawText: "B-Hemoglobin | 104 | g/l | 120–160 | L", // jen řádek s hodnotou, ne řádek s datem odběru
      observedDate: "2026-10-12",
      isObservedDateEstimated: false,
      documentId: first.id,
      bbox: { x: 0.05, y: 0.3, w: 0.85, h: 0.03 },
      confidence: 0.88, // nižší z jistoty hodnoty (95) a přepisu řádku (88)
      status: "ai_extracted",
      transcriptId: body.id,
    });
    const ferritin = rows.find((r) => r.type === "ferritin")!;
    expect(ferritin).toMatchObject({ documentId: second.id, observedDate: "2026-10-13", isObservedDateEstimated: true });
    expect(rows.find((r) => r.type === "medication")?.value).toEqual({ name: "Concor", strength: "5 mg" });
    expect(rows.find((r) => r.type === "allergy")?.value).toEqual({ none: true });
    expect(rows.find((r) => r.type === "condition")).toMatchObject({ value: { text: "Hypertenze", icd10: "I10" }, bbox: null, confidence: 0.5 });

    const pages = await testDb.select().from(s.documents).where(eq(s.documents.transcriptId, body.id));
    expect(pages.map((p) => [p.id, p.pageNumber, p.pageLabel, p.type, p.issuedDate, p.patientMatch]).sort((a, b) => Number(a[1]) - Number(b[1]))).toEqual([
      [first.id, 1, "1/2", "lab_report", "2026-10-13", "match"],
      [second.id, 2, "2/2", "lab_report", "2026-10-13", "match"],
    ]);
    expect(pages.find((p) => p.id === second.id)?.issues).toEqual([{ code: "missing_sample_date", detail: "Ferritin bez data odběru." }]);

    const [saved] = await testDb.select().from(s.documentTranscripts).where(eq(s.documentTranscripts.id, body.id));
    expect(saved).toMatchObject({ status: "processed", model: "gpt-test", schemaVersion: 1, attempts: 1, usage: { input: 100, output: 50, total: 150 }, output: EXTRACTION });
    expect(saved.promptVersion).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(saved.transcriptText).toContain("--- Strana 1 ---\n[p1-l1] Laboratoř VFN");
  });

  test("AA dostane i model; pořadí stránek určuje požadavek", async () => {
    const { row, staffCookie, first, second } = await twoPages();
    ai.mockResolvedValueOnce(meta({ ...EXTRACTION, labs: [], medications: [], conditions: [], allergies: { status: "not_mentioned", items: [], lines: [] }, issues: [] }));

    const res = await postTranscript(row.id, staffCookie, { documentIds: [second.id, first.id] });

    expect(await res.json()).toMatchObject({ model: "gpt-test", error: null, informationCount: 0 });
    const [page] = await testDb.select().from(s.documents).where(eq(s.documents.id, second.id));
    expect(page.pageNumber).toBe(1);
  });

  test("přeskočit: stránky zůstanou bez hodnot, AI se nevolá", async () => {
    const { row, cookie, first, second } = await twoPages();

    const res = await postTranscript(row.id, cookie, { documentIds: [first.id, second.id], skip: true });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ status: "skipped", informationCount: null, pageCount: 2 });
    expect(ai).not.toHaveBeenCalled();
    expect(await testDb.select().from(s.information).where(eq(s.information.caseId, row.id))).toHaveLength(0);
  });

  test("chyba AI: 502, přepis failed s důvodem, žádné hodnoty; nový pokus vytvoří nový přepis", async () => {
    const { row, cookie, first } = await twoPages();
    ai.mockRejectedValueOnce(new AiError("invalid_output", "extraction"));

    const res = await postTranscript(row.id, cookie, { documentIds: [first.id] });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.transcript).toMatchObject({ status: "failed" });
    expect(body.transcript.error).toBeUndefined();
    const [failed] = await testDb.select().from(s.documentTranscripts).where(eq(s.documentTranscripts.id, body.transcript.id));
    expect(failed.error).toMatch(/^invalid_output:/);
    expect(await testDb.select().from(s.information).where(eq(s.information.caseId, row.id))).toHaveLength(0);

    ai.mockResolvedValueOnce(meta({ ...EXTRACTION, labs: [EXTRACTION.labs[0]], medications: [], conditions: [], issues: [] }));
    expect((await postTranscript(row.id, cookie, { documentIds: [first.id] })).status).toBe(201);
  });

  test("znovu přečtený dokument nahradí neověřené hodnoty, ověřené zůstanou", async () => {
    const { staff, row, cookie, first, second } = await twoPages();
    const verified = await createInformation(row.id, { type: "hemoglobin", value: { value: 104, unit: "g/l" }, documentId: first.id, status: "verified", verifiedBy: staff.id });
    await createInformation(row.id, { type: "hemoglobin", value: { value: 140, unit: "g/l" }, documentId: first.id });
    ai.mockResolvedValueOnce(meta(EXTRACTION));

    await postTranscript(row.id, cookie, { documentIds: [first.id, second.id] });

    const rows = await testDb.select().from(s.information).where(eq(s.information.caseId, row.id));
    expect(rows.some((r) => r.id === verified.id)).toBe(true);
    expect(rows.filter((r) => r.type === "hemoglobin").map((r) => (r.value as { value: number }).value).sort()).toEqual([104, 104]);
  });

  test("úkol čekající na dokument se splní, když typ sedí", async () => {
    const { row, cookie, first } = await twoPages();
    const task = await createTask(row.id, { status: "submitted", documentId: first.id, documentType: "lab_report" });
    ai.mockResolvedValueOnce(meta(EXTRACTION));

    await postTranscript(row.id, cookie, { documentIds: [first.id] });

    const [done] = await testDb.select().from(s.tasks).where(eq(s.tasks.id, task.id));
    expect(done.status).toBe("done");
  });

  test("jiný pacient na dokumentu: shoda mismatch a v poznámce jen maskované RČ", async () => {
    const { row, cookie, first } = await twoPages();
    ai.mockResolvedValueOnce(meta({ ...EXTRACTION, patient: { name: { text: "Petr Dvořák", confidence: 90, lines: ["p1-l2"] }, birthNumber: { text: "710512/1234", confidence: 90, lines: ["p1-l2"] } } }));

    await postTranscript(row.id, cookie, { documentIds: [first.id] });

    const [page] = await testDb.select().from(s.documents).where(eq(s.documents.id, first.id));
    expect(page.patientMatch).toBe("mismatch");
    expect(page.patientMatchNote).toContain("710512/****");
    expect(page.patientMatchNote).not.toContain("1234");
  });

  test("neplatný vstup: opakované stránky 400, cizí stránka 404, stránka, která se čte, 409", async () => {
    const { patient, row, cookie, first } = await twoPages();
    const other = await setup(null);
    const otherPage = await uploadedPage(other.row.id, other.patient.id);
    const reading = await uploadedPage(row.id, patient.id, { status: "processing" });

    expect((await postTranscript(row.id, cookie, { documentIds: [first.id, first.id] })).status).toBe(400);
    expect((await postTranscript(row.id, cookie, { documentIds: [first.id, otherPage.id] })).status).toBe(404);
    expect((await postTranscript(row.id, cookie, { documentIds: [reading.id] })).status).toBe(409);
  });
});

describe("čtení na pozadí", () => {
  const postBackground = (caseId: string, cookie: string, json: unknown) =>
    readInBackground(request("POST", `/api/v1/cases/${caseId}/transcripts/background`, { cookie, json }), params({ caseId }));

  test("hned 202, stránka se přečte a dokument se složí až potom", async () => {
    const { patient, row, cookie } = await setup();
    const doc = await uploadedPage(row.id, patient.id);
    ai.mockResolvedValueOnce(meta(PAGE)).mockResolvedValueOnce(meta(EXTRACTION));

    const res = await postBackground(row.id, cookie, { documentIds: [doc.id] });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "reading", documentIds: [doc.id] });
    await vi.waitFor(async () => {
      const [page] = await testDb.select().from(s.documents).where(eq(s.documents.id, doc.id));
      expect(page.status).toBe("processed");
      const transcripts = await testDb.select().from(s.documentTranscripts).where(eq(s.documentTranscripts.caseId, row.id));
      expect(transcripts.map((t) => t.status)).toEqual(["processed"]);
    });
  });

  test("nepřečtená stránka zůstane failed a dokument se složí bez ní", async () => {
    const { patient, row, cookie } = await setup();
    const doc = await uploadedPage(row.id, patient.id);
    ai.mockRejectedValueOnce(new AiError("timeout", "transcription"));

    expect((await postBackground(row.id, cookie, { documentIds: [doc.id] })).status).toBe(202);
    await vi.waitFor(async () => {
      const [page] = await testDb.select().from(s.documents).where(eq(s.documents.id, doc.id));
      expect(page.status).toBe("failed");
      const transcripts = await testDb.select().from(s.documentTranscripts).where(eq(s.documentTranscripts.caseId, row.id));
      expect(transcripts.map((t) => t.status)).toEqual(["skipped"]);
    });
  });

  test("cizí nebo neexistující stránka: 404 hned, nic se nečte", async () => {
    const { row, cookie } = await setup(null);
    const other = await setup("7001010003");
    const foreign = await uploadedPage(other.row.id, other.patient.id);

    const res = await postBackground(row.id, cookie, { documentIds: [foreign.id] });

    expect(res.status).toBe(404);
    expect(ai).not.toHaveBeenCalled();
  });
});
