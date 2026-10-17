import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { DOCUMENT_TYPES, isClientDocumentType } from "@/db/catalog";
import { documents, documentTranscripts, information, patients, tasks, users } from "@/db/schema";
import { matchIdentity } from "@/lib/identity";
import { isStaff, type CaseRecord, type CurrentUser } from "@/lib/server/auth";
import { getBlobStore } from "@/lib/server/blob";
import { getDb, type Executor } from "@/lib/server/db";
import { recordEvent, recordEvents, type EventInput } from "@/lib/server/events";
import { badRequest, conflict, HttpError, notFound } from "@/lib/server/http";
import { findDocument } from "@/lib/server/services/documents";
import { issuesByDocument, toInformation } from "@/lib/server/transcripts/map";
import { AiError } from "@/lib/server/transcripts/model";
import { extractValues, MAX_PAGES, MAX_TRANSCRIPT_CHARS, fullTranscript, transcribePage, type TranscriptPage } from "@/lib/server/transcripts/pipeline";
import type { PageTranscript } from "@/lib/server/transcripts/schema";

// Čtení lékařských zpráv do databáze ve dvou krocích:
// 1. transcribeDocument: přepis jedné nahrané stránky (documents.transcript, transcript_text, ai_model, ai_meta)
// 2. createDocumentTranscript: přepis celého dokumentu z jeho stránek (document_transcripts) a hodnoty
//    do information (ai_extracted). Pacient smí čtení přeskočit, stránky pak zůstanou AA bez hodnot.
// Chyba AI se uloží (error), zaloguje, zapíše do časové osy a klient dostane 502, aby nabídl znovu nebo přeskočit.

type DocumentRow = typeof documents.$inferSelect;
type TranscriptRow = typeof documentTranscripts.$inferSelect;

const READABLE_MIME = ["image/jpeg", "image/png"] as const;
type ReadableMime = (typeof READABLE_MIME)[number];
const isReadableMime = (mime: string): mime is ReadableMime => (READABLE_MIME as readonly string[]).includes(mime);

export const createTranscriptSchema = z.strictObject({
  documentIds: z.array(z.uuid()).min(1).max(MAX_PAGES).refine((ids) => new Set(ids).size === ids.length, "Stránky se opakují."),
  skip: z.boolean().optional(),
});

// Pacient vidí jen stav, nikdy vyčtené hodnoty. AA navíc důvod chyby.
export function toTranscriptDto(row: TranscriptRow, informationCount: number | null, viewer: CurrentUser) {
  return {
    id: row.id,
    status: row.status,
    documentType: row.documentType,
    pageCount: row.pageCount,
    informationCount,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
    ...(isStaff(viewer) ? { error: row.error, model: row.model } : {}),
  };
}

// Stránka, kterou AI čte: lékařská zpráva (bez typu od klienta) z tohoto zákroku.
async function medicalDocument(caseId: string, documentId: string) {
  const doc = await findDocument(caseId, documentId);
  if (isClientDocumentType(doc.type)) throw badRequest("Tento soubor se nečte.");
  return doc;
}

async function readBlob(path: string) {
  const blob = await getBlobStore().get(path);
  if (!blob) throw notFound("Soubor není k dispozici.");
  return new Uint8Array(await new Response(blob.body).arrayBuffer());
}

const failureText = (error: AiError) => `${error.code}: ${error.message}`;

function aiFailure(error: AiError) {
  return new HttpError(502, `${error.message} Zkuste to znovu, nebo čtení přeskočte.`);
}

// ---------------------------------------------------------------- 1. přepis stránky

