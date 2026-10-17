import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { caseStatus, cases, information, patients, tasks, templateTasks, templates, users } from "@/db/schema";
import type { CaseRecord, CurrentUser } from "@/lib/server/auth";
import { ageOn, subtractDays, todayInPrague } from "@/lib/server/dates";
import { getDb, type Executor } from "@/lib/server/db";
import { recordEvent } from "@/lib/server/events";
import { badRequest, conflict } from "@/lib/server/http";
import { diagnosisSchema, isoDate, isoDateTime, likePattern, type Diagnosis } from "@/lib/server/validation";

// Zákroky: založení (i ze šablony), seznam, úprava. Diagnóza je informace typu 'diagnosis', ne sloupec zákroku.

const caseFields = {
  procedureName: z.string().trim().min(1).max(200),
  diagnosis: diagnosisSchema,
  surgeryDate: isoDate.nullable(),
  aaVisitAt: isoDateTime.nullable(),
  bloodLossMl: z.number().int().min(0).max(20_000).nullable(),
  isOncological: z.boolean(),
  contactId: z.uuid(),
};

export const caseInputSchema = z.strictObject({
  templateId: z.uuid().optional(),
  procedureName: caseFields.procedureName.optional(),
  diagnosis: caseFields.diagnosis,
  surgeryDate: caseFields.surgeryDate.optional(),
  aaVisitAt: caseFields.aaVisitAt.optional(),
  bloodLossMl: caseFields.bloodLossMl.optional(),
  isOncological: caseFields.isOncological.optional(),
  contactId: caseFields.contactId.optional(),
});
export type CaseInput = z.infer<typeof caseInputSchema>;

export const createCaseSchema = caseInputSchema.extend({ patientId: z.uuid() });

export const patchCaseSchema = z.strictObject({
  procedureName: caseFields.procedureName.optional(),
  diagnosis: caseFields.diagnosis.optional(),
  surgeryDate: caseFields.surgeryDate.optional(),
  aaVisitAt: caseFields.aaVisitAt.optional(),
  bloodLossMl: caseFields.bloodLossMl.optional(),
  isOncological: caseFields.isOncological.optional(),
  contactId: caseFields.contactId.optional(),
  // Uzavírá se jen exportem (POST /close), ať je u toho záznam, kdo a kdy uzavřel.
  status: z.enum(caseStatus.enumValues.filter((status) => status !== "closed") as ["new", "active", "cancelled"]).optional(),
});

export const CASE_CLOSED = "case.closed";

export const listCasesSchema = z.strictObject({
  from: isoDate.optional(),
  to: isoDate.optional(),
  status: z.enum(caseStatus.enumValues).optional(),
  q: z.string().trim().max(100).optional(),
});

export type CaseDto = {
  id: string;
  status: CaseRecord["status"];
  procedureName: string | null;
  diagnosis: Diagnosis | null;
  surgeryDate: string | null;
  aaVisitAt: Date | null;
  bloodLossMl: number | null;
  isOncological: boolean;
  templateId: string | null;
  contact: { id: string; displayName: string; phone: string | null } | null;
  patient: { id: string; firstName: string; lastName: string; externalId: string | null };
  aaSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

// ---------------------------------------------------------------------------
// Čtení
// ---------------------------------------------------------------------------

export async function loadCaseDtos(db: Executor, rows: CaseRecord[]): Promise<CaseDto[]> {
  if (rows.length === 0) return [];
  const patientIds = [...new Set(rows.map((r) => r.patientId))];
  const contactIds = [...new Set(rows.map((r) => r.contactId).filter((id): id is string => id !== null))];
  const [patientRows, contactRows, diagnosisRows] = await Promise.all([
    db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, externalId: patients.externalId })
      .from(users)
      .innerJoin(patients, eq(patients.userId, users.id))
      .where(inArray(users.id, patientIds)),
    contactIds.length
      ? db.select({ id: users.id, displayName: users.displayName, phone: users.phone }).from(users).where(inArray(users.id, contactIds))
      : Promise.resolve([]),
    latestDiagnoses(db, rows.map((r) => r.id)),
  ]);
  const patientById = new Map(patientRows.map((p) => [p.id, p]));
  const contactById = new Map(contactRows.map((c) => [c.id, c]));
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    procedureName: row.procedureName,
    diagnosis: diagnosisRows.get(row.id) ?? null,
    surgeryDate: row.surgeryDate,
    aaVisitAt: row.aaVisitAt,
    bloodLossMl: row.bloodLossMl,
    isOncological: row.isOncological,
    templateId: row.templateId,
    contact: row.contactId ? (contactById.get(row.contactId) ?? null) : null,
    patient: patientById.get(row.patientId)!,
    aaSeenAt: row.aaSeenAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

async function latestDiagnoses(db: Executor, caseIds: string[]) {
  const rows = await db
    .selectDistinctOn([information.caseId], { caseId: information.caseId, value: information.value })
    .from(information)
    .where(and(inArray(information.caseId, caseIds), eq(information.type, "diagnosis"), ne(information.status, "rejected")))
    .orderBy(information.caseId, desc(information.createdAt));
  return new Map(rows.map((r) => [r.caseId, r.value as Diagnosis]));
}

