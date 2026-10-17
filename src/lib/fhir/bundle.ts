import { createHash } from "node:crypto";
import type { AuthorRole, CaseDocument, CaseFact, CaseFlag, CaseTask, Coding, PreopCase, Verification } from "./types";

/** Naše vlastní identifikátory a tagy. Až zadavatel dodá profil, přepíšeme na jejich systémy. */
export const SYSTEMS = {
  patientId: "urn:smart-onco-aa:patient-id",
  caseId: "urn:smart-onco-aa:case-id",
  factId: "urn:smart-onco-aa:fact-id",
  documentId: "urn:smart-onco-aa:document-id",
  taskId: "urn:smart-onco-aa:task-id",
  flagId: "urn:smart-onco-aa:flag-id",
  verification: "urn:smart-onco-aa:verification",
  patientMatch: "urn:smart-onco-aa:patient-match",
  taskCode: "urn:smart-onco-aa:task",
  factKey: "urn:smart-onco-aa:fact-key",
  /** rodné číslo – systém z CZ Core (ověřit u zadavatele) */
  birthNumber: "https://ncez.mzcr.cz/fhir/sid/rcis",
  loinc: "http://loinc.org",
  icd10: "http://hl7.org/fhir/sid/icd-10",
  ucum: "http://unitsofmeasure.org",
} as const;

export const EXT = "https://smart-onco-aa.example/fhir/StructureDefinition";

/** Známé klíče z doc-intake → LOINC. */
export const LAB_CODES: Record<string, Coding> = {
  hemoglobin: { system: SYSTEMS.loinc, code: "718-7", display: "Hemoglobin [Mass/volume] in Blood" },
};

/** Jednotky z dokumentů → UCUM. */
const UCUM: Record<string, string> = { "g/l": "g/L", "g/dl": "g/dL", "mmol/l": "mmol/L", "%": "%" };

/** Práh anémie pro PBM (zadání: Hb < 120 g/l). */
const HB_LOW_G_PER_L = 120;

export type BundleMode =
  /** pro zápis do FHIR serveru: PUT s našimi id → opakované odeslání nevytváří duplicity */
  | "transaction"
  /** pro export souboru (povinný výstup zadání) */
  | "collection";

export interface BuildOptions {
  mode?: BundleMode;
  /** absolutní base URL pro fullUrl (u exportu nemusí existovat) */
  baseUrl?: string;
}

type Resource = { resourceType: string; id: string; [key: string]: unknown };
type Ref = { reference: string };

/** FHIR id: [A-Za-z0-9-.]{1,64}. Dlouhá id zkrátíme hashem. */
export function fhirId(...parts: string[]): string {
  const raw = parts.join("-").replace(/[^A-Za-z0-9.-]/g, "-");
  return raw.length <= 64 ? raw : createHash("sha1").update(raw).digest("hex");
}

/** FHIR `instant` vyžaduje čas i časové pásmo. */
function instant(value: string): string {
  return /T.*(Z|[+-]\d\d:\d\d)$/.test(value) ? value : new Date(value).toISOString();
}

const ref = (r: Resource): Ref => ({ reference: `${r.resourceType}/${r.id}` });

export const VERIFICATION_LABELS: Record<Verification, string> = {
  ai_extracted: "AI extrahováno",
  patient_confirmed: "Potvrzeno pacientem",
  clinician_verified: "Ověřeno zdravotníkem",
  source_system: "Převzato z nemocničního systému",
};

/** Stav ověření → Condition/AllergyIntolerance.verificationStatus. */
function clinicalVerification(v: Verification, system: string) {
  const code = { ai_extracted: "unconfirmed", patient_confirmed: "provisional", clinician_verified: "confirmed", source_system: "confirmed" }[v];
  return { coding: [{ system, code }] };
}

function numericValue(value: CaseFact["value"]): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value.replace(",", ".").trim());
    return Number.isFinite(n) && value.trim() !== "" ? n : null;
  }
  return null;
}

