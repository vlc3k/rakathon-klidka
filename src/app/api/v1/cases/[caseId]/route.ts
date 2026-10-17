import { requireCaseAccess, requireOpenCase, requireStaff } from "@/lib/server/auth";
import { json, readIds, readJson, route } from "@/lib/server/http";
import { getCaseDetail } from "@/lib/server/services/case-views";
import { patchCaseSchema, updateCase } from "@/lib/server/services/cases";

// GET /api/v1/cases/:caseId: celý detail pro AA (i tisk). Pacient má vlastní pohled přes /users/:userId/cases/:caseId.
export const GET = route(async (req, ctx: RouteContext<"/api/v1/cases/[caseId]">) => {
  const actor = await requireStaff(req);
  const { caseId } = await readIds(ctx, "caseId");
  return json(await getCaseDetail(await requireCaseAccess(actor, caseId)));
});

// PATCH /api/v1/cases/:caseId: úprava a zrušení (status: cancelled). Uzavřený zákrok jen přes /close.
export const PATCH = route(async (req, ctx: RouteContext<"/api/v1/cases/[caseId]">) => {
  const actor = await requireStaff(req);
  const { caseId } = await readIds(ctx, "caseId");
  const row = await requireOpenCase(actor, caseId);
  return json(await updateCase(actor, row, await readJson(req, patchCaseSchema)));
});
