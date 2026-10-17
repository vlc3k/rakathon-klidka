import { RULES } from "@/db/catalog";
import { FhirClient, importPatient, SYSTEMS } from "@/lib/fhir";
import type { CaseFact } from "@/lib/fhir";
import type { HospitalGroup, HospitalItem, HospitalSnapshot } from "@/lib/fhir/snapshot";
import { formatRc, matchIdentity, normRc } from "@/lib/identity";

// Stáhne pacienta z nemocničního FHIR serveru (podle rodného čísla) a udělá z něj kopii pro jednu operaci.
// Jen pro server.

const VITALS = new Set(["weight", "height", "bmi", "blood_pressure", "heart_rate", "spo2"]);
const PREOP_LABS = new Set([
  "hemoglobin", "hematocrit", "platelets", "leukocytes", "ferritin", "inr", "prothrombin_time", "aptt",
  "creatinine", "egfr", "sodium", "potassium", "glucose", "hba1c",
]);
const HB_THRESHOLD = RULES.pbm.hbThresholdGl; // g/l, stejně jako PBM pravidlo (db/catalog.ts)

export class PatientNotFound extends Error {}

export async function pullHospitalSnapshot(
  caseId: string,
  expected: { name: string; birthNumber: string },
  by: string,
  client = new FhirClient(),
): Promise<HospitalSnapshot> {
  const started = Date.now();
  const patient = await findPatient(client, expected.birthNumber);
  // kdo odpověděl: název a verze FHIR serveru z jeho CapabilityStatement (důkaz, že data jsou živě z nemocnice)
  const [data, meta] = await Promise.all([importPatient(client, patient.id), client.metadata() as Promise<{ software?: { name?: string; version?: string }; fhirVersion?: string }>]);
  const name = `${data.patient.givenName} ${data.patient.familyName}`.trim();
  return {
    source: {
      software: [meta.software?.name, meta.software?.version?.match(/\d{4}\.\d+/)?.[0]].filter(Boolean).join(" ") || "FHIR server",
      fhirVersion: meta.fhirVersion ?? "?",
      patientRef: `Patient/${patient.id}`,
      resources: data.facts.length,
      ms: Date.now() - started,
    },
    id: `${caseId}-${Date.now()}`,
    caseId,
    fetchedAt: new Date().toISOString(),
    by,
    server: client.baseUrl,
    patient: { fhirId: patient.id, name, birthNumber: data.patient.birthNumber ?? expected.birthNumber },
    // RČ sedí (podle něj jsme hledali), jméno ale může být jiné (rodné příjmení, chyba v systému)
    identity: matchIdentity({ name, birthNumber: data.patient.birthNumber ?? expected.birthNumber }, expected),
    items: data.facts.map(toItem),
  };
}

// Nemocnice může mít RČ s lomítkem i bez, FHIR hledá token přesně → zkusíme oba zápisy.
export async function findPatient(client: FhirClient, birthNumber: string) {
  const variants = [...new Set([formatRc(birthNumber), normRc(birthNumber)])];
  const [patient] = await client.search("Patient", { identifier: variants.map((v) => `${SYSTEMS.birthNumber}|${v}`).join(","), _count: 1 });
  if (!patient) throw new PatientNotFound(`Pacient s RČ ${formatRc(birthNumber)} v nemocničním systému není.`);
  return patient as { id: string; resourceType: string };
}

/** Surová data pacienta tak, jak je vrátil FHIR server (pacient + klinické záznamy), k ověření. */
export async function rawPatientBundle(birthNumber: string, client = new FhirClient()) {
  const patient = await findPatient(client, birthNumber);
  const types = ["Observation", "Condition", "MedicationStatement", "MedicationRequest", "AllergyIntolerance"];
  const found = await Promise.all(types.map((t) => client.search(t, { patient: `Patient/${patient.id}`, _count: 200 }).catch(() => [])));
  const resources = [await client.read("Patient", patient.id), ...found.flat()];
  return {
    resourceType: "Bundle",
    type: "searchset",
    timestamp: new Date().toISOString(),
    meta: { source: client.baseUrl },
    total: resources.length,
    entry: resources.map((resource) => ({ fullUrl: `${client.baseUrl}/${resource.resourceType}/${resource.id}`, resource })),
  };
}

export type HospitalRecord = {
  server: string;
  software: string;
  fhirVersion: string;
  fetchedAt: string;
  ms: number;
  bundle: Awaited<ReturnType<typeof rawPatientBundle>>;
};

