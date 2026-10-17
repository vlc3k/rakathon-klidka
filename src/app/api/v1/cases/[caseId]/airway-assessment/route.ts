import { requireOpenCase, requireStaff } from "@/lib/server/auth";
import { json, readIds, readJson, route } from "@/lib/server/http";
import { airwayAssessmentSchema, recordAirwayAssessment } from "@/lib/server/services/information";

// POST /api/v1/cases/:caseId/airway-assessment { mallampati, findings, note }: hodnocení dýchacích cest z fotek.
// Jen AA. Každé uložení je nový záznam, platí poslední (historie zůstává pro audit).
export const POST = route(async (req, ctx: RouteContext<"/api/v1/cases/[caseId]/airway-assessment">) => {
  const actor = await requireStaff(req);
  const { caseId } = await readIds(ctx, "caseId");
  await requireOpenCase(actor, caseId);
  return json(await recordAirwayAssessment(actor, caseId, await readJson(req, airwayAssessmentSchema)), { status: 201 });
});
