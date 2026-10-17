import "server-only";
import { and, asc, eq, inArray, isNull, ne, type SQL } from "drizzle-orm";
import { z } from "zod";
import { DOCUMENT_TYPES, INFORMATION_TYPES } from "@/db/catalog";
import { information, taskKind, taskStatus, tasks, userRole } from "@/db/schema";
import { parseInformationValue } from "@/db/values";
import { isStaff, type CaseRecord, type CurrentUser } from "@/lib/server/auth";
import { todayInPrague } from "@/lib/server/dates";
import { getDb, type Executor } from "@/lib/server/db";
import { recordEvent } from "@/lib/server/events";
import { isUniqueViolation } from "@/lib/server/db-errors";
import { badRequest, conflict, forbidden, notFound } from "@/lib/server/http";
import { isoDate, isoDateTime } from "@/lib/server/validation";

// Úkoly zákroku. Vytváří a mění je AA. Pacient úkol splní nahráním dokumentu, odpovědí na otázku
// nebo nahlášením akce (PATCH jen na svých úkolech, viz patientUpdate).

const documentType = z.enum(Object.keys(DOCUMENT_TYPES) as [keyof typeof DOCUMENT_TYPES, ...(keyof typeof DOCUMENT_TYPES)[]]);
const informationType = z.enum(Object.keys(INFORMATION_TYPES) as [keyof typeof INFORMATION_TYPES, ...(keyof typeof INFORMATION_TYPES)[]]);

// Co úkol potřebuje (stejné pravidlo hlídá i CHECK v databázi): upload potřebuje typ dokumentu nebo informace, otázka typ informace.
export function targetIssues(task: { kind: string; documentType?: string | null; informationType?: string | null }) {
  if (task.kind === "upload" && !task.documentType && !task.informationType) return [{ path: "documentType", message: "Úkol nahrát dokument potřebuje typ dokumentu nebo informace." }];
  if (task.kind === "question" && !task.informationType) return [{ path: "informationType", message: "Otázka potřebuje typ informace." }];
  return [];
}

export const taskTargetFields = {
  assignee: z.enum(userRole.enumValues).exclude(["helper"]), // úkoly patří pacientovi nebo AA, pomocník dělá pacientovy
  kind: z.enum(taskKind.enumValues),
  title: z.string().trim().min(1).max(200),
  instructions: z.string().trim().max(2000).nullable().optional(),
  documentType: documentType.nullable().optional(),
  informationType: informationType.nullable().optional(),
  validForDays: z.number().int().min(1).max(3650).nullable().optional(),
  isRequired: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
};

export const createTaskSchema = z
  .strictObject({
    ...taskTargetFields,
    dueDate: isoDate.nullable().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
    process: z.enum(["pbm"]).nullable().optional(),
  })
  .superRefine((task, ctx) => targetIssues(task).forEach((issue) => ctx.addIssue({ code: "custom", path: [issue.path], message: issue.message })));

export const patchTaskSchema = z
  .strictObject({
    status: z.enum(taskStatus.enumValues).exclude(["submitted"]), // submitted nastaví nahrání dokumentu, ne člověk
    statusNote: z.string().trim().min(1).max(1000).nullable().optional(),
    snoozedUntil: isoDateTime.nullable().optional(),
    answer: z.unknown().optional(), // odpověď na otázku, tvar podle typu informace (db/values.ts); u seznamu (alergie, léky) i pole položek
  })
  .superRefine((patch, ctx) => {
    if ((patch.status === "cancelled" || patch.status === "snoozed") && !patch.statusNote) ctx.addIssue({ code: "custom", path: ["statusNote"], message: "Uveďte důvod." });
    if (patch.status === "snoozed" && !patch.snoozedUntil) ctx.addIssue({ code: "custom", path: ["snoozedUntil"], message: "Uveďte, do kdy je úkol odložený." });
    if (patch.answer !== undefined && patch.status !== "done") ctx.addIssue({ code: "custom", path: ["answer"], message: "Odpověď jde uložit jen s hotovým úkolem." });
  });

