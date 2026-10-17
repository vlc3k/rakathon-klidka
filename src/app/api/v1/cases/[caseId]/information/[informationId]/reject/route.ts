import { requireOpenCase, requireStaff } from "@/lib/server/auth";
import { json, readIds, readJson, route } from "@/lib/server/http";
import { rejectInformation, rejectSchema } from "@/lib/server/services/information";

// POST /api/v1/cases/:caseId/information/:informationId/reject { note?, correction? }: hodnota nesedí s dokumentem. Jen AA.
export const POST = route(async (req, ctx: RouteContext<"/api/v1/cases/[caseId]/information/[informationId]/reject">) => {
  const actor = await requireStaff(req);
  const { caseId, informationId } = await readIds(ctx, "caseId", "informationId");
  await requireOpenCase(actor, caseId);
  return json(await rejectInformation(actor, caseId, informationId, await readJson(req, rejectSchema)));
});
