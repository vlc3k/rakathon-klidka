/* eslint-disable @typescript-eslint/no-explicit-any -- volné FHIR JSON bez typů */
import { EXT, LAB_CODES, SYSTEMS } from "./bundle";
import type { FhirClient } from "./client";
import type { AuthorRole, CaseDocument, CaseFact, CaseFlag, CaseTask, FactSource, PreopCase, Verification } from "./types";

/**
 * FHIR server → PreopCase.
 * Umí dvě situace:
 *  - data, která jsme tam zapsali my (poznáme podle našich identifikátorů) → obnoví se včetně původu a stavu ověření,
 *  - cizí data (nemocniční systém, Synthea) → údaje se stavem „převzato z nemocničního systému“ s odkazem na zdroj.
 */

type R = { resourceType: string; id: string; [key: string]: any };

export interface ImportOptions {
  /** id našeho případu; bez něj se vezme nejnovější, případně se založí nový „k potvrzení“ */
  caseId?: string;
  /** kolik posledních hodnot od každého cizího laboratorního parametru brát (default 3) */
  labsPerCode?: number;
}

export interface PatientSummary {
  fhirId: string;
  name: string;
  birthDate?: string;
  gender?: string;
}

/** LOINC → náš klíč pro hodnoty, které předoperační vyšetření potřebuje najít bez znalosti LOINC. */
const LOINC_KEYS: Record<string, string> = {
  "718-7": "hemoglobin",
  "4544-3": "hematocrit",
  "777-3": "platelets",
  "6690-2": "leukocytes",
  "2276-4": "ferritin",
  "6301-6": "inr",
  "5902-2": "prothrombin_time",
  "3173-2": "aptt",
  "38483-4": "creatinine",
  "2160-0": "creatinine",
  "33914-3": "egfr",
  "2947-0": "sodium",
  "2951-2": "sodium",
  "6298-4": "potassium",
  "2823-3": "potassium",
  "2339-0": "glucose",
  "2345-7": "glucose",
  "4548-4": "hba1c",
  "29463-7": "weight",
  "8302-2": "height",
  "39156-5": "bmi",
  "85354-9": "blood_pressure",
  "8867-4": "heart_rate",
  "59408-5": "spo2",
  "2708-6": "spo2",
  "72166-2": "smoking_status",
};

const ident = (r: R, system: string): string | undefined =>
  (r.identifier as { system?: string; value?: string }[] | undefined)?.find((i) => i.system === system)?.value;
const tag = (r: R, system: string): string | undefined =>
  (r.meta?.tag as { system?: string; code?: string }[] | undefined)?.find((t) => t.system === system)?.code;
const conceptText = (c: any): string | undefined => c?.text ?? c?.coding?.find((x: any) => x.display)?.display ?? c?.coding?.[0]?.code;
const day = (d?: string) => d?.slice(0, 10);

function patientName(p: R) {
  const n = p.name?.find((x: any) => x.use === "official") ?? p.name?.[0];
  return { given: n?.given?.join(" ") ?? "", family: n?.family ?? "" };
}

export async function listPatients(client: FhirClient, query?: string): Promise<PatientSummary[]> {
  const patients = await client.search<R>("Patient", { ...(query && { name: query }), _count: 100 });
  return patients.map((p) => {
    const n = patientName(p);
    return { fhirId: p.id, name: `${n.given} ${n.family}`.trim(), birthDate: p.birthDate, gender: p.gender };
  });
}

/** Hledání s přiloženými Provenance; když server _revinclude neumí, zkusí to bez. */
async function searchWithProvenance(client: FhirClient, type: string, params: Record<string, string | number>) {
  try {
    return await client.search<R>(type, { ...params, _revinclude: "Provenance:target" });
  } catch {
    return client.search<R>(type, params);
  }
}