export const listTasksSchema = z.strictObject({
  status: z.enum(taskStatus.enumValues).optional(),
  assignee: z.enum(userRole.enumValues).exclude(["helper"]).optional(),
});

type TaskRow = typeof tasks.$inferSelect;

// Výčet polí, která jdou ven. Pacient nevidí interní podklady upozornění (evidence s hodnotami, alertKey).
function toDto(task: TaskRow, viewer: CurrentUser) {
  const dto = {
    id: task.id,
    caseId: task.caseId,
    sortOrder: task.sortOrder,
    assignee: task.assignee,
    assigneeId: task.assigneeId,
    kind: task.kind,
    title: task.title,
    instructions: task.instructions,
    documentType: task.documentType,
    informationType: task.informationType,
    validForDays: task.validForDays,
    isRequired: task.isRequired,
    dueDate: task.dueDate,
    documentId: task.documentId,
    informationId: task.informationId,
    status: task.status,
    statusNote: task.statusNote,
    snoozedUntil: task.snoozedUntil,
    readAt: task.readAt,
    process: task.process,
    payload: task.payload,
    approvedBy: task.approvedBy,
    approvedAt: task.approvedAt,
    createdBy: task.createdBy,
    createdAt: task.createdAt,
    completedBy: task.completedBy,
    completedAt: task.completedAt,
  };
  return isStaff(viewer) ? { ...dto, alertKey: task.alertKey, evidence: task.evidence, templateTaskId: task.templateTaskId } : dto;
}

export async function listTasks(viewer: CurrentUser, caseId: string, filters: z.infer<typeof listTasksSchema>) {
  const conditions: (SQL | undefined)[] = [
    eq(tasks.caseId, caseId),
    filters.status ? eq(tasks.status, filters.status) : undefined,
    isStaff(viewer) ? (filters.assignee ? eq(tasks.assignee, filters.assignee) : undefined) : eq(tasks.assignee, "patient"),
  ];
  const rows = await getDb().select().from(tasks).where(and(...conditions)).orderBy(asc(tasks.sortOrder), asc(tasks.createdAt));
  return rows.map((row) => toDto(row, viewer));
}

async function findTask(caseId: string, taskId: string) {
  const [row] = await getDb().select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.caseId, caseId)));
  if (!row) throw notFound("Úkol nenalezen.");
  return row;
}

export async function getTask(viewer: CurrentUser, caseId: string, taskId: string) {
  const row = await findTask(caseId, taskId);
  if (!isStaff(viewer) && row.assignee !== "patient") throw notFound("Úkol nenalezen.");
  return toDto(row, viewer);
}

export async function createTask(actor: CurrentUser, caseId: string, input: z.infer<typeof createTaskSchema>) {
  const now = new Date();
  // Klinicky významná akce směrem k pacientovi (odběr, výsledky krve kvůli Hb) je schválená tím, kdo ji v AA zadal.
  const approval = input.assignee === "patient" && (input.kind === "action" || input.process === "pbm") ? { approvedBy: actor.id, approvedAt: now } : {};
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(tasks)
      .values({ ...input, caseId, payload: input.payload ?? {}, createdBy: actor.id, status: "open", ...approval })
      .returning();
    await recordEvent(tx, { caseId, actorId: actor.id, type: "task.created", subjectId: row.id, summary: `Nový úkol: ${row.title}.` });
    return toDto(row, actor);
  });
}

type PatchTask = z.infer<typeof patchTaskSchema>;
type PatchStatus = PatchTask["status"];

// Z jakých stavů se do cílového dá přejít. Hotový a zrušený úkol jde jen znovu otevřít, ať se neztratí, kdo ho uzavřel.
const ALLOWED_FROM: Record<PatchStatus, TaskRow["status"][]> = {
  open: ["submitted", "done", "snoozed", "cancelled"],
  done: ["open", "submitted", "snoozed"],
  snoozed: ["open", "submitted", "snoozed"],
  cancelled: ["open", "submitted", "snoozed"],
};