export async function transcribeDocument(actor: CurrentUser, row: CaseRecord, documentId: string): Promise<DocumentRow> {
  const doc = await medicalDocument(row.id, documentId);
  if (doc.transcript && doc.status === "processed") return doc; // už přepsaná, znovu se nečte
  if (doc.status === "processing") throw conflict("Stránka se právě čte.");

  const db = getDb();
  if (!isReadableMime(doc.mimeType)) {
    await db.update(documents).set({ status: "failed", error: "unsupported_file: Tento typ souboru zatím přečíst neumíme." }).where(eq(documents.id, doc.id));
    console.error(JSON.stringify({ event: "transcript.unsupported_file", caseId: row.id, documentId: doc.id, mimeType: doc.mimeType }));
    throw new HttpError(422, "Tento typ souboru zatím přečíst neumíme. Nahrajte prosím fotku.");
  }

  // Jen jeden běh najednou: stav se přepne na processing, jen když stránka zrovna nečte.
  const [claimed] = await db
    .update(documents)
    .set({ status: "processing", error: null })
    .where(and(eq(documents.id, doc.id), inArray(documents.status, ["uploaded", "failed", "processed"])))
    .returning();
  if (!claimed) throw conflict("Stránka se právě čte.");

  try {
    const image = await readBlob(doc.filePath);
    const { transcript, text, meta } = await transcribePage(image, doc.mimeType as ReadableMime, { caseId: row.id, documentId: doc.id });
    return await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(documents)
        .set({ status: "processed", transcript, transcriptText: text, aiModel: meta.model, aiMeta: meta, error: null, processedAt: new Date() })
        .where(eq(documents.id, doc.id))
        .returning();
      await recordEvent(tx, { caseId: row.id, actorId: actor.id, type: "document.transcribed", subjectId: doc.id, summary: "Stránka přepsána.", data: { lines: transcript.lines.length, model: meta.model } });
      return updated;
    });
  } catch (error) {
    const aiError = error instanceof AiError ? error : null;
    await db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({ status: "failed", error: aiError ? failureText(aiError) : "internal: Přepis selhal." })
        .where(eq(documents.id, doc.id));
      await recordEvent(tx, { caseId: row.id, actorId: actor.id, type: "document.transcription_failed", subjectId: doc.id, summary: "Stránku se nepodařilo přečíst.", data: { code: aiError?.code ?? "internal" } });
    });
    if (aiError) throw aiFailure(aiError);
    throw error;
  }
}

// Čtení celého dokumentu na pozadí: pacient čeká jen na nahrání fotek (pár sekund), přepis stránek
// (desítky sekund každá) a vytěžení hodnot doběhnou po odpovědi. Stránky se čtou souběžně; nepřečtená
// stránka zůstane failed a dokument se složí z ostatních (bez přepisu žádné → skipped, AA vidí originál).
export async function readDocument(actor: CurrentUser, row: CaseRecord, documentIds: string[], { waitMs = 90_000, pollMs = 2_000 } = {}) {
  await Promise.allSettled(documentIds.map((id) => transcribeDocument(actor, row, id)));
  // Stránku mohl zrovna číst jiný běh (opakovaný požadavek): počkáme, až doběhne, jinak by se dokument nesložil.
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const pages = await getDb().select({ status: documents.status }).from(documents).where(inArray(documents.id, documentIds));
    if (!pages.some((page) => page.status === "processing")) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return createDocumentTranscript(actor, row, { documentIds });
}

// ---------------------------------------------------------------- 2. přepis dokumentu a hodnoty

