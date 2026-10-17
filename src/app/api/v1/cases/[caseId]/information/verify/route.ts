import { requireOpenCase, requireStaff } from "@/lib/server/auth";
import { json, readIds, readJson, route } from "@/lib/server/http";
import { verifyInformation, verifySchema } from "@/lib/server/services/information";

// POST /api/v1/cases/:caseId/information/verify { ids }: hodnoty sedí s dokumentem. Jen AA, pacient nálezy AI neověřuje.
export const POST = route(async (req, ctx: RouteContext<"/api/v1/cases/[caseId]/information/verify">) => {
  const actor = await requireStaff(req);
  const { caseId } = await readIds(ctx, "caseId");
  await requireOpenCase(actor, caseId);
  const { ids } = await readJson(req, verifySchema);
  return json(await verifyInformation(actor, caseId, ids));
});
