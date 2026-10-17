import { requireCaseAccess, requireOpenCase, requireUser } from "@/lib/server/auth";
import { json, readIds, readJson, route } from "@/lib/server/http";
import { getTask, patchTaskSchema, updateTask } from "@/lib/server/services/tasks";

// GET /api/v1/cases/:caseId/tasks/:taskId
export const GET = route(async (req, ctx: RouteContext<"/api/v1/cases/[caseId]/tasks/[taskId]">) => {
  const user = await requireUser(req);
  const { caseId, taskId } = await readIds(ctx, "caseId", "taskId");
  await requireCaseAccess(user, caseId);
  return json(await getTask(user, caseId, taskId));
});

// PATCH /api/v1/cases/:caseId/tasks/:taskId: AA mění stav (hotovo, odložit, není potřeba, znovu otevřít).
// Pacient jen na svých úkolech: odpoví na otázku ({status: "done", answer}) nebo nahlásí splněnou akci ({status: "done"}).
export const PATCH = route(async (req, ctx: RouteContext<"/api/v1/cases/[caseId]/tasks/[taskId]">) => {
  const user = await requireUser(req);
  const { caseId, taskId } = await readIds(ctx, "caseId", "taskId");
  const row = await requireOpenCase(user, caseId);
  return json(await updateTask(user, row, taskId, await readJson(req, patchTaskSchema)));
});
