// FHIR R4 vrstva (export PreopCase → Bundle, import z FHIR serveru). Zdroj: packages/fhir, bez Hono API.
// Jen pro server: klient posílá přihlašovací údaje k FHIR serveru.
export { buildBundle, fhirId, SYSTEMS, VERIFICATION_LABELS, ROLE_LABELS } from "./bundle";
export type { BuildOptions, BundleMode } from "./bundle";
export { FhirClient, FhirError } from "./client";
export type { FhirClientOptions } from "./client";
export { fromExtraction } from "./fromExtraction";
export type { ExtractionLike } from "./fromExtraction";
export { importPatient, listPatients } from "./import";
export type { ImportOptions, PatientSummary } from "./import";
export { PreopCase as PreopCaseSchema, validateCase, caseJsonSchema } from "./schema";
export type * from "./types";