/** Údaj převzatý z FHIR serveru – při zápisu zpět ho jen odkazujeme, nekopírujeme. */
const isImported = (f: CaseFact) => f.source.method === "fhir_import" && !!f.source.sourceRef;

export function buildBundle(c: PreopCase, opts: BuildOptions = {}) {
  const mode = opts.mode ?? "collection";
  const baseUrl = (opts.baseUrl ?? "https://smart-onco-aa.example/fhir").replace(/\/$/, "");
  const id = (...parts: string[]) => fhirId(c.id, ...parts);
  const resources: Resource[] = [];
  const add = <T extends Resource>(r: T) => (resources.push(r), r);

  const p = c.patient;
  let subject: Ref;
  if (mode === "transaction" && p.fhirRef) {
    subject = { reference: p.fhirRef };
  } else {
    subject = ref(
      add({
        resourceType: "Patient",
        id: p.fhirRef?.split("/")[1] ?? fhirId("pat", p.id),
        identifier: [
          { system: SYSTEMS.patientId, value: p.id },
          ...(p.birthNumber ? [{ system: SYSTEMS.birthNumber, value: p.birthNumber }] : []),
        ],
        name: [{ use: "official", family: p.familyName, given: [p.givenName] }],
        ...(p.gender && { gender: p.gender }),
        ...(p.birthDate && { birthDate: p.birthDate }),
        ...(p.phone && { telecom: [{ system: "phone", value: p.phone, use: "mobile" }] }),
      }),
    );
  }

  const diagnosis =
    c.diagnosis &&
    add({
      resourceType: "Condition",
      id: id("dg"),
      clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] },
      category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-category", code: "encounter-diagnosis" }] }],
      code: {
        ...(c.diagnosis.icd10 && { coding: [{ system: SYSTEMS.icd10, code: c.diagnosis.icd10 }] }),
        text: c.diagnosis.text,
      },
      subject,
    });

  const episode = add({
    resourceType: "EpisodeOfCare",
    id: id("case"),
    identifier: [{ system: SYSTEMS.caseId, value: c.id }],
    status: { waiting_confirmation: "waitlist", active: "active", finished: "finished", cancelled: "cancelled" }[c.status],
    type: [{ text: "Předoperační příprava – anesteziologická ambulance" }],
    ...(c.department && { managingOrganization: { display: `AA – ${c.department}` } }),
    ...(diagnosis && { diagnosis: [{ condition: ref(diagnosis) }] }),
    patient: subject,
    period: { start: instant(c.createdAt) },
  });
  const episodeRef = ref(episode);

  add({
    resourceType: "ServiceRequest",
    id: id("procedure"),
    status: "active",
    intent: "order",
    category: [{ coding: [{ system: "http://snomed.info/sct", code: "387713003", display: "Surgical procedure" }] }],
    code: { text: c.procedure.text },
    subject,
    ...(c.procedure.scheduledAt && { occurrenceDateTime: c.procedure.scheduledAt }),
    ...(diagnosis && { reasonReference: [ref(diagnosis)] }),
    ...(c.procedure.bleedingRiskOver500ml != null && {
      note: [{ text: `Riziko krevní ztráty > 500 ml: ${c.procedure.bleedingRiskOver500ml ? "ano" : "ne"}` }],
    }),
    supportingInfo: [episodeRef],
  });

  const docs = new Map<string, Ref>();
  for (const d of c.documents) docs.set(d.id, ref(add(documentReference(d, id("doc", d.id), subject, episodeRef))));

  const facts = new Map<string, Ref>();
  for (const f of c.facts) {
    if (mode === "transaction" && isImported(f)) {
      facts.set(f.id, { reference: f.source.sourceRef! });
      continue;
    }
    const r = add(factResource(f, id("fact", f.id), subject));
    facts.set(f.id, ref(r));
    add(provenance(f, id("prov", f.id), r, docs.get(f.source.documentId ?? "")));
  }

  for (const t of c.tasks) add(task(t, id("task", t.id), subject, episodeRef, facts.get(t.factId ?? "")));
  for (const fl of c.flags ?? []) add(flag(fl, id("flag", fl.id), subject, facts.get(fl.factId ?? "")));

  return {
    resourceType: "Bundle",
    type: mode,
    ...(mode === "collection" && { timestamp: new Date().toISOString() }),
    entry: resources.map((r) => ({
      fullUrl: `${baseUrl}/${r.resourceType}/${r.id}`,
      resource: r,
      ...(mode === "transaction" && { request: { method: "PUT", url: `${r.resourceType}/${r.id}` } }),
    })),
  };
}

