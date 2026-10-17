import { requireCaseAccess, requireStaff } from "@/lib/server/auth";
import { json, readIds, route } from "@/lib/server/http";
import { getCaseActivity } from "@/lib/server/services/activity";

// GET /api/v1/cases/:caseId/activity: události zákroku po dnech a naplánovaný zákrok (záložka Aktivita v detailu).
export const GET = route(async (req, ctx: RouteContext<"/api/v1/cases/[caseId]/activity">) => {
  const actor = await requireStaff(req);
  const { caseId } = await readIds(ctx, "caseId");
  await requireCaseAccess(actor, caseId);
  return json(await getCaseActivity(caseId));
});
