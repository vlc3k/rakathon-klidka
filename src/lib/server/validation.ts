import { z } from "zod";

// Společné validátory vstupu API.

export const personName = z.string().trim().min(1).max(100);
export const phone = z.string().trim().regex(/^\+?[0-9 ()-]{6,24}$/, "Neplatné telefonní číslo.");
export const isoDate = z.iso.date();
export const isoDateTime = z.iso.datetime({ offset: true });
export const icd10 = z.string().trim().toUpperCase().regex(/^[A-Z]\d{2}(\.\d{1,2})?$/, "Neplatný kód MKN-10.");

export const diagnosisSchema = z.strictObject({
  text: z.string().trim().min(1).max(500),
  icd10: icd10.optional(),
});
export type Diagnosis = z.infer<typeof diagnosisSchema>;

// ?flag=true v query
export const queryFlag = z.enum(["true", "false"]).transform((v) => v === "true");

// Hledaný text do ILIKE: zástupné znaky z uživatelského vstupu se berou doslova.
export const likePattern = (query: string) => `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
