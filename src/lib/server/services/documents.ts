import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, count, desc, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { CLIENT_DOCUMENT_TYPES, isClientDocumentType, type ClientDocumentType } from "@/db/catalog";
import { documents, events, information, tasks } from "@/db/schema";
import { isHelper, isStaff, type CaseRecord, type CurrentUser } from "@/lib/server/auth";
import { getBlobStore } from "@/lib/server/blob";
import { getDb, type Executor } from "@/lib/server/db";
import { isUniqueViolation } from "@/lib/server/db-errors";
import { recordEvent, recordEvents } from "@/lib/server/events";
import { sniffMimeType, type AllowedMimeType } from "@/lib/server/files";
import { badRequest, conflict, forbidden, hasNul, HttpError, notFound, parse } from "@/lib/server/http";

// Nahrané soubory. Originál jde do Azure Blob Storage pod klíčem bez osobních údajů (cases/<caseId>/<documentId>),
// do databáze metadata. Typ souboru se určí z obsahu; co neumíme bezpečně zobrazit, se neuloží.
// Odebraný dokument (removed_at) API nevydá nikde, soubor v úložišti zůstává.

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_REQUEST_BYTES = MAX_FILE_BYTES + 256 * 1024; // rezerva na hlavičky multipart a pole
export const MAX_DOCUMENTS_PER_CASE = 200; // pojistka proti zaplnění úložiště jedním účtem; počítají se i odebrané, soubory zůstávají

type UploadKind = ClientDocumentType | "medical"; // medical = lékařská zpráva, typ rozpozná AI

const ALLOWED_MIME: Record<UploadKind, AllowedMimeType[]> = {
  medical: ["image/jpeg", "image/png", "application/pdf"],
  portrait: ["image/jpeg", "image/png"],
  airway_photo: ["image/jpeg", "image/png"],
  consent_signature: ["image/png"],
  voice_message: ["audio/webm", "audio/mp4"],
};

const ratio = z.number().min(0).max(10).nullable().optional();
const META: Record<UploadKind, z.ZodType<Record<string, unknown>>> = {
  medical: z.strictObject({}),
  portrait: z.strictObject({}),
  airway_photo: z.strictObject({
    jawOpen: ratio,
    mouthRatio: ratio,
    luma: z.number().min(0).max(255).nullable().optional(),
    view: z.enum(["front", "profile", "extension"]).optional(), // ústa s jazykem, profil, zakloněná hlava
  }),
  consent_signature: z.strictObject({ consentVersion: z.string().trim().min(1).max(64) }),
  voice_message: z.strictObject({ seconds: z.number().int().min(0).max(600) }),
};

const fieldsSchema = z.strictObject({
  type: z.enum(CLIENT_DOCUMENT_TYPES).optional(),
  taskId: z.uuid().optional(),
  meta: z.string().max(2048).optional(),
});

type DocumentRow = typeof documents.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;

const kindOf = (doc: DocumentRow): UploadKind => (isClientDocumentType(doc.type) ? doc.type : "medical");

export function toMetadataDto(doc: DocumentRow, viewer: CurrentUser) {
  return {
    id: doc.id,
    type: doc.type,
    status: doc.status,
    uploadedAt: doc.uploadedAt,
    issuedDate: doc.issuedDate,
    pageLabel: doc.pageLabel,
    // Technická chyba čtení je pro AA; pacient vidí jen stav failed.
    ...(isStaff(viewer) ? { error: doc.error } : {}),
  };
}

// Jméno souboru jen pro zobrazení: bez cesty a řídicích znaků.
function safeFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(-200) || null;
}

function parseMeta(kind: UploadKind, raw: string | undefined) {
  let value: unknown = {};
  if (raw !== undefined) {
    if (hasNul(raw)) throw badRequest("Neplatné údaje.", [{ path: "meta", message: "Neplatné znaky." }]);
    try {
      value = JSON.parse(raw);
    } catch {
      throw badRequest("Neplatné údaje.", [{ path: "meta", message: "meta musí být JSON." }]);
    }
  }
  const result = META[kind].safeParse(value);
  if (!result.success) throw badRequest("Neplatné údaje.", result.error.issues.map((i) => ({ path: ["meta", ...i.path].join("."), message: i.message })));
  return result.data;
}

