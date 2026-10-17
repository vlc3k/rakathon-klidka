"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PhoneIcon, WarningIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { InfoTip } from "@/app/components/shared/InfoTip";
import { Reveal } from "@/app/components/shared/motion/Reveal";
import { StaggerRow } from "@/app/components/shared/motion/StaggerRow";
import { StatusBadge, type Status } from "@/app/components/staff/StatusBadge";
import { UploadDots } from "@/app/components/staff/UploadDots";
import { NEXT_STEP_LABEL } from "@/app/components/staff/CaseActions";
import type { QueueRow } from "@/lib/api/types";
import { formatDate } from "@/lib/date";
import { caseCount, daysWord } from "@/lib/plural";

// Při stejném počtu dní rozhodne stav: Pozor, Doplnit, Nejisté, V pořádku.
const rank: Record<Status, number> = { alert: 0, missing: 1, uncertain: 2, running: 3, ok: 4 };

// Server řadí podle stavu Hb. Ambulance ale plánuje podle termínu: nejbližší nahoře, bez termínu vespod.
function byDate(a: QueueRow, b: QueueRow) {
  if (a.daysToCase === null || b.daysToCase === null) return Number(a.daysToCase === null) - Number(b.daysToCase === null);
  return a.daysToCase - b.daysToCase || rank[a.hb.status] - rank[b.hb.status];
}

// Fronta jako seznam v Nastavení: celý řádek je odkaz na detail pacienta.
// Zákroky bez termínu jsou vespod a upozornění nad seznamem říká, kolik jich je.
export function PatientQueue({ rows }: { rows: QueueRow[] }) {
  const sorted = [...rows].sort(byDate);
  const undated = sorted.filter((row) => row.daysToCase === null).length;
  return (
    <div className="flex flex-col gap-3">
      {undated > 0 && (
        <Reveal className="flex items-center gap-3 rounded-2xl bg-status-todo px-4 py-3 text-base text-status-todo-foreground md:px-6">
          <WarningIcon className="size-5 shrink-0" />
          <span className="flex-1">
            {caseCount(undated)}{" "}
            {undated >= 2 && undated <= 4 ? "nemají" : "nemá"} termín
          </span>
          <InfoTip>
            Jsou na konci seznamu. Termín doplníte v úpravě zákroku.
          </InfoTip>
        </Reveal>
      )}
      <Reveal
        as="ul"
        className="divide-y divide-border overflow-hidden rounded-2xl bg-background"
      >
        <li className="hidden px-6 py-3 text-sm text-muted-foreground md:grid md:grid-cols-12 md:gap-4">
          <span className="col-span-5">Pacient</span>
          <span className="col-span-2">Do zákroku</span>
          <span className="col-span-2">Hemoglobin</span>
          <span className="col-span-3">Další krok</span>
        </li>
        {sorted.length === 0 && <li className="px-6 py-10 text-center text-base text-muted-foreground">Žádné zákroky v přípravě.</li>}
        {sorted.map((row, index) => (
          <StaggerRow key={row.caseId} index={index}>
            <Link
              href={`/staff/${row.caseId}`}
              className="press flex flex-col gap-2 px-4 py-4 outline-none hover:bg-muted/60 focus-visible:bg-muted md:grid md:grid-cols-12 md:items-center md:gap-4 md:px-6"
            >
              <div className="min-w-0 md:col-span-5">
                <div className="flex items-center gap-2 text-base font-medium">
                  {row.isNew && (
                    <span className="size-2 shrink-0 rounded-full bg-primary">
                      <span className="sr-only">Nové</span>
                    </span>
                  )}
                  <span className="truncate">{row.patientName}</span>
                </div>
                <div className="flex min-w-0 items-center gap-3 text-sm text-muted-foreground">
                  <UploadDots {...row.uploads} className="shrink-0 text-foreground" />
                  <span className="truncate">{row.procedureName}</span>
                </div>
                {row.silentDays !== null && (
                  <div className="flex items-center gap-1.5 text-sm font-medium text-amber-700">
                    <PhoneIcon className="size-4 shrink-0" />
                    Neozval(a) se {row.silentDays} {daysWord(row.silentDays)}, zavolat
                  </div>
                )}
              </div>
              <div className="flex items-center gap-4 md:contents">
                <div className="whitespace-nowrap md:col-span-2">
                  {row.daysToCase === null || !row.surgeryDate ? (
                    <div className="text-sm text-muted-foreground">
                      Bez termínu
                    </div>
                  ) : (
                    <>
                      <div className="text-base">{row.daysToCase} dní</div>
                      <div className="text-sm text-muted-foreground">
                        {formatDate(row.surgeryDate)}
                      </div>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-3 md:col-span-2">
                  <StatusBadge status={row.hb.status} unverified={!row.hb.verified} />
                  <span className="text-base whitespace-nowrap">
                    {row.hb.value !== null ? `${row.hb.value} g/l` : "—"}
                  </span>
                </div>
                <div className="ml-auto flex items-center justify-between gap-2 md:col-span-3 md:ml-0">
                  <span className="truncate text-sm text-muted-foreground">{row.nextStep ? NEXT_STEP_LABEL[row.nextStep] : ""}</span>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
                </div>
              </div>
            </Link>
          </StaggerRow>
        ))}
      </Reveal>
    </div>
  );
}
