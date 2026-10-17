"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { SearchIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { FieldError } from "@/app/components/shared/CaseFields";
import {
  activeCases,
  bySurname,
  fullName,
  LoadError,
  normalize,
} from "@/app/components/shared/PatientStore";
import { PatientPickerSkeleton } from "@/app/components/shared/LoadingStates";
import type { Patient } from "@/lib/api/types";
import { useApi } from "@/lib/api/useApi";
import { caseCount } from "@/lib/plural";
import { cn } from "@/lib/utils";

// Výběr pacienta s hledáním podle jména nebo identifikátoru. Seznam je řazený podle příjmení.
export function PatientPicker({
  selectedId,
  onSelect,
  error,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  error?: string;
}) {
  const { data: patients, error: loadError, reload } = useApi<Patient[]>("/api/v1/patients");
  const [query, setQuery] = useState("");
  const needle = normalize(query.trim());
  const visible = (patients ?? [])
    .filter((patient) => !needle || normalize(`${fullName(patient)} ${patient.externalId ?? ""}`).includes(needle))
    .sort(bySurname);

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-background p-5 md:p-6">
      <label className="relative">
        <span className="sr-only">Hledat pacienta</span>
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Hledat jméno nebo identifikátor"
          autoComplete="off"
          className="h-12 w-full rounded-xl bg-muted pr-3 pl-10 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      <div role="radiogroup" aria-label="Pacient" className="flex max-h-80 flex-col gap-1 overflow-y-auto">
        {!patients ? (
          loadError ? (
            <LoadError error={loadError} onRetry={reload} />
          ) : (
            <PatientPickerSkeleton />
          )
        ) : visible.length === 0 ? (
          <p className="px-3 py-6 text-center text-base text-muted-foreground">
            {patients.length === 0 ? "Zatím tu není žádný pacient." : "Žádný pacient neodpovídá hledání."}
          </p>
        ) : (
          visible.map((patient) => {
            const selected = patient.id === selectedId;
            return (
              <label
                key={patient.id}
                className={cn(
                  "flex min-h-14 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 select-none has-focus-visible:ring-2 has-focus-visible:ring-ring",
                  selected ? "bg-muted" : "hover:bg-muted/50",
                )}
              >
                <input
                  type="radio"
                  name="patientId"
                  value={patient.id}
                  checked={selected}
                  onChange={() => onSelect(patient.id)}
                  className="sr-only"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-medium">{fullName(patient)}</div>
                  <div className="truncate text-sm text-muted-foreground">
                    {patient.externalId && `${patient.externalId} · `}
                    {caseCount(activeCases(patient.cases).length)}
                  </div>
                </div>
                {selected && <Check className="size-5 shrink-0" />}
              </label>
            );
          })
        )}
      </div>

      <FieldError message={error} />
    </div>
  );
}
