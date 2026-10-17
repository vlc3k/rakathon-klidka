"use client";

import { ChevronDown } from "lucide-react";
import { SearchIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { Button } from "@/components/ui/button";
import { DateRangeFilter } from "@/app/components/shared/DateRangeFilter";
import { defaultFilters, type Filters, type Sort } from "@/app/components/shared/PatientStore";

const sortOptions: { label: string; sort: Sort }[] = [
  { label: "Nejnověji přidaní", sort: { key: "createdAt", dir: "desc" } },
  { label: "Nejdříve přidaní", sort: { key: "createdAt", dir: "asc" } },
  { label: "Abecedně A–Z", sort: { key: "name", dir: "asc" } },
  { label: "Abecedně Z–A", sort: { key: "name", dir: "desc" } },
  { label: "Nejbližší zákrok", sort: { key: "caseDate", dir: "asc" } },
  { label: "Nejvzdálenější zákrok", sort: { key: "caseDate", dir: "desc" } },
];

const fieldClass =
  "h-11 rounded-xl bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function PatientFilters({
  filters,
  sort,
  onFiltersChange,
  onSortChange,
}: {
  filters: Filters;
  sort: Sort;
  onFiltersChange: (filters: Filters) => void;
  onSortChange: (sort: Sort) => void;
}) {
  const active =
    filters.query !== "" || filters.from !== "" || filters.to !== "" || !filters.includeUndated;

  function set<K extends keyof Filters>(key: K, value: Filters[K]) {
    onFiltersChange({ ...filters, [key]: value });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">Hledat jméno nebo identifikátor</span>
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={filters.query}
            onChange={(event) => set("query", event.target.value)}
            placeholder="Hledat jméno nebo identifikátor"
            autoComplete="off"
            className={`${fieldClass} w-full pl-10`}
          />
        </label>

        <label className="relative sm:w-60">
          <span className="sr-only">Seřadit</span>
          <select
            value={`${sort.key}-${sort.dir}`}
            onChange={(event) => {
              const option = sortOptions.find(
                ({ sort }) => `${sort.key}-${sort.dir}` === event.target.value,
              );
              if (option) onSortChange(option.sort);
            }}
            className={`${fieldClass} w-full cursor-pointer appearance-none pr-10`}
          >
            {sortOptions.map(({ label, sort }) => (
              <option key={label} value={`${sort.key}-${sort.dir}`}>
                {label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:flex sm:flex-wrap sm:items-center sm:gap-x-4">
        <DateRangeFilter value={filters} onChange={(range) => onFiltersChange({ ...filters, ...range })} />
        {active && (
          <Button
            variant="ghost"
            onClick={() => onFiltersChange(defaultFilters)}
            className="col-span-2 h-11 rounded-full px-4 text-sm sm:ml-auto"
          >
            Zrušit filtry
          </Button>
        )}
      </div>
    </div>
  );
}
