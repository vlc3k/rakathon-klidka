import { requirePatient } from "@/lib/server/auth";
import { json, readJson, route } from "@/lib/server/http";
import { createInvite, inviteSchema, listHelpers } from "@/lib/server/services/helpers";

// GET /api/v1/helpers: pomocníci přihlášeného pacienta (přijatí i čekající pozvánky). Jen pacient.
export const GET = route(async (req) => {
  const patient = await requirePatient(req);
  return json(await listHelpers(patient.id));
});

// POST /api/v1/helpers: pacient pozve pomocníka { displayName, relation, consent: true }.
// Token odkazu se vrátí jen tady, jednou; v databázi je jen jeho SHA-256. Pomocník ani AA zvát nesmí.
export const POST = route(async (req) => {
  const patient = await requirePatient(req);
  const input = await readJson(req, inviteSchema);
  return json(await createInvite(patient, input), { status: 201 });
});