const NOT_CLOSED: TaskRow["status"][] = ["open", "submitted", "snoozed"];

export async function updateTask(actor: CurrentUser, row: CaseRecord, taskId: string, patch: PatchTask) {
  const current = await findTask(row.id, taskId);
  if (!isStaff(actor)) return patientUpdate(actor, row, current, patch);

  // Nová odpověď na hotovou otázku nahradí předchozí, jinak platí přechody výše.
  const reanswer = patch.answer !== undefined && current.status === "done";
  if (!reanswer && !ALLOWED_FROM[patch.status].includes(current.status)) throw conflict(`Úkol ve stavu ${current.status} nejde přepnout na ${patch.status}.`);
  if (patch.answer !== undefined && current.kind !== "question") throw badRequest("Neplatné údaje.", [{ path: "answer", message: "Odpověď patří jen k otázce." }]);
  const now = new Date();
  const set = {
    status: patch.status,
    statusNote: patch.statusNote ?? null,
    snoozedUntil: patch.status === "snoozed" ? new Date(patch.snoozedUntil!) : null,
    completedBy: patch.status === "done" ? actor.id : null,
    completedAt: patch.status === "done" ? now : null,
    // Znovu otevřený úkol je pro pacienta zase nový.
    ...(patch.status === "open" && (current.status === "done" || current.status === "cancelled") ? { readAt: null } : {}),
  };
  try {
    const updated = await getDb().transaction(async (tx) => {
      if (patch.answer !== undefined) return saveAnswer(tx, actor, current, patch.answer);
      const [result] = await tx.update(tasks).set(set).where(eq(tasks.id, current.id)).returning();
      await recordEvent(tx, { caseId: row.id, actorId: actor.id, type: `task.${patch.status}`, subjectId: result.id, summary: `Úkol ${result.title}: ${patch.status}.`, data: { from: current.status } });
      return result;
    });
    return toDto(updated, actor);
  } catch (error) {
    if (isUniqueViolation(error, "tasks_open_alert_key")) throw conflict("Na toto upozornění už je otevřený jiný úkol.");
    throw error;
  }
}

// Pacient smí jen hlásit splnění svých úkolů: otázku odpoví (hotovo hned), akci (odběr) nahlásí a potvrdí ji AA
// (submitted, PBM do té doby běží dál). Dokument se nahrává přes /documents. Odložit, zrušit a otevřít smí jen AA.
async function patientUpdate(actor: CurrentUser, row: CaseRecord, current: TaskRow, patch: PatchTask) {
  if (current.assignee !== "patient") throw notFound("Úkol nenalezen.");
  if (patch.status !== "done") throw forbidden("Úkol může odložit, zrušit nebo znovu otevřít jen ambulance.");
  if (row.status !== "new" && row.status !== "active") throw conflict("Zákrok už neběží, úkol nejde změnit.");
  if (current.status === "cancelled") throw conflict("Úkol je zrušený.");
  if (current.kind === "upload") throw conflict("Úkol se splní nahráním dokumentu.");

  if (current.kind === "question") {
    if (patch.answer === undefined) throw badRequest("Neplatné údaje.", [{ path: "answer", message: "Chybí odpověď." }]);
    const updated = await getDb().transaction((tx) => saveAnswer(tx, actor, current, patch.answer));
    return toDto(updated, actor);
  }

  if (patch.answer !== undefined) throw badRequest("Neplatné údaje.", [{ path: "answer", message: "Odpověď patří jen k otázce." }]);
  if (current.status === "submitted" || current.status === "done") return toDto(current, actor); // už nahlášeno
  const updated = await getDb().transaction(async (tx) => {
    const [result] = await tx.update(tasks).set({ status: "submitted", statusNote: null, snoozedUntil: null }).where(eq(tasks.id, current.id)).returning();
    await recordEvent(tx, { caseId: row.id, actorId: actor.id, type: "task.submitted", subjectId: result.id, summary: `Pacient hlásí splněno: ${result.title}.`, data: { from: current.status } });
    return result;
  });
  return toDto(updated, actor);
}

