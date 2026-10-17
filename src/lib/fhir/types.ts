/**
 * TS typy odvozené ze schema.ts – jediný zdroj pravdy je tam.
 * Hlavní aplikace si drží vlastní model a převádí ho na PreopCase.
 */
import type { z } from "zod";
import type * as S from "./schema";

export type Verification = z.infer<typeof S.Verification>;
export type AuthorRole = z.infer<typeof S.AuthorRole>;
export type FactSource = z.infer<typeof S.FactSource>;
export type Coding = z.infer<typeof S.Coding>;
export type FactKind = z.infer<typeof S.FactKind>;
export type CaseFact = z.infer<typeof S.CaseFact>;
export type CaseDocument = z.infer<typeof S.CaseDocument>;
export type CaseTask = z.infer<typeof S.CaseTask>;
export type CaseFlag = z.infer<typeof S.CaseFlag>;
export type CasePatient = z.infer<typeof S.CasePatient>;
export type PreopCase = z.infer<typeof S.PreopCase>;
