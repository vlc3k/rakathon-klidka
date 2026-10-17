import { requireStaff } from "@/lib/server/auth";
import { json, readIds, readJson, route } from "@/lib/server/http";
import { getPatient, patchPatientSchema, updatePatient } from "@/lib/server/services/patients";

// GET /api/v1/patients/:patientId: pacient pro formulář úpravy, s celým RČ.
export const GET = route(async (req, ctx: RouteContext<"/api/v1/patients/[patientId]">) => {
  await requireStaff(req);
  const { patientId } = await readIds(ctx, "patientId");
  return json(await getPatient(patientId));
});

// PATCH /api/v1/patients/:patientId: osobní údaje. Zákroky se mění přes /cases/:caseId.
export const PATCH = route(async (req, ctx: RouteContext<"/api/v1/patients/[patientId]">) => {
  await requireStaff(req);
  const { patientId } = await readIds(ctx, "patientId");
  return json(await updatePatient(patientId, await readJson(req, patchPatientSchema)));
});