/** Surová data + kdo je poslal, pro čitelnou stránku. Chyby jako text (nemocnice neodpovídá, pacient tam není). */
export async function loadHospitalRecord(birthNumber: string, client = new FhirClient()): Promise<HospitalRecord | { error: string }> {
  const started = Date.now();
  try {
    const [bundle, meta] = await Promise.all([
      rawPatientBundle(birthNumber, client),
      client.metadata() as Promise<{ software?: { name?: string; version?: string }; fhirVersion?: string }>,
    ]);
    return {
      server: client.baseUrl,
      software: [meta.software?.name, meta.software?.version?.match(/\d{4}\.\d+/)?.[0]].filter(Boolean).join(" ") || "FHIR server",
      fhirVersion: meta.fhirVersion ?? "?",
      fetchedAt: new Date().toISOString(),
      ms: Date.now() - started,
      bundle,
    };
  } catch (error) {
    if (error instanceof PatientNotFound) return { error: error.message };
    const offline = error instanceof TypeError && /fetch failed/.test(error.message);
    return { error: offline ? "Nemocniční systém neodpovídá." : `Nemocniční systém vrátil chybu: ${error instanceof Error ? error.message.slice(0, 200) : error}` };
  }
}

function toItem(f: CaseFact): HospitalItem {
  const group: HospitalGroup =
    f.kind === "allergy" || f.kind === "diagnosis" || f.kind === "medication"
      ? f.kind
      : VITALS.has(f.key)
        ? "vital"
        : f.kind === "lab" || PREOP_LABS.has(f.key)
          ? "lab"
          : "other";
  const relevant =
    group === "allergy" ||
    group === "vital" ||
    ((group === "diagnosis" || group === "medication") && f.active !== false) ||
    PREOP_LABS.has(f.key) ||
    f.key === "smoking_status";
  const low = f.key === "hemoglobin" && typeof f.value === "number" && f.value < HB_THRESHOLD;
  return {
    id: f.id,
    group,
    key: f.key,
    label: group === "diagnosis" || group === "medication" || group === "allergy" ? String(f.value ?? f.label) : (f.label ?? f.key),
    value: group === "diagnosis" || group === "medication" || group === "allergy" ? "" : formatValue(f.value, f.unit),
    date: f.date ?? null,
    relevant,
    ...(low && { flag: "L" as const }),
    ...(f.verification !== "source_system" && { fromApp: true }),
  };
}

function formatValue(value: CaseFact["value"], unit: string | null | undefined) {
  if (value == null) return "";
  const v = typeof value === "number" ? value.toLocaleString("cs-CZ", { maximumFractionDigits: 1 }) : value.trim();
  return unit ? `${v} ${readableUnit(unit)}` : v;
}

// UCUM pro lidi: 10*9/L → 10⁹/L, {score} → bez jednotky
const SUPERSCRIPT: Record<string, string> = { "3": "³", "6": "⁶", "9": "⁹", "12": "¹²" };
function readableUnit(unit: string) {
  return unit
    .replace(/10\*(\d+)/g, (m, e: string) => (SUPERSCRIPT[e] ? `10${SUPERSCRIPT[e]}` : m))
    .replace(/\{[^}]*\}/g, "")
    .replace("mm[Hg]", "mmHg")
    .trim();
}

// ---------------------------------------------------------------- lékový záznam

/** Lék ze Sdíleného lékového záznamu: výdeje v lékárně sloučené podle léku (ATC), nejnovější první. */
export type MedicationRecordItem = {
  key: string;
  name: string;
  substance: string | null;
  atc: string | null;
  dose: string | null;
  lastDispensed: string | null;
  dispenses: number;
};
export type MedicationRecord = { server: string; fetchedAt: string; simulated: boolean; items: MedicationRecordItem[] };

const SLZ_SIMULATION_TAG = "slz-simulace";

/**
 * Výdeje léků pacienta (MedicationDispense) za poslední rok. V provozu by šly ze Sdíleného lékového záznamu
 * (eRecept SÚKL) přes VFN; v demu jsou v nemocničním FHIR serveru jako simulace (scripts/seed-slz.mjs).
 */
export async function loadMedicationRecord(birthNumber: string, client = new FhirClient()): Promise<MedicationRecord> {
  const patient = await findPatient(client, birthNumber);
  const since = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const dispenses = await client.search("MedicationDispense", { patient: `Patient/${patient.id}`, _count: 500 });
  const byMedication = new Map<string, MedicationRecordItem>();
  let simulated = false;
  for (const d of dispenses) {
    const when: string | null = d.whenHandedOver?.slice(0, 10) ?? null;
    if (when && when < since) continue;
    if (d.meta?.tag?.some((t: { code?: string }) => t.code === SLZ_SIMULATION_TAG)) simulated = true;
    const coding = d.medicationCodeableConcept?.coding?.[0];
    const name: string = d.medicationCodeableConcept?.text ?? coding?.display ?? "Lék";
    const key = coding?.code ?? name;
    const item = byMedication.get(key) ?? { key, name, substance: coding?.display ?? null, atc: coding?.code ?? null, dose: null, lastDispensed: null, dispenses: 0 };
    item.dispenses++;
    if (when && (!item.lastDispensed || when > item.lastDispensed)) {
      item.lastDispensed = when;
      item.dose = d.dosageInstruction?.[0]?.text ?? item.dose;
      item.name = name;
    }
    byMedication.set(key, item);
  }
  const items = [...byMedication.values()].sort((a, b) => (b.lastDispensed ?? "").localeCompare(a.lastDispensed ?? ""));
  return { server: client.baseUrl, fetchedAt: new Date().toISOString(), simulated, items };
}