// Odpověď na otázku je informace (typ z úkolu, information.task_id = úkol). Zadal ji člověk, proto vzniká rovnou
// ověřená (verified_by = kdo odpověděl), AI ji nečetla. U typů se seznamem (alergie, léky) může být pole položek.
// Nová odpověď na stejný úkol nahradí předchozí (ta dostane rejected s poznámkou).
async function saveAnswer(tx: Executor, actor: CurrentUser, task: TaskRow, answer: unknown) {
  const type = task.informationType!; // otázka má typ informace vždy (CHECK tasks_target)
  const isList = Array.isArray(answer) && Object.hasOwn(INFORMATION_TYPES, type) && "list" in INFORMATION_TYPES[type as keyof typeof INFORMATION_TYPES];
  const items: unknown[] = isList ? (answer as unknown[]) : [answer];
  if (items.length === 0 || items.length > 50) throw badRequest("Neplatné údaje.", [{ path: "answer", message: "Uveďte 1 až 50 položek." }]);
  const values = items.map((item, i) => {
    const parsed = parseInformationValue(type, item);
    if (parsed.success) return parsed.value;
    const prefix = isList ? `answer.${i}` : "answer";
    throw badRequest("Neplatné údaje.", parsed.issues.map((issue) => ({ ...issue, path: issue.path === "type" ? prefix : issue.path.replace(/^value/, prefix) })));
  });

  const now = new Date();
  const replaced = await tx
    .update(information)
    .set({ status: "rejected", verifiedBy: actor.id, verifiedAt: now, note: "Nahrazeno novou odpovědí." })
    .where(and(eq(information.taskId, task.id), ne(information.status, "rejected")))
    .returning({ id: information.id });
  const inserted = await tx
    .insert(information)
    .values(
      values.map((value) => ({
        caseId: task.caseId,
        type,
        value,
        observedDate: todayInPrague(),
        status: "verified" as const,
        enteredBy: actor.id,
        verifiedBy: actor.id,
        verifiedAt: now,
        taskId: task.id,
        replacesId: replaced.length === 1 && values.length === 1 ? replaced[0].id : null,
      })),
    )
    .returning({ id: information.id });
  const [updated] = await tx
    .update(tasks)
    .set({ status: "done", informationId: inserted[0].id, statusNote: null, snoozedUntil: null, completedBy: actor.id, completedAt: now })
    .where(eq(tasks.id, task.id))
    .returning();
  await recordEvent(tx, {
    caseId: task.caseId,
    actorId: actor.id,
    type: "task.answered",
    subjectId: task.id,
    summary: `Odpověď na úkol: ${task.title}.`,
    data: { informationIds: inserted.map((r) => r.id), replaced: replaced.map((r) => r.id) },
  });
  return updated;
}

// Pacient otevřel přehled zákroku: jeho neuzavřené úkoly jsou přečtené. Zapíše se jen poprvé, další zobrazení nic nemění.
export async function markTasksRead(patient: CurrentUser, caseId: string) {
  await getDb().transaction(async (tx) => {
    const read = await tx
      .update(tasks)
      .set({ readAt: new Date() })
      .where(and(eq(tasks.caseId, caseId), eq(tasks.assignee, "patient"), inArray(tasks.status, NOT_CLOSED), isNull(tasks.readAt)))
      .returning({ id: tasks.id });
    if (read.length) {
      await recordEvent(tx, { caseId, actorId: patient.id, type: "task.read", summary: `Pacient si zobrazil úkoly (${read.length}).`, data: { taskIds: read.map((t) => t.id) } });
    }
  });
}