async function findBySha(caseId: string, sha256: string) {
  const [row] = await getDb().select().from(documents).where(and(eq(documents.caseId, caseId), eq(documents.sha256, sha256), isNull(documents.removedAt)));
  return row ?? null;
}

// Úkol, přes který se nahrává: musí patřit k zákroku, čekat na soubor a sedět s druhem souboru.
async function uploadTask(actor: CurrentUser, caseId: string, taskId: string, kind: UploadKind) {
  const [task] = await getDb().select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.caseId, caseId)));
  if (!task || (!isStaff(actor) && task.assignee !== "patient")) throw notFound("Úkol nenalezen.");
  if (task.kind !== "upload") throw badRequest("Neplatné údaje.", [{ path: "taskId", message: "K tomuto úkolu se soubor nenahrává." }]);
  const expected: UploadKind = isClientDocumentType(task.documentType) ? task.documentType : "medical";
  if (expected !== kind) throw badRequest("Neplatné údaje.", [{ path: "taskId", message: "Soubor k tomuto úkolu nepatří." }]);
  if (task.status === "cancelled") throw conflict("Úkol je zrušený.");
  return task;
}

// Lékařskou zprávu ještě čte AI (submitted), fotka, podpis a hlasovka úkol rovnou splní. Hotový úkol zůstane hotový.
async function advanceTask(tx: Executor, actor: CurrentUser, task: TaskRow, documentId: string, kind: UploadKind) {
  const waiting = task.status === "open" || task.status === "snoozed";
  const progress =
    kind !== "medical"
      ? waiting || task.status === "submitted"
        ? { status: "done" as const, completedBy: actor.id, completedAt: new Date(), statusNote: null, snoozedUntil: null }
        : {}
      : waiting
        ? { status: "submitted" as const, statusNote: null, snoozedUntil: null }
        : {};
  await tx.update(tasks).set({ documentId, ...progress }).where(eq(tasks.id, task.id));
}

// Stejný soubor už v zákroku je: vrátí se existující dokument a úkol se posune, jako by se nahrál znovu.
// Stejné bajty jako jiný druh (fotka znovu jako podpis) by vrátily cizí dokument, proto 409.
async function reuseExisting(actor: CurrentUser, existing: DocumentRow, kind: UploadKind, task: TaskRow | null) {
  if (kindOf(existing) !== kind) throw conflict("Stejný soubor už je nahraný jako jiný druh dokumentu.");
  if (task) {
    await getDb().transaction(async (tx) => {
      await advanceTask(tx, actor, task, existing.id, kind);
      await recordEvent(tx, { caseId: existing.caseId, actorId: actor.id, type: "task.document_attached", subjectId: task.id, summary: "K úkolu připojen už nahraný dokument." });
    });
  }
  return existing;
}