export async function importPatient(client: FhirClient, patientFhirId: string, opts: ImportOptions = {}): Promise<PreopCase> {
  const pref = `Patient/${patientFhirId}`;
  const patient = await client.read<R>("Patient", patientFhirId);
  const types = [
    "Condition",
    "Observation",
    "MedicationStatement",
    "MedicationRequest",
    "AllergyIntolerance",
    "DocumentReference",
    "EpisodeOfCare",
    "ServiceRequest",
    "Task",
    "Flag",
  ];
  const results = await Promise.all(
    types.map((t) =>
      searchWithProvenance(client, t, { patient: pref, _count: 200 }).catch((e) => {
        console.warn(`[fhir import] ${t}: ${e.message}`);
        return [] as R[];
      }),
    ),
  );
  const all = results.flat();
  const byType = (t: string) => all.filter((r) => r.resourceType === t);
  const provenanceByTarget = new Map<string, R>();
  for (const p of byType("Provenance")) for (const t of p.target ?? []) provenanceByTarget.set(t.reference, p);

  // --- případ ---
  const episodes = byType("EpisodeOfCare")
    .filter((e) => ident(e, SYSTEMS.caseId))
    .sort((a, b) => String(b.period?.start).localeCompare(String(a.period?.start)));
  const episode = opts.caseId ? episodes.find((e) => ident(e, SYSTEMS.caseId) === opts.caseId) : episodes[0];
  const epRef = episode && `EpisodeOfCare/${episode.id}`;

  const diagnosisRef: string | undefined = episode?.diagnosis?.[0]?.condition?.reference;
  const diagnosisRes = diagnosisRef ? byType("Condition").find((c) => `Condition/${c.id}` === diagnosisRef) : undefined;
  const serviceRequests = byType("ServiceRequest").sort((a, b) =>
    String(b.occurrenceDateTime ?? b.authoredOn ?? "").localeCompare(String(a.occurrenceDateTime ?? a.authoredOn ?? "")),
  );
  const procedureRes =
    (epRef ? serviceRequests.find((s) => s.supportingInfo?.some((x: any) => x.reference === epRef)) : undefined) ??
    serviceRequests.find((s) => s.status === "active");
  const bleedingNote: string | undefined = procedureRes?.note?.find((n: any) => n.text?.startsWith("Riziko krevní ztráty"))?.text;

  // --- dokumenty ---
  const docIdByRef = new Map<string, string>();
  const documents: CaseDocument[] = byType("DocumentReference").map((d) => {
    const id = ident(d, SYSTEMS.documentId) ?? `DocumentReference-${d.id}`;
    docIdByRef.set(`DocumentReference/${d.id}`, id);
    const a = d.content?.[0]?.attachment ?? {};
    return {
      id,
      title: d.description ?? a.title ?? conceptText(d.type) ?? "Dokument",
      documentType: conceptText(d.type) ?? "dokument",
      contentType: a.contentType ?? "application/octet-stream",
      date: day(a.creation) ?? null,
      uploadedAt: d.date ?? d.meta?.lastUpdated ?? new Date().toISOString(),
      ...(a.data && { data: a.data }),
      ...(a.url && { url: a.url }),
      patientMatch: (tag(d, SYSTEMS.patientMatch) as CaseDocument["patientMatch"]) ?? "match",
    };
  });

  // --- údaje ---
  const factIdByRef = new Map<string, string>();
  const facts: CaseFact[] = [];
  const pushFact = (r: R, f: Omit<CaseFact, "id" | "verification" | "source">) => {
    const ref = `${r.resourceType}/${r.id}`;
    const id = ident(r, SYSTEMS.factId) ?? `${r.resourceType}-${r.id}`;
    factIdByRef.set(ref, id);
    const ours = tag(r, SYSTEMS.verification) as Verification | undefined;
    const ext = (url: string) => r.extension?.find((e: any) => e.url === `${EXT}/${url}`);
    facts.push({
      id,
      ...f,
      ...(ext("fact-label") && { label: ext("fact-label").valueString }),
      ...(ext("date-kind") && { dateKind: ext("date-kind").valueCode }),
      key: tag(r, SYSTEMS.factKey) ?? f.key,
      verification: ours ?? "source_system",
      source: sourceOf(r, ref, provenanceByTarget.get(ref), docIdByRef, client.baseUrl),
    });
  };

  // cizí laboratoř: jen posledních N hodnot od každého parametru (Synthea má stovky měření)
  const labsPerCode = opts.labsPerCode ?? 3;
  const seen = new Map<string, number>();
  const observations = byType("Observation").sort((a, b) => String(obsDate(b)).localeCompare(String(obsDate(a))));
  for (const o of observations) {
    const coding = o.code?.coding?.[0];
    const codeKey = coding ? `${coding.system}|${coding.code}` : conceptText(o.code) ?? o.id;
    const ours = !!ident(o, SYSTEMS.factId);
    if (!ours) {
      const n = (seen.get(codeKey) ?? 0) + 1;
      seen.set(codeKey, n);
      if (n > labsPerCode) continue;
    }
    const isLab = o.category?.some((c: any) => c.coding?.some((x: any) => x.code === "laboratory"));
    const loinc = o.code?.coding?.find((x: any) => x.system === SYSTEMS.loinc && LOINC_KEYS[x.code])?.code;
    let { value, unit } = obsValue(o);
    // PBM práh je v g/l; cizí systémy (Synthea, US laboratoře) posílají Hb v g/dl
    if (loinc === LAB_CODES.hemoglobin.code && typeof value === "number" && unit?.toLowerCase() === "g/dl") {
      value = Math.round(value * 100) / 10;
      unit = "g/L";
    }
    const effective = obsDate(o);
    const noteDate = /(\d{4}-\d{2}-\d{2})/.exec(o.note?.[0]?.text ?? "")?.[1];
    pushFact(o, {
      kind: isLab ? "lab" : "other",
      key: loinc ? LOINC_KEYS[loinc] : coding?.code ? `${coding.system === SYSTEMS.loinc ? "loinc" : "code"}:${coding.code}` : "observation",
      label: conceptText(o.code) ?? "Pozorování",
      value,
      unit,
      date: day(effective) ?? noteDate ?? null,
      dateKind: effective ? "collection" : o.note?.[0]?.text?.includes("datum dokumentu") ? "document" : "unknown",
      ...(coding && { code: { system: coding.system, code: coding.code, ...(coding.display && { display: coding.display }) } }),
    });
  }

  for (const c of byType("Condition")) {
    if (diagnosisRes && c.id === diagnosisRes.id) continue;
    const status = c.clinicalStatus?.coding?.[0]?.code;
    pushFact(c, {
      kind: "diagnosis",
      key: "diagnosis",
      label: "Diagnóza",
      value: conceptText(c.code) ?? null,
      date: day(c.recordedDate ?? c.onsetDateTime) ?? null,
      ...(status && { active: ["active", "recurrence", "relapse"].includes(status) }),
      ...codeOf(c.code),
    });
  }

  for (const m of [...byType("MedicationStatement"), ...byType("MedicationRequest")]) {
    pushFact(m, {
      kind: "medication",
      key: "medication",
      label: "Lék",
      value: conceptText(m.medicationCodeableConcept) ?? m.medicationReference?.display ?? null,
      date: day(m.dateAsserted ?? m.authoredOn ?? m.effectiveDateTime) ?? null,
      active: m.status === "active",
      ...codeOf(m.medicationCodeableConcept),
    });
  }

  for (const a of byType("AllergyIntolerance")) {
    pushFact(a, {
      kind: "allergy",
      key: "allergy",
      label: "Alergie",
      value: conceptText(a.code) ?? null,
      date: day(a.recordedDate) ?? null,
      ...codeOf(a.code),
    });
  }

  // --- úkoly a upozornění ---
  const tasks: CaseTask[] = byType("Task")
    .filter((t) => !epRef || !t.basedOn || t.basedOn.some((b: any) => b.reference === epRef))
    .map((t) => ({
      id: ident(t, SYSTEMS.taskId) ?? `Task-${t.id}`,
      code: t.code?.coding?.[0]?.code ?? "task",
      description: t.code?.text ?? t.description ?? "Úkol",
      status: ({ draft: "draft", requested: "requested", "in-progress": "in_progress", completed: "completed", cancelled: "cancelled" } as const)[
        t.status as string
      ] ?? "requested",
      createdAt: t.authoredOn ?? t.meta?.lastUpdated ?? new Date().toISOString(),
      ...(t.focus?.reference && factIdByRef.has(t.focus.reference) && { factId: factIdByRef.get(t.focus.reference) }),
    }));

  const flags: CaseFlag[] = byType("Flag")
    .filter((f) => f.status === "active")
    .map((f) => {
      const detail = f.extension?.find((e: any) => e.url === "http://hl7.org/fhir/StructureDefinition/flag-detail")?.valueReference?.reference;
      return {
        id: ident(f, SYSTEMS.flagId) ?? `Flag-${f.id}`,
        text: conceptText(f.code) ?? "Upozornění",
        ...(detail && factIdByRef.has(detail) && { factId: factIdByRef.get(detail) }),
      };
    });

  // --- pacient ---
  const n = patientName(patient);
  const phone = patient.telecom?.find((t: any) => t.system === "phone")?.value;
  const birthNumber = ident(patient, SYSTEMS.birthNumber);

  const statusMap = { waitlist: "waiting_confirmation", planned: "waiting_confirmation", active: "active", onhold: "active", finished: "finished", cancelled: "cancelled" } as const;

  return {
    id: (episode && ident(episode, SYSTEMS.caseId)) ?? `fhir-${patientFhirId}`,
    status: episode ? (statusMap[episode.status as keyof typeof statusMap] ?? "active") : "waiting_confirmation",
    department: episode?.managingOrganization?.display?.replace(/^AA – /, "") ?? null,
    createdAt: episode?.period?.start ?? new Date().toISOString(),
    patient: {
      id: ident(patient, SYSTEMS.patientId) ?? patientFhirId,
      givenName: n.given,
      familyName: n.family,
      birthDate: patient.birthDate ?? null,
      ...(patient.gender && { gender: patient.gender }),
      ...(phone && { phone }),
      ...(birthNumber && { birthNumber }),
      fhirRef: pref,
    },
    diagnosis: diagnosisRes
      ? { text: conceptText(diagnosisRes.code) ?? "", ...(icd10(diagnosisRes.code) && { icd10: icd10(diagnosisRes.code) }) }
      : null,
    procedure: {
      text: conceptText(procedureRes?.code) ?? "Neuvedeno – doplnit",
      scheduledAt: day(procedureRes?.occurrenceDateTime) ?? null,
      bleedingRiskOver500ml: bleedingNote ? bleedingNote.endsWith("ano") : null,
    },
    facts,
    documents,
    tasks,
    flags,
  };
}