export async function createDocumentTranscript(
  actor: CurrentUser,
  row: CaseRecord,
  input: z.infer<typeof createTranscriptSchema>,
): Promise<{ transcript: TranscriptRow; informationCount: number | null; failure?: HttpError }> {
  const db = getDb();
  const found = await db.select().from(documents).where(and(eq(documents.caseId, row.id), inArray(documents.id, input.documentIds), isNull(documents.removedAt)));
  if (found.length !== input.documentIds.length) throw notFound("Stránka nenalezena.");
  if (found.some((doc) => isClientDocumentType(doc.type))) throw badRequest("Neplatné údaje.", [{ path: "documentIds", message: "Mezi stránkami je soubor, který se nečte." }]);
  if (found.some((doc) => doc.status === "processing")) throw conflict("Některá stránka se ještě čte.");

  // Pořadí stránek podle požadavku (jak je pacient nafotil).
  const pages = input.documentIds.map((id) => found.find((doc) => doc.id === id)!);
  const pageCount = pages.length;
  const transcribed: TranscriptPage[] = pages.flatMap((doc, i) => (doc.transcript ? [{ documentId: doc.id, pageNumber: i + 1, transcript: doc.transcript as PageTranscript }] : []));

  // Přeskočeno, nebo není co číst (žádná stránka nemá přepis): stránky zůstanou AA bez hodnot.
  if (input.skip || transcribed.length === 0) {
    const transcript = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(documentTranscripts)
        .values({ caseId: row.id, status: "skipped", pageCount, createdBy: actor.id, finishedAt: new Date(), error: input.skip ? null : "empty: Žádná stránka nemá přepis." })
        .returning();
      await attachPages(tx, created.id, pages);
      await recordEvent(tx, { caseId: row.id, actorId: actor.id, type: "document.read_skipped", subjectId: created.id, summary: `Dokument nahrán bez čtení (${pageLabel(pageCount)}).` });
      return created;
    });
    return { transcript, informationCount: null };
  }

  const transcriptText = fullTranscript(transcribed);
  if (transcriptText.length > MAX_TRANSCRIPT_CHARS) throw new HttpError(413, "Dokument je na jedno přečtení příliš dlouhý. Nahrajte ho po částech.");

  const [started] = await db
    .insert(documentTranscripts)
    .values({ caseId: row.id, status: "processing", pageCount, transcriptText, createdBy: actor.id })
    .returning();
  await attachPages(db, started.id, pages);

  let result: Awaited<ReturnType<typeof extractValues>>;
  try {
    result = await extractValues(transcribed, { caseId: row.id, transcriptId: started.id });
  } catch (error) {
    const aiError = error instanceof AiError ? error : null;
    const [failed] = await db.transaction(async (tx) => {
      const updated = await tx
        .update(documentTranscripts)
        .set({ status: "failed", error: aiError ? failureText(aiError) : "internal: Čtení selhalo.", finishedAt: new Date() })
        .where(eq(documentTranscripts.id, started.id))
        .returning();
      await recordEvent(tx, { caseId: row.id, actorId: actor.id, type: "document.read_failed", subjectId: started.id, summary: "Dokument se nepodařilo přečíst.", data: { code: aiError?.code ?? "internal" } });
      return updated;
    });
    if (aiError) return { transcript: failed, informationCount: null, failure: aiFailure(aiError) };
    throw error;
  }

  const { extraction, meta } = result;
  const { rows, skipped } = toInformation(extraction, transcribed);
  if (skipped.length) console.warn(JSON.stringify({ event: "transcript.values_skipped", caseId: row.id, transcriptId: started.id, count: skipped.length }));

  const identity = await patientIdentity(row.patientId);
  const match = matchIdentity({ name: extraction.patient.name?.text, birthNumber: extraction.patient.birthNumber?.text }, identity);
  const patientMatch = match.result === "match" || match.result === "match_warn" ? "match" : match.result;
  const issues = issuesByDocument(extraction, transcribed);
  const documentType = extraction.document.type;

  const transcript = await db.transaction(async (tx) => {
    const ids = pages.map((doc) => doc.id);
    // Znovu přečtený dokument: hodnoty z předchozího čtení, které nikdo neověřil, nahradí nové.
    await tx.delete(information).where(and(inArray(information.documentId, ids), eq(information.status, "ai_extracted")));
    if (rows.length) {
      await tx.insert(information).values(
        rows.map((draft) => ({
          caseId: row.id,
          type: draft.type,
          value: draft.value,
          rawText: draft.rawText,
          observedDate: draft.observedDate,
          isObservedDateEstimated: draft.isObservedDateEstimated,
          documentId: draft.documentId,
          transcriptId: started.id,
          bbox: draft.bbox,
          confidence: draft.confidence,
          status: "ai_extracted" as const,
        })),
      );
    }
    for (const doc of pages) {
      await tx
        .update(documents)
        .set({
          type: documentType,
          issuedDate: extraction.document.issuedDate,
          patientMatch,
          patientMatchNote: maskRc(match.reason),
          issues: issues.get(doc.id) ?? [],
        })
        .where(eq(documents.id, doc.id));
    }
    const [finished] = await tx
      .update(documentTranscripts)
      .set({
        status: "processed",
        documentType,
        issuedDate: extraction.document.issuedDate,
        output: extraction,
        model: meta.model,
        promptVersion: meta.promptVersion,
        schemaVersion: meta.schemaVersion,
        usage: meta.usage,
        durationMs: meta.durationMs,
        attempts: meta.attempts,
        error: null,
        finishedAt: new Date(),
      })
      .where(eq(documentTranscripts.id, started.id))
      .returning();

    const completed = await completeTasks(tx, row.id, ids, documentType, new Set(rows.map((draft) => draft.type)));
    const events: EventInput[] = [
      { caseId: row.id, actorId: null, type: "document.read", subjectId: started.id, summary: `${DOCUMENT_TYPES[documentType].name} přečten (${pageLabel(pageCount)}, ${rows.length} údajů).`, data: { informationCount: rows.length, skipped: skipped.length, model: meta.model } },
      ...completed.map((taskId) => ({ caseId: row.id, actorId: null, type: "task.done", subjectId: taskId, summary: "Úkol splněn nahraným dokumentem." })),
    ];
    await recordEvents(tx, events);
    return finished;
  });

  return { transcript, informationCount: rows.length };
}