function factResource(f: CaseFact, id: string, subject: Ref): Resource {
  const meta = {
    tag: [
      { system: SYSTEMS.verification, code: f.verification, display: VERIFICATION_LABELS[f.verification] },
      { system: SYSTEMS.factKey, code: f.key },
    ],
  };
  const identifier = [{ system: SYSTEMS.factId, value: f.id }];
  const code = f.code ?? LAB_CODES[f.key];
  const concept = { ...(code && { coding: [code] }), text: f.label };
  const valueText = [f.value, f.unit].filter((x) => x != null && x !== "").join(" ");
  const named = f.value != null ? { ...concept, text: String(f.value) } : concept;
  // label a druh data FHIR přímo nemá – necháme je v extensions, ať se při importu obnoví
  const extension = [
    { url: `${EXT}/fact-label`, valueString: f.label },
    ...(f.dateKind ? [{ url: `${EXT}/date-kind`, valueCode: f.dateKind }] : []),
  ];
  const base = { id, meta, identifier, extension };

  switch (f.kind) {
    case "diagnosis":
      return {
        resourceType: "Condition",
        ...base,
        ...(f.active != null && {
          clinicalStatus: {
            coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: f.active ? "active" : "resolved" }],
          },
        }),
        verificationStatus: clinicalVerification(f.verification, "http://terminology.hl7.org/CodeSystem/condition-ver-status"),
        code: named,
        subject,
        ...(f.date && { recordedDate: f.date }),
      };
    case "allergy":
      return {
        resourceType: "AllergyIntolerance",
        ...base,
        verificationStatus: clinicalVerification(f.verification, "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification"),
        code: named,
        patient: subject,
        ...(f.date && { recordedDate: f.date }),
      };
    case "medication":
      return {
        resourceType: "MedicationStatement",
        ...base,
        status: f.active === false ? "completed" : "active",
        medicationCodeableConcept: f.value != null ? { ...concept, text: valueText } : concept,
        subject,
        ...(f.date && { dateAsserted: f.date }),
      };
    case "lab":
    case "other": {
      const num = numericValue(f.value);
      const unit = f.unit ? (UCUM[f.unit.toLowerCase()] ?? f.unit) : undefined;
      const isHb = code?.code === LAB_CODES.hemoglobin.code;
      const hbInGl = isHb && num != null ? (unit === "g/dL" ? num * 10 : num) : null;
      const verified = f.verification === "clinician_verified" || f.verification === "source_system";
      return {
        resourceType: "Observation",
        ...base,
        // neověřený údaj = preliminary; klinická akce se smí spustit jen z final
        status: verified ? "final" : "preliminary",
        ...(f.kind === "lab" && {
          category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
        }),
        code: concept,
        subject,
        // effective = datum ODBĚRU; datum dokumentu sem nepatří
        ...(f.date && f.dateKind === "collection" && { effectiveDateTime: f.date }),
        ...(f.date &&
          f.dateKind !== "collection" && {
            note: [{ text: `Datum odběru neznámé; ${f.dateKind === "document" ? "datum dokumentu" : "datum"} ${f.date}` }],
          }),
        ...(num != null
          ? { valueQuantity: { value: num, ...(unit && { unit, system: SYSTEMS.ucum, code: unit }) } }
          : f.value != null && { valueString: valueText }),
        ...(hbInGl != null &&
          hbInGl < HB_LOW_G_PER_L && {
            interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "L" }] }],
          }),
      };
    }
  }
}

const PARTICIPANT = "http://terminology.hl7.org/CodeSystem/provenance-participant-type";

