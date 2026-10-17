import { isStaff, requireCaseAccess, requireOpenCase, requireUser } from "@/lib/server/auth";
import { forbidden, json, readIds, readJson, readQuery, route } from "@/lib/server/http";
import { createTask, createTaskSchema, listTasks, listTasksSchema } from "@/lib/server/services/tasks";

// GET /api/v1/cases/:caseId/tasks?status=&assignee=: pacient dostane jen své úkoly.
export const GET = route(async (req, ctx: RouteContext<"/api/v1/cases/[caseId]/tasks">) => {
  const user = await requireUser(req);
  const { caseId } = await readIds(ctx, "caseId");
  await requireCaseAccess(user, caseId);
  return json(await listTasks(user, caseId, readQuery(req, listTasksSchema)));
});

// POST /api/v1/cases/:caseId/tasks: lékař vytvoří úkol (odběr krve, dokument, otázka).
export const POST = route(async (req, ctx: RouteContext<"/api/v1/cases/[caseId]/tasks">) => {
  const user = await requireUser(req);
  const { caseId } = await readIds(ctx, "caseId");
  await requireOpenCase(user, caseId);
  if (!isStaff(user)) throw forbidden();
  return json(await createTask(user, caseId, await readJson(req, createTaskSchema)), { status: 201 });
});