function obsDate(o: R): string | undefined {
  return o.effectiveDateTime ?? o.effectivePeriod?.start ?? o.effectiveInstant;
}

function obsValue(o: R): { value: string | number | null; unit: string | null } {
  if (o.valueQuantity) return { value: o.valueQuantity.value ?? null, unit: o.valueQuantity.unit ?? o.valueQuantity.code ?? null };
  if (o.valueString != null) return { value: o.valueString, unit: null };
  if (o.valueCodeableConcept) return { value: conceptText(o.valueCodeableConcept) ?? null, unit: null };
  if (o.valueBoolean != null) return { value: o.valueBoolean ? "ano" : "ne", unit: null };
  if (o.component?.length) {
    // např. krevní tlak: systolický + diastolický
    const parts = o.component.map((c: any) => `${conceptText(c.code)}: ${c.valueQuantity?.value ?? conceptText(c.valueCodeableConcept) ?? "?"} ${c.valueQuantity?.unit ?? ""}`.trim());
    return { value: parts.join("; "), unit: null };
  }
  return { value: null, unit: null };
}

function codeOf(concept: any): Pick<CaseFact, "code"> | object {
  const c = concept?.coding?.[0];
  return c?.system && c?.code ? { code: { system: c.system, code: c.code, ...(c.display && { display: c.display }) } } : {};
}

