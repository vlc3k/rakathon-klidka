import { requireStaff } from "@/lib/server/auth";
import { json, readJson, readQuery, route } from "@/lib/server/http";
import { createPatient, createPatientSchema, listPatients, listPatientsSchema } from "@/lib/server/services/patients";

// GET /api/v1/patients?q=: seznam pacientů s jejich zákroky, RČ maskované.
export const GET = route(async (req) => {
  await requireStaff(req);
  return json(await listPatients(readQuery(req, listPatientsSchema)));
});

// POST /api/v1/patients: nový pacient, volitelně i se zákroky.
export const POST = route(async (req) => {
  const actor = await requireStaff(req);
  return json(await createPatient(actor, await readJson(req, createPatientSchema)), { status: 201 });
});
