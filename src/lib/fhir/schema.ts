import { z } from "zod";

/**
 * Datová „smlouva“ mezi hlavní aplikací a FHIR vrstvou.
 * Z tohoto souboru vznikají TS typy (types.ts), kontrola vstupu v API i JSON Schema (GET /fhir/schema).
 * Popisky (.describe) jsou návod pro ostatní – ukáže je i API při chybě.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/, "očekávám ISO datum, např. 2026-10-08");
const isoDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T/, "očekávám ISO datum a čas, např. 2026-10-16T14:10:00Z");

export const Verification = z
  .enum(["ai_extracted", "patient_confirmed", "clinician_verified", "source_system"])
  .describe("Stav ověření: AI extrahováno / potvrzeno pacientem / ověřeno zdravotníkem / převzato z nemocničního systému");

export const AuthorRole = z
  .enum(["patient", "helper", "proxy", "legal_guardian", "clinician", "ai", "system"])
  .describe("Kdo údaj dodal: pacient / pomocník / pověřená osoba / zák. zástupce / zdravotník / AI / jiný systém");

export const FactSource = z
  .object({
    author: AuthorRole,
    authorName: z.string().optional().describe("Jméno osoby, název AI modelu nebo systému"),
    recordedAt: isoDateTime.describe("Kdy údaj vznikl u nás"),
    method: z.enum(["document_extraction", "patient_entry", "clinician_entry", "rule", "fhir_import"]),
    documentId: z.string().optional().describe("id dokumentu z PreopCase.documents, odkud údaj je"),
    quote: z.string().optional().describe("Doslovný úryvek z dokumentu"),
    page: z.number().int().optional(),
    confidence: z.number().min(0).max(1).optional().describe("Jistota strojové extrakce 0–1"),
    verifiedBy: z
      .object({ role: AuthorRole, name: z.string().optional(), at: isoDateTime })
      .optional()
      .describe("Kdo a kdy údaj ověřil"),
    sourceRef: z.string().optional().describe("U importu: původní FHIR resource, např. Observation/123"),
  })
  .describe("Původ údaje → FHIR Provenance");

export const Coding = z.object({ system: z.string(), code: z.string(), display: z.string().optional() });

export const FactKind = z.enum(["lab", "diagnosis", "medication", "allergy", "other"]);

export const CaseFact = z
  .object({
    id: z.string().min(1).describe("STABILNÍ id údaje (při změně id vznikne ve FHIR duplicita)"),
    kind: FactKind.describe("lab → Observation, diagnosis → Condition, medication → MedicationStatement, allergy → AllergyIntolerance"),
    key: z.string().describe('Strojový klíč, např. "hemoglobin" (stejné klíče jako doc-intake)'),
    label: z.string().describe("Lidský název"),
    value: z.union([z.string(), z.number(), z.null()]),
    unit: z.string().nullish(),
    date: isoDate.nullish().describe("Datum, ke kterému údaj platí – u laboratoře datum ODBĚRU"),
    dateKind: z.enum(["collection", "document", "unknown"]).optional().describe("collection = datum odběru, document = jen datum dokumentu"),
    active: z.boolean().optional().describe("U diagnóz/léků: aktuální (true) nebo jen v anamnéze (false)"),
    code: Coding.optional().describe("LOINC / ICD-10 / ATC…; u známých klíčů (hemoglobin) se doplní sám"),
    verification: Verification,
    source: FactSource,
  })
  .describe("Jeden údaj v profilu pacienta");

export const CaseDocument = z
  .object({
    id: z.string().min(1).describe("STABILNÍ id dokumentu"),
    title: z.string(),
    documentType: z.string().describe('"laboratorní výsledky", "propouštěcí zpráva"…'),
    contentType: z.string().describe("MIME typ, např. application/pdf"),
    date: isoDate.nullish().describe("Datum dokumentu (≠ datum jednotlivých údajů)"),
    uploadedAt: isoDateTime,
    data: z.string().optional().describe("Obsah v base64 (menší soubory)"),
    url: z.string().optional().describe("Nebo odkaz na uložený soubor"),
    patientMatch: z.enum(["match", "mismatch", "uncertain"]).describe("Výsledek párování dokumentu na pacienta"),
  })
  .describe("Nahraný dokument – originál");

export const CaseTask = z
  .object({
    id: z.string().min(1),
    code: z.string().describe('např. "pbm_assessment", "control_blood_draw"'),
    description: z.string(),
    status: z.enum(["draft", "requested", "in_progress", "completed", "cancelled"]),
    createdAt: isoDateTime,
    factId: z.string().optional().describe("Údaj, kterého se úkol týká"),
  })
  .describe("Úkol v procesu (stav procesu ≠ stav informace)");

export const CaseFlag = z.object({ id: z.string().min(1), text: z.string(), factId: z.string().optional() }).describe("Upozornění POZOR");

export const CasePatient = z.object({
  id: z.string().min(1).describe("Naše ID pacienta"),
  givenName: z.string(),
  familyName: z.string(),
  birthDate: isoDate.nullish(),
  gender: z.enum(["male", "female", "other", "unknown"]).optional(),
  phone: z.string().nullish(),
  birthNumber: z.string().nullish(),
  insuranceNumber: z.string().nullish(),
  fhirRef: z.string().optional().describe("U importu: existující Patient na FHIR serveru, např. Patient/123"),
});

export const PreopCase = z
  .object({
    id: z.string().min(1).describe("STABILNÍ id případu"),
    status: z.enum(["waiting_confirmation", "active", "finished", "cancelled"]),
    department: z.string().nullish().describe("Část AA: chirurgie, urologie, gynekologie…"),
    createdAt: isoDateTime,
    patient: CasePatient,
    diagnosis: z.object({ text: z.string(), icd10: z.string().optional() }).nullish(),
    procedure: z.object({
      text: z.string(),
      scheduledAt: isoDate.nullish().describe("Termín operace"),
      bleedingRiskOver500ml: z.boolean().nullish(),
    }),
    facts: z.array(CaseFact),
    documents: z.array(CaseDocument),
    tasks: z.array(CaseTask),
    flags: z.array(CaseFlag).optional(),
  })
  .superRefine((c, ctx) => {
    const docIds = new Set(c.documents.map((d) => d.id));
    const factIds = new Set(c.facts.map((f) => f.id));
    c.facts.forEach((f, i) => {
      if (f.source.documentId && !docIds.has(f.source.documentId))
        ctx.addIssue({ code: "custom", path: ["facts", i, "source", "documentId"], message: `dokument "${f.source.documentId}" není v documents` });
    });
    for (const [list, name] of [[c.tasks, "tasks"], [c.flags ?? [], "flags"]] as const)
      list.forEach((t, i) => {
        if (t.factId && !factIds.has(t.factId))
          ctx.addIssue({ code: "custom", path: [name, i, "factId"], message: `údaj "${t.factId}" není ve facts` });
      });
  })
  .describe("Případ = jedna epizoda předoperační přípravy k jednomu plánovanému výkonu");

/** Zkontroluje data od aplikace; vrací buď data, nebo srozumitelný seznam chyb. */
export function validateCase(input: unknown) {
  const r = PreopCase.safeParse(input);
  if (r.success) return { ok: true as const, data: r.data };
  return {
    ok: false as const,
    errors: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}

export const caseJsonSchema = () => z.toJSONSchema(PreopCase, { io: "input", unrepresentable: "any" });