export async function getCaseDto(caseId: string, db: Executor = getDb()) {
  const [row] = await db.select().from(cases).where(eq(cases.id, caseId));
  return (await loadCaseDtos(db, [row]))[0];
}

export async function listCases(filters: z.infer<typeof listCasesSchema>) {
  const db = getDb();
  const conditions: (SQL | undefined)[] = [
    filters.status ? eq(cases.status, filters.status) : ne(cases.status, "cancelled"),
    filters.from ? gte(cases.surgeryDate, filters.from) : undefined,
    filters.to ? lte(cases.surgeryDate, filters.to) : undefined,
  ];
  if (filters.q) {
    const pattern = likePattern(filters.q);
    conditions.push(or(ilike(users.firstName, pattern), ilike(users.lastName, pattern), ilike(patients.externalId, pattern), ilike(cases.procedureName, pattern)));
  }
  const rows = await db
    .select({ row: cases })
    .from(cases)
    .innerJoin(patients, eq(patients.userId, cases.patientId))
    .innerJoin(users, eq(users.id, cases.patientId))
    .where(and(...conditions))
    .orderBy(sql`${cases.surgeryDate} asc nulls last`, asc(cases.createdAt))
    .limit(500);
  return loadCaseDtos(db, rows.map((r) => r.row));
}

// ---------------------------------------------------------------------------
// Zápis
// ---------------------------------------------------------------------------

async function assertStaffContact(tx: Executor, contactId: string) {
  const [row] = await tx.select({ role: users.role }).from(users).where(eq(users.id, contactId));
  if (row?.role !== "aa") throw badRequest("Neplatné údaje.", [{ path: "contactId", message: "Kontaktní osoba musí být z AA." }]);
}

async function insertDiagnosis(tx: Executor, actor: CurrentUser, caseId: string, diagnosis: Diagnosis, replacesId: string | null = null) {
  const now = new Date();
  const [row] = await tx
    .insert(information)
    .values({ caseId, type: "diagnosis", value: diagnosis, status: "verified", enteredBy: actor.id, verifiedBy: actor.id, verifiedAt: now, replacesId })
    .returning({ id: information.id });
  return row.id;
}

export async function createCase(tx: Executor, actor: CurrentUser, input: CaseInput & { patientId: string }): Promise<string> {
  const [patient] = await tx.select({ birthDate: patients.birthDate }).from(patients).where(eq(patients.userId, input.patientId));
  if (!patient) throw badRequest("Neplatné údaje.", [{ path: "patientId", message: "Pacient neexistuje." }]);

  const template = input.templateId ? await templateForCase(tx, input.templateId) : null;
  const procedureName = input.procedureName ?? template?.name;
  if (!procedureName) throw badRequest("Neplatné údaje.", [{ path: "procedureName", message: "Vyplňte výkon, nebo vyberte šablonu." }]);
  const contactId = input.contactId ?? actor.id;
  await assertStaffContact(tx, contactId);

  const surgeryDate = input.surgeryDate ?? null;
  const [row] = await tx
    .insert(cases)
    .values({
      patientId: input.patientId,
      templateId: template?.id ?? null,
      status: "active", // zakládá AA, potvrzení není potřeba
      procedureName,
      surgeryDate,
      aaVisitAt: input.aaVisitAt ? new Date(input.aaVisitAt) : null,
      bloodLossMl: input.bloodLossMl !== undefined ? input.bloodLossMl : (template?.bloodLossMl ?? null),
      isOncological: input.isOncological ?? false,
      contactId,
      createdBy: actor.id,
    })
    .returning({ id: cases.id });

  await insertDiagnosis(tx, actor, row.id, input.diagnosis);
  if (template) await copyTemplateTasks(tx, actor, row.id, template.tasks, patient.birthDate, surgeryDate);
  await recordEvent(tx, { caseId: row.id, actorId: actor.id, type: "case.created", subjectId: row.id, summary: `Založen zákrok: ${procedureName}.` });
  return row.id;
}

async function templateForCase(tx: Executor, templateId: string) {
  const [template] = await tx.select().from(templates).where(and(eq(templates.id, templateId), eq(templates.isActive, true)));
  if (!template) throw badRequest("Neplatné údaje.", [{ path: "templateId", message: "Šablona neexistuje nebo není aktivní." }]);
  const rows = await tx.select().from(templateTasks).where(eq(templateTasks.templateId, templateId)).orderBy(asc(templateTasks.sortOrder));
  return { ...template, tasks: rows };
}

