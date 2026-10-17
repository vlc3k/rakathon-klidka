"use client";

import { createContext, useContext, useState } from "react";
import type { ApiError } from "@/lib/api/client";
import type { Patient } from "@/lib/api/types";

// Data pacientů a zákroků jsou v API (/api/v1/patients, /api/v1/cases). Tady je jen stav seznamu
// pacientů (filtry a řazení), který přežije odchod na úpravu a návrat, a pomocné funkce.

export type PatientCase = Patient["cases"][number];

export type SortKey = "name" | "createdAt" | "caseDate";
export type Sort = { key: SortKey; dir: "asc" | "desc" };
export type DateRange = { from: string; to: string; includeUndated: boolean };
export type Filters = DateRange & { query: string };

export const defaultFilters: Filters = { query: "", from: "", to: "", includeUndated: true };

// Zrušené zákroky se v seznamech neukazují (API je u pacienta vrací taky).
export function activeCases<T extends { status: string }>(cases: T[]) {
  return cases.filter((caseItem) => caseItem.status !== "cancelled");
}

// Nejbližší naplánovaný zákrok (mimo zrušené), jinak první bez termínu.
export function nextCase(patient: Pick<Patient, "cases">): PatientCase | undefined {
  const cases = activeCases(patient.cases);
  const dated = cases
    .filter((caseItem) => caseItem.surgeryDate)
    .sort((a, b) => a.surgeryDate!.localeCompare(b.surgeryDate!));
  return dated[0] ?? cases[0];
}

// Zákrok projde filtrem data, když má termín v rozmezí, nebo nemá termín a ty jsou povolené.
export function inDateRange(caseItem: { surgeryDate: string | null }, range: DateRange) {
  if (!caseItem.surgeryDate) return range.includeUndated;
  if (range.from && caseItem.surgeryDate < range.from) return false;
  if (range.to && caseItem.surgeryDate > range.to) return false;
  return true;
}

// Hledání bez ohledu na velikost písmen a diakritiku (Novák = novak).
export function normalize(text: string) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

type Named = { firstName: string; lastName: string };

// Příjmení napřed jako v nemocničních seznamech, které se podle příjmení i řadí.
export function fullName(person: Named) {
  return `${person.lastName} ${person.firstName}`.trim();
}

// Abecední řazení podle příjmení, při shodě podle jména.
export function bySurname(a: Named, b: Named) {
  return a.lastName.localeCompare(b.lastName, "cs") || a.firstName.localeCompare(b.firstName, "cs");
}

// Načtení z API selhalo: co se stalo a tlačítko pro nový pokus.
export function LoadError({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <p className="text-base text-muted-foreground">{error.message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="press rounded-full px-4 py-2 text-base font-medium outline-none select-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        Zkusit znovu
      </button>
    </div>
  );
}

type Store = {
  filters: Filters;
  setFilters: (filters: Filters) => void;
  sort: Sort;
  setSort: (sort: Sort | ((current: Sort) => Sort)) => void;
};

const PatientStoreContext = createContext<Store | null>(null);

export function PatientStoreProvider({ children }: { children: React.ReactNode }) {
  const [filters, setFilters] = useState(defaultFilters);
  const [sort, setSort] = useState<Sort>({ key: "createdAt", dir: "desc" });
  return (
    <PatientStoreContext.Provider value={{ filters, setFilters, sort, setSort }}>
      {children}
    </PatientStoreContext.Provider>
  );
}

export function usePatientStore() {
  const store = useContext(PatientStoreContext);
  if (!store) throw new Error("usePatientStore musí být uvnitř PatientStoreProvider");
  return store;
}
