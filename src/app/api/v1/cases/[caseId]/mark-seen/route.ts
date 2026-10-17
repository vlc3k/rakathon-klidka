import { requireCaseAccess, requireStaff } from "@/lib/server/auth";
import { noContent, readIds, route } from "@/lib/server/http";
import { markCaseSeen } from "@/lib/server/services/cases";

// POST /api/v1/cases/:caseId/mark-seen: lékař otevřel detail, ve frontě zhasne „Nové“.
export const POST = route(async (req, ctx: RouteContext<"/api/v1/cases/[caseId]/mark-seen">) => {
  const actor = await requireStaff(req);
  const { caseId } = await readIds(ctx, "caseId");
  await requireCaseAccess(actor, caseId);
  await markCaseSeen(caseId);
  return noContent();
});