// Kopie, ne odkaz: pozdější změna šablony běžící zákroky nerozbije.
async function copyTemplateTasks(tx: Executor, actor: CurrentUser, caseId: string, items: (typeof templateTasks.$inferSelect)[], birthDate: string, surgeryDate: string | null) {
  const age = ageOn(birthDate, surgeryDate ?? todayInPrague());
  const now = new Date();
  const rows = items
    .filter((t) => t.appliesFromAge === null || age >= t.appliesFromAge)
    .map((t) => ({
      caseId,
      templateTaskId: t.id,
      sortOrder: t.sortOrder,
      assignee: t.assignee,
      kind: t.kind,
      title: t.title,
      instructions: t.instructions,
      documentType: t.documentType,
      informationType: t.informationType,
      validForDays: t.validForDays,
      isRequired: t.isRequired,
      dueDate: surgeryDate && t.dueDaysBeforeSurgery !== null ? subtractDays(surgeryDate, t.dueDaysBeforeSurgery) : null,
      createdBy: actor.id,
      // Výběrem šablony lékař úkoly vyžádal, akce pro pacienta jsou tím schválené.
      ...(t.assignee === "patient" && t.kind === "action" ? { approvedBy: actor.id, approvedAt: now } : {}),
    }));
  if (rows.length) await tx.insert(tasks).values(rows);
}

export async function updateCase(actor: CurrentUser, row: CaseRecord, patch: z.infer<typeof patchCaseSchema>) {
  const db = getDb();
  await db.transaction(async (tx) => {
    if (patch.contactId) await assertStaffContact(tx, patch.contactId);
    const { diagnosis, aaVisitAt, ...fields } = patch;
    const set = { ...fields, ...(aaVisitAt !== undefined ? { aaVisitAt: aaVisitAt ? new Date(aaVisitAt) : null } : {}) };
    if (Object.keys(set).length) await tx.update(cases).set(set).where(eq(cases.id, row.id));

    if (diagnosis) await replaceDiagnosis(tx, actor, row.id, diagnosis);
    if (patch.surgeryDate !== undefined && patch.surgeryDate !== row.surgeryDate) await recomputeDueDates(tx, row.id, patch.surgeryDate);

    const changed = Object.keys(patch);
    if (changed.length) {
      const summary = patch.status && patch.status !== row.status ? `Stav zákroku: ${patch.status}.` : "Upraven zákrok.";
      await recordEvent(tx, { caseId: row.id, actorId: actor.id, type: "case.updated", subjectId: row.id, summary, data: { fields: changed } });
    }
  });
  return getCaseDto(row.id, db);
}

// Oprava diagnózy: původní informace dostane 'rejected', nová ji nahradí (replaces_id).
async function replaceDiagnosis(tx: Executor, actor: CurrentUser, caseId: string, diagnosis: Diagnosis) {
  const current = await tx
    .select({ id: information.id })
    .from(information)
    .where(and(eq(information.caseId, caseId), eq(information.type, "diagnosis"), ne(information.status, "rejected")))
    .orderBy(desc(information.createdAt))
    .limit(1);
  const previousId = current[0]?.id ?? null;
  if (previousId) {
    await tx.update(information).set({ status: "rejected", verifiedBy: actor.id, verifiedAt: new Date(), note: "Nahrazeno opravou." }).where(eq(information.id, previousId));
  }
  await insertDiagnosis(tx, actor, caseId, diagnosis, previousId);
}

async function recomputeDueDates(tx: Executor, caseId: string, surgeryDate: string | null) {
  const rows = await tx
    .select({ id: tasks.id, days: templateTasks.dueDaysBeforeSurgery })
    .from(tasks)
    .innerJoin(templateTasks, eq(templateTasks.id, tasks.templateTaskId))
    .where(and(eq(tasks.caseId, caseId), isNotNull(templateTasks.dueDaysBeforeSurgery)));
  for (const row of rows) {
    await tx.update(tasks).set({ dueDate: surgeryDate ? subtractDays(surgeryDate, row.days!) : null }).where(eq(tasks.id, row.id));
  }
}

// Uzavření při exportu: zákrok je hotový, údaje se zamknou (assertCaseOpen) a dají se odeslat do nemocnice
// a vytisknout. Znovu otevřít jde, kdyby se uzavřel omylem; obojí zůstává v časové ose.
export async function setCaseClosed(actor: CurrentUser, row: CaseRecord, closed: boolean) {
  if (closed && row.status === "closed") throw conflict("Zákrok už je uzavřený.");
  if (closed && row.status === "cancelled") throw conflict("Zrušený zákrok nejde uzavřít.");
  if (!closed && row.status !== "closed") throw conflict("Zákrok není uzavřený.");
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.update(cases).set({ status: closed ? "closed" : "active" }).where(eq(cases.id, row.id));
    await recordEvent(tx, {
      caseId: row.id,
      actorId: actor.id,
      type: closed ? CASE_CLOSED : "case.reopened",
      subjectId: row.id,
      summary: closed ? "Zákrok uzavřen a exportován." : "Zákrok znovu otevřen.",
    });
  });
  return getCaseDto(row.id, db);
}

export async function markCaseSeen(caseId: string) {
  await getDb().update(cases).set({ aaSeenAt: new Date() }).where(eq(cases.id, caseId));
}
