"use client";

import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown } from "lucide-react";
import type { UserCase } from "@/lib/api/types";
import { formatDate, formatFullDate } from "@/lib/date";
import { caseCount, daysWord } from "@/lib/plural";
import { cn } from "@/lib/utils";

const CLOSED_LABEL: Partial<Record<UserCase["status"], string>> = { closed: "proběhlo", cancelled: "zrušeno" };

function when(option: UserCase) {
  const closed = CLOSED_LABEL[option.status];
  if (!option.surgeryDate || option.daysToCase === null) return closed ? `Bez termínu · ${closed}` : "Termín zatím není";
  if (closed) return `${formatFullDate(option.surgeryDate)} · ${closed}`;
  if (option.daysToCase < 0) return formatFullDate(option.surgeryDate);
  if (option.daysToCase === 0) return `dnes · ${formatDate(option.surgeryDate)}`;
  return `za ${option.daysToCase} ${daysWord(option.daysToCase)} · ${formatDate(option.surgeryDate)}`;
}

// Přepínač zákroků nahoře na přehledu, když jich má pacient víc. Jedno velké tlačítko s vybraným zákrokem
// (název, termín, kolik zákroků celkem), klik otevře seznam všech s fajfkou u vybraného. Celý přehled pod ním
// patří k vybranému. Výběr drží PatientCaseProvider v layoutu, takže platí i pro nahrání a fotky.
export function CaseSwitcher({ cases, selectedId, onSelect }: { cases: UserCase[]; selectedId: string; onSelect: (caseId: string) => void }) {
  if (cases.length < 2) return null;
  const selected = cases.find((option) => option.id === selectedId) ?? cases[0];
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Vybraný zákrok: ${selected.procedureName}. Změnit zákrok`}
        className="press flex w-full items-center gap-4 rounded-2xl bg-muted py-3 pr-4 pl-5 text-left outline-none select-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-popup-open:bg-muted/70 sm:max-w-md"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-lg font-semibold first-letter:uppercase">{selected.procedureName}</span>
          <span className="block text-base text-muted-foreground">
            {when(selected)} · {caseCount(cases.length)}
          </span>
        </span>
        <ChevronDown className="size-6 shrink-0" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={8} className="z-50">
          <Menu.Popup className="flex w-(--anchor-width) origin-(--transform-origin) flex-col rounded-2xl bg-popover p-1.5 text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none motion-safe:transition motion-safe:duration-150 motion-safe:ease-smooth data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <Menu.Group>
              <Menu.GroupLabel className="px-4 pt-2 pb-1 text-sm font-medium text-muted-foreground">Moje zákroky</Menu.GroupLabel>
              <Menu.RadioGroup value={selected.id} onValueChange={(value) => onSelect(value as string)}>
                {cases.map((option) => (
                  <Menu.RadioItem
                    key={option.id}
                    value={option.id}
                    className="flex min-h-16 cursor-pointer items-center gap-3 rounded-xl px-4 py-2.5 outline-none select-none data-highlighted:bg-muted"
                  >
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-lg first-letter:uppercase", option.id === selected.id && "font-semibold")}>{option.procedureName}</span>
                      <span className="block text-base text-muted-foreground">{when(option)}</span>
                    </span>
                    <Menu.RadioItemIndicator>
                      <Check className="size-5" />
                    </Menu.RadioItemIndicator>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Group>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
