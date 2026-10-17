import { z } from "zod";
import { DOCUMENT_TYPES, CLIENT_DOCUMENT_TYPES, type DocumentType } from "@/db/catalog";

// Standard výstupu AI pro čtení lékařských zpráv. Jeden zdroj pravdy: z těchto schémat vzniká
// JSON schéma pro model (strict structured outputs), TypeScript typy i kontrola odpovědi za běhu.
//
// Čte se ve dvou krocích:
// 1. přepis stránky (fotka → řádky textu s polohou a jistotou), každá stránka zvlášť
// 2. hodnoty z přepisu všech stránek dokumentu; každá hodnota odkazuje na řádky, odkud je,
//    takže polohu na fotce dopočítá kód z řádků a model si ji nevymýšlí
//
// Změna tvaru výstupu = zvýšit SCHEMA_VERSION (ukládá se k přepisu i ke stránce).
export const SCHEMA_VERSION = 1;

// Jistota AI 0–100: jak jistě údaj přečetla (100 = zcela čitelné a jednoznačné, pod 50 = spíš odhad).
const confidence = z.int().min(0).max(100);
// Obdélník kolem řádku na fotce [x0, y0, x1, y1] v 0–1000 vůči šířce a výšce.
const box = z.array(z.int().min(0).max(1000)).length(4);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// Id řádků přepisu, ze kterých údaj je (např. "p1-l12" = strana 1, řádek 12).
const lines = z.array(z.string().regex(/^p\d{1,2}-l\d{1,4}$/));
const text = z.string().min(1).max(500);

// ---------------------------------------------------------------- 1. přepis stránky

export const pageTranscriptSchema = z.strictObject({
  legibility: z.enum(["good", "partial", "poor"]),
  lines: z.array(
    z.strictObject({
      text: z.string().max(2000),
      box: box.nullable(),
      confidence,
    }),
  ),
});
export type PageTranscriptOutput = z.infer<typeof pageTranscriptSchema>;

// Uložený přepis stránky (documents.transcript): řádky dostanou id podle pořadí ("l1", "l2", …).
// S page.quad četla AI narovnanou stránku (lib/server/transcripts/geometry.ts): box řádku je na narovnané stránce
// a quad říká, kde ta stránka leží v původní fotce. Bez page je box přímo v původní fotce.
export type TranscriptLine = { id: string; text: string; box: [number, number, number, number] | null; confidence: number };
export type PageTranscript = {
  legibility: PageTranscriptOutput["legibility"];
  lines: TranscriptLine[];
  page?: { quad: [[number, number], [number, number], [number, number], [number, number]] };
};

// ---------------------------------------------------------------- 2. hodnoty z přepisu

// Typy lékařských zpráv z katalogu (bez fotky, podpisu a hlasovky, ty AI nečte).
export const MEDICAL_DOCUMENT_TYPES = (Object.keys(DOCUMENT_TYPES) as DocumentType[]).filter(
  (type) => !(CLIENT_DOCUMENT_TYPES as readonly string[]).includes(type),
) as [DocumentType, ...DocumentType[]];

// Laboratorní typy z katalogu, se kterými pracují pravidla. Ostatní výsledky jsou "other" (lab_other).
export const LAB_TYPES = ["hemoglobin", "ferritin", "transferrin_saturation", "crp", "platelets", "leukocytes", "creatinine", "other"] as const;

const sourced = { confidence, lines };

export const extractionSchema = z.strictObject({
  document: z.strictObject({
    type: z.enum(MEDICAL_DOCUMENT_TYPES),
    issuedDate: isoDate.nullable(),
    institution: text.nullable(),
    lines,
  }),
  patient: z.strictObject({
    name: z.strictObject({ text, ...sourced }).nullable(),
    birthNumber: z.strictObject({ text: z.string().min(1).max(20), ...sourced }).nullable(),
  }),
  labs: z.array(
    z.strictObject({
      type: z.enum(LAB_TYPES),
      name: text,
      value: z.number().nullable(),
      valueText: z.string().min(1).max(100),
      unit: z.string().max(32).nullable(),
      refLow: z.number().nullable(),
      refHigh: z.number().nullable(),
      flag: z.enum(["L", "H"]).nullable(),
      observedDate: isoDate.nullable(),
      dateKind: z.enum(["collection", "document", "unknown"]),
      ...sourced,
    }),
  ),
  medications: z.array(
    z.strictObject({
      name: z.string().min(1).max(200),
      strength: z.string().min(1).max(200).nullable(),
      dose: z.string().min(1).max(200).nullable(),
      ...sourced,
    }),
  ),
  allergies: z.strictObject({
    status: z.enum(["listed", "denied", "not_mentioned"]),
    items: z.array(z.strictObject({ substance: z.string().min(1).max(200), reaction: z.string().min(1).max(200).nullable(), ...sourced })),
    lines,
  }),
  conditions: z.array(
    z.strictObject({
      text,
      icd10: z.string().regex(/^[A-Z]\d{2}(\.\d{1,2})?$/).nullable(),
      ...sourced,
    }),
  ),
  procedure: z.strictObject({ text, ...sourced }).nullable(),
  issues: z.array(
    z.strictObject({
      code: z.enum([
        "illegible",
        "missing_sample_date",
        "values_and_ranges_inconsistent",
        "partial_page",
        "redacted",
        "patient_identity_unclear",
        "old_document",
        "not_medical",
        "other",
      ]),
      detail: z.string().min(1).max(500),
      lines,
    }),
  ),
});
export type Extraction = z.infer<typeof extractionSchema>;

// JSON schéma pro strict structured outputs: všechna pole povinná (nepovinné je null), bez navíc polí.
export function modelSchema(schema: z.ZodType) {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}
