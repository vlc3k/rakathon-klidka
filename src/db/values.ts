import { z } from "zod";
import { AIRWAY_FINDINGS, INFORMATION_TYPES, type AirwayFinding, type InformationTypeCode } from "@/db/catalog";

// Tvar information.value podle typu z katalogu. Navíc pole neprojdou (strictObject),
// takže do JSON sloupce se nedostane nic, s čím pravidla a FE nepočítají.

const text = z.string().trim().min(1).max(2000);
const shortText = z.string().trim().min(1).max(200);
const none = z.strictObject({ none: z.literal(true) }); // „nemám žádné“
const unit = z.string().trim().max(32).nullable().optional();
const limit = z.number().finite().nullable().optional();
const flag = z.enum(["L", "H"]).nullable().optional();

const lab = z.strictObject({ value: z.number().finite(), unit, refLow: limit, refHigh: limit, referenceRange: z.string().max(64).optional(), flag });
const coded = z.strictObject({ text, icd10: z.string().regex(/^[A-Z]\d{2}(\.\d{1,2})?$/).optional() });
const yesNo = z.strictObject({ value: z.boolean() });
const freeText = z.strictObject({ text });
const measure = (code: "weight" | "height") => {
  const [min, max] = INFORMATION_TYPES[code].answerRange;
  return z.strictObject({ value: z.number().min(min).max(max), unit: z.string().trim().min(1).max(16) });
};

const SCHEMAS: Record<InformationTypeCode, z.ZodType> = {
  diagnosis: coded,
  condition: z.union([coded, none]),
  known_anemia: yesNo,
  hemoglobin: lab,
  ferritin: lab,
  transferrin_saturation: lab,
  crp: lab,
  platelets: lab,
  leukocytes: lab,
  creatinine: lab,
  lab_other: z.strictObject({ name: shortText, value: z.union([z.number().finite(), shortText]), unit, refLow: limit, refHigh: limit, referenceRange: z.string().max(64).optional(), flag }),
  weight: measure("weight"),
  height: measure("height"),
  medication: z.union([z.strictObject({ name: shortText, strength: shortText.optional(), dose: shortText.optional(), reason: shortText.optional() }), none]),
  allergy: z.union([z.strictObject({ substance: shortText, reaction: shortText.optional() }), none]),
  anesthesia_complication: z.union([z.strictObject({ text, year: z.number().int().min(1900).max(2100).optional() }), none]),
  functional_capacity: yesNo,
  oncology_treatment: z.union([
    z.strictObject({ kind: z.enum(["chemotherapy", "radiotherapy", "immunotherapy", "hormonal", "surgery", "other"]), lastDate: z.iso.date().optional() }),
    none,
  ]),
  symptom: z.union([freeText, none]),
  note: freeText,
  airway_assessment: z.strictObject({
    mallampati: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable(),
    findings: z.array(z.enum(Object.keys(AIRWAY_FINDINGS) as [AirwayFinding, ...AirwayFinding[]])).max(10),
    note: z.string().trim().max(500).optional(),
  }),
};

export const isInformationType = (type: string): type is InformationTypeCode => Object.hasOwn(INFORMATION_TYPES, type);

export type ValueIssue = { path: string; message: string };

export function parseInformationValue(type: string, value: unknown): { success: true; value: unknown } | { success: false; issues: ValueIssue[] } {
  if (!isInformationType(type)) return { success: false, issues: [{ path: "type", message: "Neznámý typ informace." }] };
  const result = SCHEMAS[type].safeParse(value);
  if (result.success) return { success: true, value: result.data };
  return { success: false, issues: result.error.issues.map((issue) => ({ path: ["value", ...issue.path].join("."), message: issue.message })) };
}
