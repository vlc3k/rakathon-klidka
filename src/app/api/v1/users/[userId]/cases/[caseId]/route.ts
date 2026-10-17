import { requireCaseAccess, requireSelfOrStaff, requireUser } from "@/lib/server/auth";
import { notFound, json, readIds, route } from "@/lib/server/http";
import { getPatientCaseView } from "@/lib/server/services/case-views";
import { markTasksRead } from "@/lib/server/services/tasks";

// GET /api/v1/users/:userId/cases/:caseId: přehled přípravy, jak ho vidí pacient. Bez hodnot, upozornění a diagnózy.
// Když přehled otevře sám pacient, jeho neuzavřené úkoly se označí jako přečtené (tasks.read_at).
export const GET = route(async (req, ctx: RouteContext<"/api/v1/users/[userId]/cases/[caseId]">) => {
  const user = await requireUser(req);
  const { userId, caseId } = await readIds(ctx, "userId", "caseId");
  requireSelfOrStaff(user, userId);
  const row = await requireCaseAccess(user, caseId);
  if (row.patientId !== userId) throw notFound("Zákrok nenalezen.");
  if (user.id === row.patientId) await markTasksRead(user, row.id);
  return json(await getPatientCaseView(row));
});
