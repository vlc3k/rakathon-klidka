import { requireCaseAccess, requireStaff } from "@/lib/server/auth";
import { json, readIds, readQuery, route } from "@/lib/server/http";
import { listEvents, listEventsSchema } from "@/lib/server/services/timeline";

// GET /api/v1/cases/:caseId/events?before=&limit=: časová osa a audit zákroku.
export const GET = route(async (req, ctx: RouteContext<"/api/v1/cases/[caseId]/events">) => {
  const actor = await requireStaff(req);
  const { caseId } = await readIds(ctx, "caseId");
  await requireCaseAccess(actor, caseId);
  return json(await listEvents(caseId, readQuery(req, listEventsSchema)));
});
