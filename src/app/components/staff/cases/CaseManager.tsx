"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { SearchIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { Button, buttonVariants } from "@/components/ui/button";
import { DateRangeFilter } from "@/app/components/shared/DateRangeFilter";
import { Reveal } from "@/app/components/shared/motion/Reveal";
import {
  bySurname,
  fullName,
  inDateRange,
  LoadError,
  normalize,
  type DateRange,
} from "@/app/components/shared/PatientStore";
import { CaseTableSkeleton } from "@/app/components/shared/LoadingStates";
import { CaseTable, type CaseSort, type CaseSortKey } from "@/app/components/staff/cases/CaseTable";
import type { CaseListItem } from "@/lib/api/types";
import { useApi } from "@/lib/api/useApi";
import { caseCount } from "@/lib/plural";
import { cn } from "@/lib/utils";

const defaultRange: DateRange = { from: "", to: "", includeUndated: true };

const fieldClass =
  "h-11 rounded-xl bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Všechny zákroky napříč pacienty (API vrací jen nezrušené). Nový zákrok přes /staff/cases/create,
// úprava přes /staff/cases/[id]/edit. Hledá a řadí se v prohlížeči.
export function CaseManager() {
  const { data: cases, error, reload } = useApi<CaseListItem[]>("/api/v1/cases");
  const [query, setQuery] = useState("");
  const [range, setRange] = useState(defaultRange);
  const [sort, setSort] = useState<CaseSort>({ key: "date", dir: "asc" });

  const visible = cases ? sortRows(filterRows(cases, query, range), sort) : [];
  const active = query !== "" || range.from !== "" || range.to !== "" || !range.includeUndated;

  function clearFilters() {
    setQuery("");
    setRange(defaultRange);
  }

  function sortBy(key: CaseSortKey) {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <Reveal className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight lg:text-4xl">Správa zákroků</h1>
          {cases && (
            <p className="text-base text-muted-foreground">
              {visible.length === cases.length
                ? caseCount(cases.length)
                : `${visible.length} z ${caseCount(cases.length)}`}
            </p>
          )}
        </div>
        <Link
          href="/staff/cases/create"
          className={cn(buttonVariants(), "h-12 w-full rounded-full px-6 text-base sm:w-auto")}
        >
          <Plus className="size-5" />
          Přidat zákrok
        </Link>
      </Reveal>

      <Reveal delay={0.1} className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <label className="relative">
            <span className="sr-only">Hledat pacienta, výkon nebo diagnózu</span>
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Hledat pacienta, výkon nebo diagnózu"
              autoComplete="off"
              className={`${fieldClass} w-full pl-10`}
            />
          </label>

          <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:flex sm:flex-wrap sm:items-center sm:gap-x-4">
            <DateRangeFilter value={range} onChange={setRange} />
            {active && (
              <Button
                variant="ghost"
                onClick={clearFilters}
                className="col-span-2 h-11 rounded-full px-4 text-sm sm:ml-auto"
              >
                Zrušit filtry
              </Button>
            )}
          </div>
        </div>

        {!cases ? (
          error ? (
            <div className="rounded-2xl bg-background">
              <LoadError error={error} onRetry={reload} />
            </div>
          ) : (
            <CaseTableSkeleton />
          )
        ) : cases.length === 0 ? (
          <p className="rounded-2xl bg-background px-6 py-12 text-center text-base text-muted-foreground">
            Zatím tu není žádný zákrok.
          </p>
        ) : (
          <CaseTable rows={visible} sort={sort} onSort={sortBy} onClearFilters={clearFilters} />
        )}
      </Reveal>
    </div>
  );
}

function filterRows(rows: CaseListItem[], query: string, range: DateRange) {
  const needle = normalize(query.trim());
  return rows.filter((row) => {
    const haystack = `${fullName(row.patient)} ${row.patient.externalId ?? ""} ${row.procedureName ?? ""} ${row.diagnosis?.text ?? ""}`;
    if (needle && !normalize(haystack).includes(needle)) return false;
    return inDateRange(row, range);
  });
}

// Podle data: zákroky bez termínu jsou vždy na konci.
function sortRows(rows: CaseListItem[], sort: CaseSort) {
  return [...rows].sort((a, b) => {
    if (sort.key === "date") {
      const dateA = a.surgeryDate;
      const dateB = b.surgeryDate;
      if (!dateA || !dateB) return Number(!dateA) - Number(!dateB);
      const compare = dateA.localeCompare(dateB);
      return sort.dir === "asc" ? compare : -compare;
    }
    const compare = bySurname(a.patient, b.patient);
    return sort.dir === "asc" ? compare : -compare;
  });
}
