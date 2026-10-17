/* eslint-disable @typescript-eslint/no-explicit-any -- volné FHIR JSON bez typů */
import { DOCUMENT_TYPES, INFORMATION_TYPES } from "@/db/catalog";
import type { FhirClient } from "./client";
import { SYSTEMS } from "./bundle";
import type { CaseFact } from "./types";

// Ověřené údaje zpátky do nemocnice: co AI přečetla z dokumentu od pacienta a lékař v ambulanci potvrdil,
// se zapíše do nemocničního FHIR serveru jako standardní záznam (Observation, MedicationStatement,
// AllergyIntolerance, Condition). Každý záznam nese naše id informace (identifier) a štítek „ověřeno lékařem“,
// takže ho import pozná jako náš a opakované odeslání nic nezdvojí (podmíněné vytvoření, ifNoneExist).

export type VerifiedInfo = {
  id: string;
  type: string;
  value: any;
  observedDate: string | null;
  verifiedAt: string | null;
  verifierName: string | null;
  /** dokument, ze kterého údaj je (bez něj ho zadal člověk v ambulanci) */
  document: { type: string | null; issuedDate: string | null } | null;
};

export type SendResult = {
  created: number;
  /** naše dřívější odeslání (podle našeho id) */
  existing: number;
  /** stejnou věc už nemocnice vedla sama (stejný kód, datum a hodnota / látka / název), neposílá se */
  known: number;
  failed: number;
  skipped: number;
};

const LOINC = "http://loinc.org";
const UCUM_SYSTEM = "http://unitsofmeasure.org";
const UCUM: Record<string, string> = {
  "g/l": "g/L", "g/dl": "g/dL", "mg/l": "mg/L", "µg/l": "ug/L", "ug/l": "ug/L", "µmol/l": "umol/L", "umol/l": "umol/L",
  "mmol/l": "mmol/L", "10^9/l": "10*9/L", "10^12/l": "10*12/L", "%": "%", "kg": "kg", "cm": "cm",
};
const category = (system: string, code: string) => [{ coding: [{ system, code }] }];
const OBS_CATEGORY = "http://terminology.hl7.org/CodeSystem/observation-category";

const fmtDate = (iso: string) => iso.slice(0, 10).split("-").reverse().map(Number).join(". ");

/** Odkud údaj je, česky do poznámky záznamu (nemocnice ji uvidí u hodnoty). */
export function provenanceNote(info: VerifiedInfo) {
  const doc = info.document;
  const docName = doc?.type && doc.type in DOCUMENT_TYPES ? DOCUMENT_TYPES[doc.type as keyof typeof DOCUMENT_TYPES].name : "dokument";
  const from = doc ? `Z dokumentu od pacienta (${docName}${doc.issuedDate ? `, vystaven ${fmtDate(doc.issuedDate)}` : ""}), přečteno AI.` : "Zadáno v anesteziologické ambulanci.";
  const verified = `Ověřeno${info.verifierName ? `: ${info.verifierName}` : ""}${info.verifiedAt ? `, ${fmtDate(info.verifiedAt)}` : ""} (předanestetická příprava, Klidka).`;
  return `${from} ${verified}`;
}

function quantity(value: number, unit: string | null | undefined) {
  const code = unit ? UCUM[unit.toLowerCase()] : undefined;
  return { value, ...(unit && { unit }), ...(code && { system: UCUM_SYSTEM, code }) };
}