// Stránky dostanou odkaz na přepis dokumentu a pořadí (1, 2, …) a popisek „2/3“.
async function attachPages(tx: Executor, transcriptId: string, pages: DocumentRow[]) {
  for (const [i, doc] of pages.entries()) {
    await tx
      .update(documents)
      .set({ transcriptId, pageNumber: i + 1, pageLabel: pages.length > 1 ? `${i + 1}/${pages.length}` : null })
      .where(eq(documents.id, doc.id));
  }
}

// Úkol čekající na tenhle dokument (submitted) se splní, když typ dokumentu nebo přečtená informace sedí s tím, co úkol chtěl.
async function completeTasks(tx: Executor, caseId: string, documentIds: string[], documentType: string, informationTypes: Set<string>) {
  const waiting = await tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.caseId, caseId), inArray(tasks.documentId, documentIds), eq(tasks.status, "submitted")));
  const done = waiting.filter((task) => task.documentType === documentType || (task.informationType !== null && informationTypes.has(task.informationType)));
  for (const task of done) {
    await tx.update(tasks).set({ status: "done", completedAt: new Date(), statusNote: null }).where(eq(tasks.id, task.id));
  }
  return done.map((task) => task.id);
}

async function patientIdentity(patientId: string) {
  const [patient] = await getDb()
    .select({ firstName: users.firstName, lastName: users.lastName, birthNumber: patients.birthNumber })
    .from(patients)
    .innerJoin(users, eq(users.id, patients.userId))
    .where(eq(patients.userId, patientId));
  return { name: patient ? `${patient.firstName} ${patient.lastName}` : null, birthNumber: patient?.birthNumber ?? null };
}

// Poznámka ke shodě pacienta smí obsahovat jen maskované RČ.
const maskRc = (text: string) => text.replace(/(\d{6})\/?\d{3,4}/g, "$1/****");

const pageLabel = (count: number) => (count === 1 ? "1 strana" : count < 5 ? `${count} strany` : `${count} stran`);
