import type { NextRequest } from "next/server";
import { requireCaseAccess, requireStaff } from "@/lib/server/auth";
import { json, readIds, route } from "@/lib/server/http";
import { setCaseClosed } from "@/lib/server/services/cases";

// POST /api/v1/cases/:caseId/close: export, zákrok se uzavře a dál už nejde upravovat.
// DELETE: znovu otevřít (uzavřený omylem).
type Ctx = RouteContext<"/api/v1/cases/[caseId]/close">;

async function caseOf(req: NextRequest, ctx: Ctx) {
  const actor = await requireStaff(req);
  const { caseId } = await readIds(ctx, "caseId");
  return { actor, row: await requireCaseAccess(actor, caseId) };
}

export const POST = route(async (req, ctx: Ctx) => {
  const { actor, row } = await caseOf(req, ctx);
  return json(await setCaseClosed(actor, row, true));
});

export const DELETE = route(async (req, ctx: Ctx) => {
  const { actor, row } = await caseOf(req, ctx);
  return json(await setCaseClosed(actor, row, false));
});
