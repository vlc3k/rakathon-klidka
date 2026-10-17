"use client";

import type { DateRange } from "@/app/components/shared/PatientStore";

const fieldClass =
  "h-11 w-full rounded-xl bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto";

// Rozmezí data zákroku a zaškrtávátko pro zákroky bez termínu.
// Telefon: dvě pole vedle sebe s popisky nad nimi. Od sm: vše v jednom řádku.
export function DateRangeFilter({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (value: DateRange) => void;
}) {
  return (
    <>
      <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
        Zákrok od
        <input
          type="date"
          value={value.from}
          onChange={(event) => onChange({ ...value, from: event.target.value })}
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
        <span>
          <span className="sm:hidden">Zákrok </span>do
        </span>
        <input
          type="date"
          value={value.to}
          onChange={(event) => onChange({ ...value, to: event.target.value })}
          className={fieldClass}
        />
      </label>
      <label className="col-span-2 flex min-h-11 cursor-pointer items-center gap-2 select-none">
        <input
          type="checkbox"
          checked={value.includeUndated}
          onChange={(event) => onChange({ ...value, includeUndated: event.target.checked })}
          className="size-5 cursor-pointer accent-primary"
        />
        Včetně zákroků bez termínu
      </label>
    </>
  );
}