function icd10(concept: any): string | undefined {
  return concept?.coding?.find((c: any) => c.system === SYSTEMS.icd10)?.code;
}

/** Původ údaje: z naší Provenance, jinak „převzato ze systému“ s odkazem na původní resource. */
function sourceOf(r: R, ref: string, prov: R | undefined, docIdByRef: Map<string, string>, baseUrl: string): FactSource {
  if (!prov) {
    return {
      author: "system",
      authorName: baseUrl,
      recordedAt: r.meta?.lastUpdated ?? new Date().toISOString(),
      method: "fhir_import",
      sourceRef: ref,
    };
  }
  const roleOf = (a: any): AuthorRole => a?.role?.[0]?.coding?.find((c: any) => c.system === `${EXT}/author-role`)?.code ?? "system";
  const nameOf = (a: any): string | undefined => {
    const d: string | undefined = a?.who?.display;
    const m = d && /^(.*) \([^)]*\)$/.exec(d);
    return m ? m[1] : undefined;
  };
  const author = prov.agent?.find((a: any) => a.type?.coding?.[0]?.code !== "verifier");
  const verifier = prov.agent?.find((a: any) => a.type?.coding?.[0]?.code === "verifier");
  const entity = prov.entity?.[0];
  const ext = (url: string) => (entity?.extension ?? prov.extension)?.find((e: any) => e.url === `${EXT}/${url}`);
  const docId = entity?.what?.reference && docIdByRef.get(entity.what.reference);
  const verifiedAt = verifier?.extension?.find((e: any) => e.url === `${EXT}/verified-at`)?.valueDateTime;
  return {
    author: roleOf(author),
    ...(nameOf(author) && { authorName: nameOf(author) }),
    recordedAt: prov.recorded,
    method: prov.activity?.coding?.[0]?.code ?? "fhir_import",
    ...(docId && { documentId: docId }),
    ...(ext("source-quote") && { quote: ext("source-quote").valueString }),
    ...(ext("source-page") && { page: ext("source-page").valueInteger }),
    ...(ext("extraction-confidence") && { confidence: ext("extraction-confidence").valueDecimal }),
    ...(verifier && verifiedAt && { verifiedBy: { role: roleOf(verifier), ...(nameOf(verifier) && { name: nameOf(verifier) }), at: verifiedAt } }),
  };
}
