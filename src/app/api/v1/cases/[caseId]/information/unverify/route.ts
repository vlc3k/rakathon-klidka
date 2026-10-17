import { requireOpenCase, requireStaff } from "@/lib/server/auth";
import { json, readIds, readJson, route } from "@/lib/server/http";
import { unverifyInformation, unverifySchema } from "@/lib/server/services/information";

// POST /api/v1/cases/:caseId/information/unverify { ids }: odvolání potvrzení, hodnota se vrátí mezi načtené AI. Jen AA.
export const POST = route(async (req, ctx: RouteContext<"/api/v1/cases/[caseId]/information/unverify">) => {
  const actor = await requireStaff(req);
  const { caseId } = await readIds(ctx, "caseId");
  await requireOpenCase(actor, caseId);
  const { ids } = await readJson(req, unverifySchema);
  return json(await unverifyInformation(actor, caseId, ids));
});