export async function uploadDocument(actor: CurrentUser, row: CaseRecord, form: FormData): Promise<{ created: boolean; document: DocumentRow }> {
  // Pacient nahrává jen do běžícího zákroku. AA smí doplnit dokument i do uzavřeného.
  if (!isStaff(actor) && row.status !== "new" && row.status !== "active") throw conflict("Zákrok už neběží, nahrát do něj nejde.");
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw badRequest("Neplatné údaje.", [{ path: "file", message: "Chybí soubor." }]);
  if (file.size > MAX_FILE_BYTES) throw new HttpError(413, "Soubor je větší než 10 MB.");
  const fields = parse(fieldsSchema, Object.fromEntries([...form.entries()].filter(([key]) => key !== "file")));
  const kind: UploadKind = fields.type ?? "medical";
  // Souhlas s anestezií je právní úkon pacienta, pomocník z rodiny ho za něj podepsat nesmí.
  if (kind === "consent_signature" && isHelper(actor)) throw forbidden("Souhlas s anestezií podepisuje jen pacient sám.");
  const meta = parseMeta(kind, fields.meta);

  const data = new Uint8Array(await file.arrayBuffer());
  const mimeType = sniffMimeType(data);
  if (!mimeType || !ALLOWED_MIME[kind].includes(mimeType)) throw new HttpError(415, "Tento typ souboru sem nejde nahrát.");

  const db = getDb();
  const task = fields.taskId ? await uploadTask(actor, row.id, fields.taskId, kind) : null;

  const sha256 = createHash("sha256").update(data).digest("hex");
  const existing = await findBySha(row.id, sha256);
  if (existing) return { created: false, document: await reuseExisting(actor, existing, kind, task) };

  const [{ total }] = await db.select({ total: count() }).from(documents).where(eq(documents.caseId, row.id));
  if (total >= MAX_DOCUMENTS_PER_CASE) throw conflict("Zákrok má už příliš mnoho dokumentů.");

  const documentId = randomUUID();
  const filePath = `cases/${row.id}/${documentId}`;
  const blobs = getBlobStore();
  await blobs.put(filePath, data, mimeType);

  const isClientFile = kind !== "medical";
  const now = new Date();
  try {
    const document = await db.transaction(async (tx) => {
      const [doc] = await tx
        .insert(documents)
        .values({
          id: documentId,
          caseId: row.id,
          taskId: task?.id ?? null,
          uploadedBy: actor.id,
          filePath,
          fileName: safeFileName(file.name),
          mimeType,
          sha256,
          meta,
          // Fotku, podpis a hlasovku AI nečte, jsou hotové hned. Lékařská zpráva čeká na čtení (klient pak volá /transcribe a /transcripts).
          status: isClientFile ? "processed" : "uploaded",
          type: isClientFile ? kind : null,
          processedAt: isClientFile ? now : null,
        })
        .returning();
      if (task) await advanceTask(tx, actor, task, doc.id, kind);
      await recordEvent(tx, { caseId: row.id, actorId: actor.id, type: "document.uploaded", subjectId: doc.id, summary: "Nahrán dokument.", data: { kind } });
      return doc;
    });
    return { created: true, document };
  } catch (error) {
    // Bez řádku v databázi by soubor v úložišti nikdo nenašel ani nesmazal.
    await blobs.delete(filePath).catch((e: unknown) => console.error("Úložiště: osiřelý soubor se nepodařilo smazat:", e instanceof Error ? e.message : e));
    if (isUniqueViolation(error, "documents_case_sha256_key")) {
      const raced = await findBySha(row.id, sha256);
      if (raced) return { created: false, document: await reuseExisting(actor, raced, kind, task) };
    }
    throw error;
  }
}

// Přístup k zákroku ověřuje route handler; pacient vidí všechny dokumenty svého zákroku, i ty od AA.
export async function findDocument(caseId: string, documentId: string) {
  const [doc] = await getDb().select().from(documents).where(and(eq(documents.id, documentId), eq(documents.caseId, caseId), isNull(documents.removedAt)));
  if (!doc) throw notFound("Dokument nenalezen.");
  return doc;
}

// ---------------------------------------------------------------------------
// Odebrání
// ---------------------------------------------------------------------------

// Odebrání dokumentu (i fotky, podpisu a hlasovky): pacient jen svůj a jen dokud s ním AA nepracovala, AA cokoli.
// Nic se nemaže natvrdo: dokument dostane removed_at, soubor v úložišti zůstane. Neověřené hodnoty od AI z dokumentu
// zmizí (jako při novém čtení), ověřené dostanou rejected. Úkol, který dokument splnil, přejde na jiný dokument
// nahraný přes stejný úkol, jinak se znovu otevře.
export async function removeDocument(actor: CurrentUser, row: CaseRecord, documentId: string) {
  const doc = await findDocument(row.id, documentId);
  if (!isStaff(actor)) {
    if (doc.uploadedBy !== actor.id) throw forbidden("Smazat můžete jen to, co jste nahráli vy.");
    if (row.status !== "new" && row.status !== "active") throw conflict("Zákrok už neběží, dokument nejde smazat.");
    if (await handledByStaff(doc)) throw conflict("Ambulance už s dokumentem pracovala, smazat ho může jen ona.");
  }
  const now = new Date();
  await getDb().transaction(async (tx) => {
    const [removed] = await tx
      .update(documents)
      .set({ removedAt: now, removedBy: actor.id })
      .where(and(eq(documents.id, doc.id), isNull(documents.removedAt)))
      .returning({ id: documents.id });
    if (!removed) throw notFound("Dokument nenalezen.");
    await tx.delete(information).where(and(eq(information.documentId, doc.id), eq(information.status, "ai_extracted")));
    await tx
      .update(information)
      .set({ status: "rejected", verifiedBy: actor.id, verifiedAt: now, note: "Dokument odebrán." })
      .where(and(eq(information.documentId, doc.id), eq(information.status, "verified")));
    const reopened = await detachFromTasks(tx, doc.id);
    await recordEvents(tx, [
      { caseId: row.id, actorId: actor.id, type: "document.removed", subjectId: doc.id, summary: "Dokument odebrán.", data: { kind: kindOf(doc) } },
      ...reopened.map((task) => ({ caseId: row.id, actorId: actor.id, type: "task.open", subjectId: task.id, summary: `Úkol ${task.title}: open (dokument odebrán).`, data: { from: task.status } })),
    ]);
  });
}

