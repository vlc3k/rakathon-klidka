"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Reveal } from "@/app/components/shared/motion/Reveal";
import {
  activeCases,
  bySurname,
  defaultFilters,
  fullName,
  inDateRange,
  LoadError,
  nextCase,
  normalize,
  usePatientStore,
  type Filters,
  type Sort,
  type SortKey,
} from "@/app/components/shared/PatientStore";
import { PatientTableSkeleton } from "@/app/components/shared/LoadingStates";
import { PatientFilters } from "@/app/components/staff/patients/PatientFilters";
import { PatientTable } from "@/app/components/staff/patients/PatientTable";
import type { Patient } from "@/lib/api/types";
import { useApi } from "@/lib/api/useApi";
import { cn } from "@/lib/utils";

// Výchozí směr při kliknutí na záhlaví sloupce.
const defaultDir: Record<SortKey, Sort["dir"]> = {
  name: "asc",
  createdAt: "desc",
  caseDate: "asc",
};

// Seznam z API, hledá a řadí se v prohlížeči (API vrací nejvýš 500 pacientů).
export function PatientManager() {
  const { filters, setFilters, sort, setSort } = usePatientStore();
  const { data: patients, error, reload } = useApi<Patient[]>("/api/v1/patients");
  const visible = patients ? sortPatients(filterPatients(patients, filters), sort) : [];

  function sortBy(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: defaultDir[key] },
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <Reveal className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight lg:text-4xl">Správa pacientů</h1>
          {patients && (
            <p className="text-base text-muted-foreground">
              {visible.length === patients.length
                ? patientCount(patients.length)
                : `${visible.length} z ${patientCount(patients.length)}`}
            </p>
          )}
        </div>
        <Link
          href="/staff/patients/create"
          className={cn(buttonVariants(), "h-12 w-full rounded-full px-6 text-base sm:w-auto")}
        >
          <Plus className="size-5" />
          Přidat pacienta
        </Link>
      </Reveal>

      <Reveal delay={0.1} className="flex flex-col gap-4">
        <PatientFilters
          filters={filters}
          sort={sort}
          onFiltersChange={setFilters}
          onSortChange={setSort}
        />
        {!patients ? (
          error ? (
            <div className="rounded-2xl bg-background">
              <LoadError error={error} onRetry={reload} />
            </div>
          ) : (
            <PatientTableSkeleton />
          )
        ) : patients.length === 0 ? (
          <p className="rounded-2xl bg-background px-6 py-12 text-center text-base text-muted-foreground">
            Zatím tu není žádný pacient.
          </p>
        ) : (
          <PatientTable
            patients={visible}
            sort={sort}
            onSort={sortBy}
            onClearFilters={() => setFilters(defaultFilters)}
          />
        )}
      </Reveal>
    </div>
  );
}

// 1 pacient, 2 až 4 pacienti, 0 a víc než 4 pacientů.
function patientCount(count: number) {
  if (count === 1) return "1 pacient";
  if (count >= 2 && count <= 4) return `${count} pacienti`;
  return `${count} pacientů`;
}

// Pacient projde filtrem data, když mu vyhovuje aspoň jeden zákrok. Bez zákroku se bere jako bez termínu.
function filterPatients(patients: Patient[], filters: Filters) {
  const query = normalize(filters.query.trim());
  return patients.filter((patient) => {
    if (query && !normalize(`${fullName(patient)} ${patient.externalId ?? ""}`).includes(query)) {
      return false;
    }
    const cases = activeCases(patient.cases);
    if (cases.length === 0) return filters.includeUndated;
    return cases.some((caseItem) => inDateRange(caseItem, filters));
  });
}

// Podle zákroku se řadí podle nejbližšího naplánovaného. Pacienti bez termínu jsou vždy na konci.
function sortPatients(patients: Patient[], sort: Sort) {
  return [...patients].sort((a, b) => {
    if (sort.key === "caseDate") {
      const dateA = nextCase(a)?.surgeryDate;
      const dateB = nextCase(b)?.surgeryDate;
      if (!dateA || !dateB) return Number(!dateA) - Number(!dateB);
      const compare = dateA.localeCompare(dateB);
      return sort.dir === "asc" ? compare : -compare;
    }
    const compare =
      sort.key === "name" ? bySurname(a, b) : a.createdAt.localeCompare(b.createdAt);
    return sort.dir === "asc" ? compare : -compare;
  });
}
