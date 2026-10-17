"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { SortHeader } from "@/app/components/shared/SortHeader";
import { StaggerRow } from "@/app/components/shared/motion/StaggerRow";
import {
  activeCases,
  fullName,
  nextCase,
  type Sort,
  type SortKey,
} from "@/app/components/shared/PatientStore";
import type { Patient } from "@/lib/api/types";
import { formatDate } from "@/lib/date";

// Telefon: řádky seznamu. Od md: sloupce se záhlavím, kliknutím na záhlaví se řadí.
// Řádek otevře stránku úpravy /staff/patients/[id]/edit.
export function PatientTable({
  patients,
  sort,
  onSort,
  onClearFilters,
}: {
  patients: Patient[];
  sort: Sort;
  onSort: (key: SortKey) => void;
  onClearFilters: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl bg-background">
      <div className="hidden items-center gap-4 border-b border-border px-6 py-2 text-sm text-muted-foreground md:flex">
        <div className="grid flex-1 grid-cols-12 gap-4">
          <SortHeader label="Pacient" sortKey="name" sort={sort} onSort={onSort} className="col-span-4" />
          <span className="col-span-4 py-2">Výkon</span>
          <SortHeader label="Přidáno" sortKey="createdAt" sort={sort} onSort={onSort} className="col-span-2" />
          <SortHeader label="Zákrok" sortKey="caseDate" sort={sort} onSort={onSort} className="col-span-2" />
        </div>
        <span className="size-5 shrink-0" />
      </div>

      {patients.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <p className="text-base text-muted-foreground">Žádný pacient neodpovídá filtru.</p>
          <button
            type="button"
            onClick={onClearFilters}
            className="press rounded-full px-4 py-2 text-base font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            Zrušit filtry
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {patients.map((patient, index) => {
            const next = nextCase(patient);
            const others = activeCases(patient.cases).length - 1;
            const more = others > 0 ? `+${others} další` : "";
            return (
              <StaggerRow key={patient.id} index={index}>
                <Link
                  href={`/staff/patients/${patient.id}/edit`}
                  aria-label={`Upravit: ${fullName(patient)}`}
                  className="flex min-h-16 w-full items-center gap-4 px-4 py-3 text-left outline-none select-none hover:bg-muted/50 focus-visible:bg-muted md:px-6"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-4 md:grid md:grid-cols-12">
                    <div className="min-w-0 flex-1 md:col-span-4">
                      <div className="truncate text-base font-medium">{fullName(patient)}</div>
                      <div className="truncate text-sm text-muted-foreground">
                        <span className="md:hidden">
                          {next ? next.procedureName : "Bez zákroku"}
                          {more && ` · ${more}`}
                        </span>
                        <span className="hidden md:inline">{patient.externalId}</span>
                      </div>
                    </div>
                    <div className="hidden min-w-0 md:col-span-4 md:block">
                      <div className="truncate text-base">
                        {next ? next.procedureName : <span className="text-muted-foreground">Bez zákroku</span>}
                      </div>
                      {more && <div className="truncate text-sm text-muted-foreground">{more}</div>}
                    </div>
                    <div className="hidden text-base text-muted-foreground md:col-span-2 md:block">
                      {formatDate(patient.createdAt)}
                    </div>
                    <div className="shrink-0 text-right text-base md:col-span-2 md:text-left">
                      {next?.surgeryDate ? (
                        formatDate(next.surgeryDate)
                      ) : (
                        <span className="text-sm text-muted-foreground">Bez termínu</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
                </Link>
              </StaggerRow>
            );
          })}
        </ul>
      )}
    </div>
  );
}