export const ROLE_LABELS: Record<AuthorRole, string> = {
  patient: "pacient",
  helper: "pomocník",
  proxy: "pověřená osoba",
  legal_guardian: "zákonný zástupce",
  clinician: "zdravotník",
  ai: "AI",
  system: "systém",
};

function agent(code: string, role: AuthorRole, name?: string) {
  return {
    type: { coding: [{ system: PARTICIPANT, code }] },
    role: [{ coding: [{ system: `${EXT}/author-role`, code: role }], text: ROLE_LABELS[role] }],
    who: { display: name ? `${name} (${ROLE_LABELS[role]})` : ROLE_LABELS[role] },
  };
}

/** Provenance = odkud údaj je, kdo ho dodal, zda ho vytáhla AI a kdo ho ověřil. */
function provenance(f: CaseFact, id: string, target: Resource, doc?: Ref): Resource {
  const s = f.source;
  const ext = [
    ...(s.quote ? [{ url: `${EXT}/source-quote`, valueString: s.quote }] : []),
    ...(s.page != null ? [{ url: `${EXT}/source-page`, valueInteger: s.page }] : []),
    ...(s.confidence != null ? [{ url: `${EXT}/extraction-confidence`, valueDecimal: s.confidence }] : []),
  ];
  const source = doc ?? (s.sourceRef ? { reference: s.sourceRef } : undefined);
  return {
    resourceType: "Provenance",
    id,
    target: [ref(target)],
    recorded: instant(s.recordedAt),
    activity: { coding: [{ system: `${EXT}/method`, code: s.method }] },
    agent: [
      agent(s.author === "ai" ? "assembler" : "author", s.author, s.authorName),
      ...(s.verifiedBy ? [{ ...agent("verifier", s.verifiedBy.role, s.verifiedBy.name), extension: [{ url: `${EXT}/verified-at`, valueDateTime: s.verifiedBy.at }] }] : []),
    ],
    ...(source && { entity: [{ role: "source", what: source, ...(ext.length && { extension: ext }) }] }),
    ...(!source && ext.length && { extension: ext }),
  };
}

function documentReference(d: CaseDocument, id: string, subject: Ref, episode: Ref): Resource {
  return {
    resourceType: "DocumentReference",
    id,
    meta: { tag: [{ system: SYSTEMS.patientMatch, code: d.patientMatch }] },
    identifier: [{ system: SYSTEMS.documentId, value: d.id }],
    status: "current",
    type: { text: d.documentType },
    // při nejisté vazbě na pacienta necháme odkaz, ale tag říká, že nesmí spustit klinickou akci
    subject,
    date: instant(d.uploadedAt),
    description: d.title,
    content: [
      {
        attachment: {
          contentType: d.contentType,
          title: d.title,
          ...(d.data && { data: d.data }),
          ...(d.url && { url: d.url }),
          ...(d.date && { creation: d.date }),
        },
      },
    ],
    context: { related: [episode] },
  };
}

function task(t: CaseTask, id: string, subject: Ref, episode: Ref, fact?: Ref): Resource {
  return {
    resourceType: "Task",
    id,
    identifier: [{ system: SYSTEMS.taskId, value: t.id }],
    status: { draft: "draft", requested: "requested", in_progress: "in-progress", completed: "completed", cancelled: "cancelled" }[t.status],
    intent: "order",
    code: { coding: [{ system: SYSTEMS.taskCode, code: t.code }], text: t.description },
    for: subject,
    ...(fact && { focus: fact }),
    authoredOn: t.createdAt,
    basedOn: [episode],
  };
}

function flag(f: CaseFlag, id: string, subject: Ref, fact?: Ref): Resource {
  return {
    resourceType: "Flag",
    id,
    identifier: [{ system: SYSTEMS.flagId, value: f.id }],
    status: "active",
    code: { text: f.text },
    subject,
    ...(fact && { extension: [{ url: "http://hl7.org/fhir/StructureDefinition/flag-detail", valueReference: fact }] }),
  };
}