/** Jeden ověřený údaj → FHIR resource pro pacienta v nemocnici. Typy, které nemocnici nic neřeknou, vrací null. */
export function toHospitalResource(info: VerifiedInfo, patientRef: string): Record<string, any> | null {
  const v = info.value ?? {};
  const common = {
    identifier: [{ system: SYSTEMS.factId, value: info.id }],
    meta: { tag: [{ system: SYSTEMS.verification, code: "clinician_verified", display: "Ověřeno zdravotníkem" }] },
    note: [{ text: provenanceNote(info) }],
  };
  const recorded = info.verifiedAt ?? undefined;
  const def = INFORMATION_TYPES[info.type as keyof typeof INFORMATION_TYPES] as { name: string; area: string; loinc?: string } | undefined;
  if (!def || v.none === true) return null;

  if (def.area === "labs" || info.type === "weight" || info.type === "height") {
    const name = info.type === "lab_other" ? String(v.name) : def.name;
    const numeric = typeof v.value === "number";
    return {
      resourceType: "Observation",
      ...common,
      status: "final",
      category: category(OBS_CATEGORY, def.area === "labs" ? "laboratory" : "vital-signs"),
      code: { ...(def.loinc && { coding: [{ system: LOINC, code: def.loinc, display: name }] }), text: name },
      subject: { reference: patientRef },
      ...(info.observedDate && { effectiveDateTime: info.observedDate }),
      ...(recorded && { issued: recorded }),
      ...(numeric ? { valueQuantity: quantity(v.value, v.unit) } : { valueString: String(v.value) }),
      ...((v.refLow != null || v.refHigh != null) && {
        referenceRange: [{ ...(v.refLow != null && { low: quantity(v.refLow, v.unit) }), ...(v.refHigh != null && { high: quantity(v.refHigh, v.unit) }) }],
      }),
      ...(v.flag && { interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: v.flag }] }] }),
    };
  }

  if (info.type === "medication") {
    return {
      resourceType: "MedicationStatement",
      ...common,
      status: "active",
      medicationCodeableConcept: { text: [v.name, v.strength].filter(Boolean).join(" ") },
      subject: { reference: patientRef },
      ...(recorded && { dateAsserted: recorded }),
      ...(v.dose && { dosage: [{ text: v.dose }] }),
    };
  }

  if (info.type === "allergy") {
    return {
      resourceType: "AllergyIntolerance",
      ...common,
      clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }] },
      verificationStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification", code: "confirmed" }] },
      code: { text: v.substance },
      patient: { reference: patientRef },
      ...(recorded && { recordedDate: recorded }),
      ...(v.reaction && { reaction: [{ manifestation: [{ text: v.reaction }] }] }),
    };
  }

  if (info.type === "condition" || info.type === "diagnosis") {
    return {
      resourceType: "Condition",
      ...common,
      clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] },
      verificationStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: "confirmed" }] },
      category: category("http://terminology.hl7.org/CodeSystem/condition-category", info.type === "diagnosis" ? "encounter-diagnosis" : "problem-list-item"),
      code: { ...(v.icd10 && { coding: [{ system: SYSTEMS.icd10, code: v.icd10 }] }), text: v.text },
      subject: { reference: patientRef },
      ...(recorded && { recordedDate: recorded }),
    };
  }

  return null;
}

// Slova názvu bez diakritiky, aspoň 5 písmen a bez obecných slov: „Paralen paracetamol“ ~ „paracetamol 500 mg“.
const GENERIC = new Set(["tablety", "tableta", "inhalator", "roztok", "sodna", "injekce", "kapsle", "disorder", "finding", "chronic", "primarni"]);
const words = (text: unknown) =>
  String(text ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 5 && !GENERIC.has(w));
const sameText = (a: unknown, b: unknown) => {
  const wb = words(b);
  return words(a).some((w) => wb.includes(w));
};

/** Vede už nemocnice (sama, ne od nás) stejnou věc? Pak ji neposíláme, jen by se zdvojila z jiného zdroje. */
export function alreadyInHospital(info: VerifiedInfo, hospital: CaseFact[]): boolean {
  const v = info.value ?? {};
  const theirs = hospital.filter((f) => f.verification === "source_system");
  const loinc = (INFORMATION_TYPES[info.type as keyof typeof INFORMATION_TYPES] as { loinc?: string } | undefined)?.loinc;
  if (loinc && typeof v.value === "number") {
    // stejný parametr ze stejného dne se stejnou hodnotou (2 % tolerance kvůli převodu jednotek)
    return theirs.some((f) => f.code?.code === loinc && f.date === info.observedDate && typeof f.value === "number" && Math.abs(f.value - v.value) <= Math.abs(v.value) * 0.02);
  }
  if (info.type === "condition" || info.type === "diagnosis") {
    return theirs.some((f) => f.kind === "diagnosis" && ((v.icd10 && f.code?.code === v.icd10) || sameText(f.value, v.text)));
  }
  if (info.type === "medication") return theirs.some((f) => f.kind === "medication" && f.active !== false && sameText(f.value, v.name));
  if (info.type === "allergy") return theirs.some((f) => f.kind === "allergy" && sameText(f.value, v.substance));
  return false;
}

/**
 * Zapíše ověřené údaje k pacientovi v nemocnici. Co tam už je od nás (podle našeho id), se znovu nevytvoří;
 * co nemocnice vede sama (hospital = její záznamy pacienta), se nepošle vůbec.
 */
export async function sendVerifiedToHospital(client: FhirClient, patientId: string, infos: VerifiedInfo[], hospital: CaseFact[] = []): Promise<SendResult> {
  const fresh = infos.filter((info) => !alreadyInHospital(info, hospital));
  const resources = fresh.map((info) => ({ info, resource: toHospitalResource(info, `Patient/${patientId}`) }));
  const entries = resources.flatMap(({ info, resource }) =>
    resource
      ? [{ resource, request: { method: "POST", url: resource.resourceType, ifNoneExist: `identifier=${SYSTEMS.factId}|${info.id}` } }]
      : [],
  );
  const result: SendResult = { created: 0, existing: 0, known: infos.length - fresh.length, failed: 0, skipped: fresh.length - entries.length };
  if (!entries.length) return result;
  const response: any = await client.transaction({ resourceType: "Bundle", type: "batch", entry: entries });
  for (const entry of response.entry ?? []) {
    const status = String(entry.response?.status ?? "");
    if (status.startsWith("201")) result.created++;
    else if (status.startsWith("200")) result.existing++;
    else result.failed++;
  }
  return result;
}
