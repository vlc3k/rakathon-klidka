import type { NextRequest } from "next/server";
import { requireCaseAccess, requireStaff } from "@/lib/server/auth";
import { HttpError, json, readIds, route } from "@/lib/server/http";
import { getPatient } from "@/lib/server/services/patients";
import { FhirClient, FhirError, importPatient } from "@/lib/fhir";
import { findPatient, loadHospitalRecord, loadMedicationRecord, PatientNotFound, pullHospitalSnapshot, rawPatientBundle } from "@/lib/fhir/hospital";
import { sendVerifiedToHospital } from "@/lib/fhir/writeBack";
import { verifiedInformation } from "@/lib/server/services/hospital";

// „Aktualizovat“ = synchronizace s nemocnicí, jen AA:
// 1. ověřené údaje z dokumentů od pacienta zapíše do nemocničního FHIR serveru (co tam už je, se nezdvojí),
// 2. stáhne pacienta zákroku (podle rodného čísla z databáze) a vrátí kopii dat pro tuto operaci, už i s nimi.
// Kopie se zatím neukládá (MISSING_ENDPOINTS.md), drží ji klient.
// GET vrátí surová data pacienta přesně tak, jak je poslal FHIR server (k ověření, že data jsou opravdu odtamtud).
// GET ?view=record totéž pro čitelnou stránku /staff/[caseId]/fhir: kdo data poslal, za jak dlouho, a chyby jako text.
// GET ?view=slz lékový záznam pacienta (výdeje léků v lékárně za rok; v demu simulace Sdíleného lékového záznamu).
type Ctx = RouteContext<"/api/fhir/[caseId]">;

async function patientOf(req: NextRequest, ctx: Ctx) {
  const actor = await requireStaff(req);
  const { caseId } = await readIds(ctx, "caseId");
  const row = await requireCaseAccess(actor, caseId);
  const patient = await getPatient(row.patientId);
  if (!patient.birthNumber) throw new HttpError(422, "Pacient nemá rodné číslo, v nemocnici ho nedohledáme.");
  return { actor, caseId, patient: { ...patient, birthNumber: patient.birthNumber } };
}

function failure(error: unknown): never {
  if (error instanceof PatientNotFound) throw new HttpError(404, error.message);
  console.error("Stažení z FHIR selhalo:", error instanceof Error ? error.message : error);
  const offline = error instanceof TypeError && /fetch failed/.test(error.message);
  const detail = error instanceof FhirError ? ` (${error.message.slice(0, 200)})` : "";
  throw new HttpError(502, offline ? "Nemocniční systém neodpovídá." : `Nemocniční systém vrátil chybu${detail}.`);
}

export const POST = route(async (req, ctx: Ctx) => {
  const { actor, caseId, patient } = await patientOf(req, ctx);
  try {
    const client = new FhirClient();
    const hospitalPatient = await findPatient(client, patient.birthNumber);
    // co nemocnice o pacientovi už vede, ať jí stejnou věc z dokumentu neposíláme podruhé
    const { facts } = await importPatient(client, hospitalPatient.id);
    const { created, existing, known, failed } = await sendVerifiedToHospital(client, hospitalPatient.id, await verifiedInformation(caseId), facts);
    const snapshot = await pullHospitalSnapshot(caseId, { name: patient.displayName, birthNumber: patient.birthNumber }, actor.displayName, client);
    console.log(`[fhir] ${caseId}: odesláno ${created} nových (${existing} od nás už dřív, ${known} nemocnice už měla, ${failed} chyb), staženo ${snapshot.items.length} záznamů z ${snapshot.server} za ${snapshot.source?.ms} ms`);
    return json({ ...snapshot, sent: { created, existing, known, failed } });
  } catch (error) {
    failure(error);
  }
});

export const GET = route(async (req, ctx: Ctx) => {
  const { patient } = await patientOf(req, ctx);
  const view = new URL(req.url).searchParams.get("view");
  if (view === "record") {
    return json({ patientName: patient.displayName, record: await loadHospitalRecord(patient.birthNumber) });
  }
  if (view === "slz") {
    try {
      return json(await loadMedicationRecord(patient.birthNumber));
    } catch (error) {
      failure(error);
    }
  }
  try {
    const bundle = await rawPatientBundle(patient.birthNumber);
    return new Response(JSON.stringify(bundle, null, 2), {
      headers: { "content-type": "application/fhir+json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (error) {
    failure(error);
  }
});
