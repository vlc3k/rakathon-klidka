"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { DropIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { SortHeader } from "@/app/components/shared/SortHeader";
import { StaggerRow } from "@/app/components/shared/motion/StaggerRow";
import { fullName } from "@/app/components/shared/PatientStore";
import { RULES } from "@/db/catalog";
import type { CaseListItem } from "@/lib/api/types";
import { formatDate } from "@/lib/date";

export type CaseSortKey = "date" | "patient";
export type CaseSort = { key: CaseSortKey; dir: "asc" | "desc" };

const bloodLossLabel = `Krevní ztráta nad ${RULES.pbm.bloodLossThresholdMl} ml`;

// Telefon: řádky seznamu. Od md: sloupce se záhlavím.
// Řádek otevře úpravu zákroku (/staff/cases/[id]/edit), odkud vede odkaz i na úpravu pacienta.
export function CaseTable({
  rows,
  sort,
  onSort,
  onClearFilters,
}: {
  rows: CaseListItem[];
  sort: CaseSort;
  onSort: (key: CaseSortKey) => void;
  onClearFilters: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl bg-background">
      <div className="hidden items-center gap-4 border-b border-border px-6 py-2 text-sm text-muted-foreground md:flex">
        <div className="grid flex-1 grid-cols-12 gap-4">
          <SortHeader label="Datum" sortKey="date" sort={sort} onSort={onSort} className="col-span-2" />
          <SortHeader label="Pacient" sortKey="patient" sort={sort} onSort={onSort} className="col-span-3" />
          <span className="col-span-4 py-2">Výkon</span>
          <span className="col-span-3 py-2">Kontakt</span>
        </div>
        <span className="size-5 shrink-0" />
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <p className="text-base text-muted-foreground">Žádný zákrok neodpovídá filtru.</p>
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
          {rows.map((row, index) => {
            const procedure = row.procedureName ?? "Zákrok";
            const highBloodLoss = (row.bloodLossMl ?? 0) > RULES.pbm.bloodLossThresholdMl;
            return (
              <StaggerRow key={row.id} index={index}>
                <Link
                  href={`/staff/cases/${row.id}/edit`}
                  aria-label={`Upravit zákrok: ${procedure}, ${fullName(row.patient)}`}
                  className="flex min-h-16 w-full items-center gap-4 px-4 py-3 text-left outline-none select-none hover:bg-muted/50 focus-visible:bg-muted md:px-6"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-4 md:grid md:grid-cols-12">
                    <div className="order-last shrink-0 text-right text-base md:order-none md:col-span-2 md:text-left">
                      {row.surgeryDate ? (
                        formatDate(row.surgeryDate)
                      ) : (
                        <span className="text-sm text-muted-foreground">Bez termínu</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 md:col-span-3">
                      <div className="truncate text-base font-medium md:font-normal">
                        <span className="md:hidden">{procedure}</span>
                        <span className="hidden md:inline">{fullName(row.patient)}</span>
                      </div>
                      <div className="truncate text-sm text-muted-foreground">
                        <span className="md:hidden">{fullName(row.patient)}</span>
                        <span className="hidden md:inline">{row.patient.externalId}</span>
                      </div>
                    </div>
                    <div className="hidden min-w-0 md:col-span-4 md:block">
                      <div className="flex items-center gap-2 text-base">
                        <span className="truncate">{procedure}</span>
                        {highBloodLoss && (
                          <>
                            <DropIcon className="size-4 shrink-0 text-muted-foreground" />
                            <span className="sr-only">{bloodLossLabel}</span>
                          </>
                        )}
                      </div>
                      <div className="truncate text-sm text-muted-foreground">{row.diagnosis?.text}</div>
                    </div>
                    <div className="hidden min-w-0 md:col-span-3 md:block">
                      <div className="truncate text-base">
                        {row.contact?.displayName ?? <span className="text-muted-foreground">Bez kontaktu</span>}
                      </div>
                      {row.isOncological && <div className="truncate text-sm text-muted-foreground">onkologický</div>}
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