// AA s dokumentem pracovala: potvrdila vazbu na pacienta, nebo ověřila či zamítla hodnotu z něj.
async function handledByStaff(doc: DocumentRow) {
  if (doc.patientMatchCheckedBy) return true;
  const [handled] = await getDb()
    .select({ id: information.id })
    .from(information)
    .where(and(eq(information.documentId, doc.id), ne(information.status, "ai_extracted")))
    .limit(1);
  return Boolean(handled);
}

async function detachFromTasks(tx: Executor, documentId: string) {
  const linked = await tx.select().from(tasks).where(eq(tasks.documentId, documentId));
  const reopened: TaskRow[] = [];
  for (const task of linked) {
    // Jiná stránka nebo novější fotka nahraná přes stejný úkol úkol splňuje dál.
    const [other] = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.taskId, task.id), isNull(documents.removedAt)))
      .orderBy(desc(documents.uploadedAt))
      .limit(1);
    if (other) {
      await tx.update(tasks).set({ documentId: other.id }).where(eq(tasks.id, task.id));
      continue;
    }
    const fulfilled = task.status === "submitted" || task.status === "done";
    await tx
      .update(tasks)
      .set({ documentId: null, ...(fulfilled ? { status: "open" as const, completedBy: null, completedAt: null } : {}) })
      .where(eq(tasks.id, task.id));
    if (fulfilled) reopened.push(task);
  }
  return reopened;
}

// Zaměstnanec otevřel dokument (stránka dokumentu v ambulanci). Do časové osy jde jen první otevření,
// kdy a kdo, z něj je krok „Viděno“ u vyžádaných dokumentů. Další otevření nic nezapíšou.
export const DOCUMENT_SEEN = "document.seen";

export async function markDocumentSeen(actor: CurrentUser, caseId: string, documentId: string) {
  await getDb().transaction(async (tx) => {
    const [doc] = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.caseId, caseId), isNull(documents.removedAt)));
    if (!doc) throw notFound("Dokument nenalezen.");
    const [seen] = await tx
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.caseId, caseId), eq(events.type, DOCUMENT_SEEN), eq(events.subjectId, documentId)))
      .limit(1);
    if (!seen) await recordEvent(tx, { caseId, actorId: actor.id, type: DOCUMENT_SEEN, subjectId: documentId, summary: "Dokument viděl zaměstnanec ambulance." });
  });
}

export async function documentContent(caseId: string, documentId: string): Promise<Response> {
  const doc = await findDocument(caseId, documentId);
  const blob = await getBlobStore().get(doc.filePath);
  if (!blob) throw notFound("Soubor není k dispozici.");
  const headers: Record<string, string> = {
    // Typ z databáze (zjištěný z obsahu při nahrání), ne z úložiště.
    "content-type": doc.mimeType,
    "x-content-type-options": "nosniff",
    // Cache vypnutá, ať se po změně nebo odhlášení neukazuje stará verze.
    "cache-control": "private, no-store",
    "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.fileName ?? "dokument")}`,
  };
  if (blob.contentLength !== undefined) headers["content-length"] = String(blob.contentLength);
  return new Response(blob.body, { headers });
}
