import "server-only";
import { and, asc, count, eq, notInArray } from "drizzle-orm";
import { z } from "zod";
import { templateTasks, templates } from "@/db/schema";
import type { CurrentUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { badRequest, HttpError, notFound } from "@/lib/server/http";
import { targetIssues, taskTargetFields } from "@/lib/server/services/tasks";
import { queryFlag } from "@/lib/server/validation";

// Šablony zákroků. Upravovat smí kdokoli z AA, i nemocniční. Běžící zákroky mají kopii úkolů, změna je nerozbije.

const templateTaskFields = {
  ...taskTargetFields,
  appliesFromAge: z.number().int().min(0).max(130).nullable().optional(),
  dueDaysBeforeSurgery: z.number().int().min(0).max(365).nullable().optional(),
};

const withTarget = <T extends z.ZodObject>(schema: T) =>
  schema.superRefine((task, ctx) => targetIssues(task as Parameters<typeof targetIssues>[0]).forEach((issue) => ctx.addIssue({ code: "custom", path: [issue.path], message: issue.message })));

const newTaskSchema = withTarget(z.strictObject(templateTaskFields));
const existingTaskSchema = withTarget(z.strictObject({ id: z.uuid().optional(), ...templateTaskFields }));

const templateFields = {
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  bloodLossMl: z.number().int().min(0).max(20_000).nullable().optional(),
};

export const createTemplateSchema = z.strictObject({
  ...templateFields,
  own: z.boolean().optional(), // true = vlastní šablona přihlášeného lékaře, jinak nemocniční
  copyFromId: z.uuid().optional(),
  tasks: z.array(newTaskSchema).max(100).optional(),
});

export const putTemplateSchema = z.strictObject({
  ...templateFields,
  isActive: z.boolean(),
  tasks: z.array(existingTaskSchema).max(100),
});

export const listTemplatesSchema = z.strictObject({ includeInactive: queryFlag.optional() });

type TaskInput = z.infer<typeof newTaskSchema>;

const taskValues = (templateId: string, task: TaskInput, index: number) => ({
  templateId,
  sortOrder: task.sortOrder ?? index,
  assignee: task.assignee,
  kind: task.kind,
  title: task.title,
  instructions: task.instructions ?? null,
  documentType: task.documentType ?? null,
  informationType: task.informationType ?? null,
  validForDays: task.validForDays ?? null,
  isRequired: task.isRequired ?? true,
  appliesFromAge: task.appliesFromAge ?? null,
  dueDaysBeforeSurgery: task.dueDaysBeforeSurgery ?? null,
});

export async function listTemplates({ includeInactive }: z.infer<typeof listTemplatesSchema>) {
  return getDb()
    .select({
      id: templates.id,
      name: templates.name,
      description: templates.description,
      bloodLossMl: templates.bloodLossMl,
      ownerId: templates.ownerId,
      isActive: templates.isActive,
      updatedAt: templates.updatedAt,
      taskCount: count(templateTasks.id),
    })
    .from(templates)
    .leftJoin(templateTasks, eq(templateTasks.templateId, templates.id))
    .where(includeInactive ? undefined : eq(templates.isActive, true))
    .groupBy(templates.id)
    .orderBy(asc(templates.name));
}

export async function getTemplate(templateId: string) {
  const db = getDb();
  const [template] = await db.select().from(templates).where(eq(templates.id, templateId));
  if (!template) throw notFound("Šablona nenalezena.");
  const tasks = await db.select().from(templateTasks).where(eq(templateTasks.templateId, templateId)).orderBy(asc(templateTasks.sortOrder));
  return { ...template, tasks };
}

export async function createTemplate(actor: CurrentUser, input: z.infer<typeof createTemplateSchema>) {
  let items: TaskInput[] = input.tasks ?? [];
  let sourceBloodLoss: number | null = null;
  if (input.copyFromId) {
    const source = await getTemplate(input.copyFromId).catch((error: unknown) => {
      if (error instanceof HttpError && error.status === 404) throw badRequest("Neplatné údaje.", [{ path: "copyFromId", message: "Zdrojová šablona neexistuje." }]);
      throw error;
    });
    sourceBloodLoss = source.bloodLossMl;
    if (!input.tasks) items = source.tasks.map((task) => ({
      sortOrder: task.sortOrder,
      assignee: task.assignee as TaskInput["assignee"], // helper do šablon nejde (zod), sloupec ho jen připouští
      kind: task.kind,
      title: task.title,
      instructions: task.instructions,
      documentType: task.documentType as TaskInput["documentType"],
      informationType: task.informationType as TaskInput["informationType"],
      validForDays: task.validForDays,
      isRequired: task.isRequired,
      appliesFromAge: task.appliesFromAge,
      dueDaysBeforeSurgery: task.dueDaysBeforeSurgery,
    }));
  }
  const id = await getDb().transaction(async (tx) => {
    const [template] = await tx
      .insert(templates)
      .values({
        name: input.name,
        description: input.description ?? null,
        bloodLossMl: input.bloodLossMl !== undefined ? input.bloodLossMl : sourceBloodLoss,
        ownerId: input.own ? actor.id : null,
        createdBy: actor.id,
      })
      .returning({ id: templates.id });
    if (items.length) await tx.insert(templateTasks).values(items.map((task, i) => taskValues(template.id, task, i)));
    return template.id;
  });
  return getTemplate(id);
}

// Celá šablona najednou: úkoly s id se upraví, bez id přibudou, chybějící se smažou.
export async function replaceTemplate(templateId: string, input: z.infer<typeof putTemplateSchema>) {
  await getDb().transaction(async (tx) => {
    const [template] = await tx.select({ id: templates.id }).from(templates).where(eq(templates.id, templateId)).for("update");
    if (!template) throw notFound("Šablona nenalezena.");
    const existing = new Set((await tx.select({ id: templateTasks.id }).from(templateTasks).where(eq(templateTasks.templateId, templateId))).map((t) => t.id));
    const keep = input.tasks.map((t) => t.id).filter((id): id is string => id !== undefined);
    if (keep.some((id) => !existing.has(id))) throw badRequest("Neplatné údaje.", [{ path: "tasks", message: "Úkol nepatří k této šabloně." }]);

    await tx
      .update(templates)
      .set({ name: input.name, description: input.description ?? null, bloodLossMl: input.bloodLossMl ?? null, isActive: input.isActive })
      .where(eq(templates.id, templateId));
    await tx.delete(templateTasks).where(and(eq(templateTasks.templateId, templateId), keep.length ? notInArray(templateTasks.id, keep) : undefined));
    for (const [index, { id, ...task }] of input.tasks.entries()) {
      const values = taskValues(templateId, task, index);
      if (id) await tx.update(templateTasks).set(values).where(eq(templateTasks.id, id));
      else await tx.insert(templateTasks).values(values);
    }
  });
  return getTemplate(templateId);
}
