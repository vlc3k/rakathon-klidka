"use client";

import Link from "next/link";
import { Tooltip } from "@base-ui/react/tooltip";
import { FileOutput, Lock } from "lucide-react";
import { AlertIcon, ClockIcon, DoneIcon, QuestionIcon, VideoCallIcon, WarningIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/app/components/shared/InfoTip";
import { RULES } from "@/db/catalog";
import { documentUrl } from "@/lib/api/client";
import type { CaseDetail } from "@/lib/api/types";
import { formatDate } from "@/lib/date";
import { relationLabel } from "@/lib/helpers";
import { cn } from "@/lib/utils";
import { SmoothImage } from "@/app/components/shared/LoadingStates";

// Videohovor přes Microsoft Teams (VFN jede na Microsoft prostředí, náměstek Zápotocký).
// Odkaz otevře v Teams naplánování schůzky s předvyplněným předmětem; pacient se připojí odkazem i bez účtu.
function teamsMeetingUrl(name: string | null, procedure: string | null, phone: string | null) {
  const params = new URLSearchParams({
    subject: `Předanestetická konzultace${name ? `: ${name}` : ""}`,
    content: `Videohovor anesteziologické ambulance VFN${procedure ? ` k zákroku: ${procedure}` : ""}.${phone ? ` Pozvánku pošlete pacientovi na ${phone}.` : ""}`,
  });
  return `https://teams.microsoft.com/l/meeting/new?${params.toString()}`;
}

// Věk v celých letech k dnešnímu dni: „86 let“, „3 roky“, „1 rok“.
function ageLabel(birthDate: string | null) {
  if (!birthDate) return null;
  const [y, m, d] = birthDate.split("-").map(Number);
  const now = new Date();
  const age = now.getFullYear() - y - (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d) ? 1 : 0);
  if (!Number.isFinite(age) || age < 0) return null;
  return `${age} ${age === 1 ? "rok" : age >= 2 && age <= 4 ? "roky" : "let"}`;
}

const daysUnit = (days: number) => (Math.abs(days) === 1 ? "den" : Math.abs(days) >= 2 && Math.abs(days) <= 4 ? "dny" : "dní");

// Číslo v hlavičce: velká hodnota s menší jednotkou a pod ní, co to je. Obě čísla (dny do zákroku, hemoglobin)
// stejně, ať je hned jasné, co které znamená.
function Fact({ value, unit, icon, caption }: { value: React.ReactNode; unit?: string; icon?: React.ReactNode; caption: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="flex items-center gap-1.5 text-xl font-semibold tracking-tight whitespace-nowrap tabular-nums">
        <span>
          {value}
          {unit && <span className="ml-1 text-sm font-medium text-muted-foreground">{unit}</span>}
        </span>
        {icon}
      </span>
      <span className="text-xs whitespace-nowrap text-muted-foreground">{caption}</span>
    </div>
  );
}

// Stav hemoglobinu slovem a barvou jen ve slově (a v ikoně), číslo zůstává černé.
const HB = {
  ok: { label: "v pořádku", icon: DoneIcon, color: "text-green-700" },
  missing: { label: "doplnit", icon: AlertIcon, color: "text-amber-700" },
  alert: { label: "nízký", icon: WarningIcon, color: "text-red-700" },
  uncertain: { label: "nejisté", icon: QuestionIcon, color: "text-amber-700" },
} as const;
// Výsledky krve jsou vyžádané od pacienta (PBM běží): v hlavičce i v legendě místo stavu hodnoty.
const WAITING = { label: "čeká na výsledky", icon: ClockIcon, color: "text-blue-700" } as const;

// „121 g/l ✓ / hemoglobin · v pořádku · 7. 10.“ (na telefonu „Hb · v pořádku“). Probíhá-li PBM, místo stavu „čeká na výsledky“.
function HbFact({ hb, pbmRunning }: { hb: CaseDetail["hb"]; pbmRunning: boolean }) {
  const state = pbmRunning ? WAITING : HB[hb.status];
  const Icon = state.icon;
  return (
    <Fact
      value={hb.value ?? "—"}
      unit={hb.value !== null ? "g/l" : undefined}
      icon={<Icon className={cn("size-5 [--icon-accent:currentColor]", state.color)} />}
      caption={
        <>
          {/* Na telefonu kratší, ať se vedle vejdou tlačítka. */}
          <span className="sm:hidden">Hb</span>
          <span className="hidden sm:inline">hemoglobin</span> · <span className={cn("font-medium", state.color)}>{state.label}</span>
          {hb.value !== null && !hb.verified && hb.status === "ok" && " · neověřeno"}
          {hb.observedDate && <span className="hidden sm:inline"> · {formatDate(hb.observedDate)}</span>}
          <span className="ml-1.5 inline-flex align-middle">
            <InfoTip label="Stavy hemoglobinu" icon={<QuestionIcon className="size-4" />} wide>
              <HbLegend current={pbmRunning ? "waiting" : hb.status} />
            </InfoTip>
          </span>
        </>
      }
    />
  );
}

// Legenda stavů hemoglobinu: stav a jaké hodnotě odpovídá, aktuální podbarvený (při vyžádaných výsledcích „Čeká na výsledky“). Prahy z pravidla PBM (db/catalog.ts).
function HbLegend({ current }: { current: keyof typeof HB | "waiting" }) {
  const { hbThresholdGl: limit, hbValidForDays: days } = RULES.pbm;
  const rows: { status: keyof typeof HB | "waiting"; value: string }[] = [
    { status: "ok", value: `≥ ${limit} g/l` },
    { status: "alert", value: `< ${limit} g/l` },
    { status: "missing", value: `chybí / odběr > ${days} dní` },
    { status: "uncertain", value: "nejde ověřit" },
    { status: "waiting", value: "vyžádáno od pacienta" },
  ];
  return (
    <span className="flex flex-col gap-1">
      <span className="px-2 pb-1 font-semibold">Hemoglobin</span>
      {rows.map((row) => {
        const { label, icon: Icon, color } = row.status === "waiting" ? WAITING : HB[row.status];
        return (
          <span key={row.status} className={cn("flex items-center gap-3 rounded-lg px-2 py-1", row.status === current && "bg-muted")}>
            <span className={cn("flex w-36 shrink-0 items-center gap-1.5 font-medium", color)}>
              <Icon className="size-4 shrink-0 [--icon-accent:currentColor]" />
              {label.charAt(0).toUpperCase() + label.slice(1)}
            </span>
            <span className="whitespace-nowrap tabular-nums">{row.value}</span>
          </span>
        );
      })}
    </span>
  );
}

// Jméno, věk, diagnóza a výkon jsou pořád na očích i při posunu stránky (bezpečnostní pojistka).
// Odkaz zpět a úpravy jsou nad hlavičkou (CaseDetail), aby se lepicí lišta nepřeplnila.
export function CaseHeader({ detail, diagnosis }: { detail: CaseDetail; diagnosis: string }) {
  const { case: caseItem, patient, hb } = detail;
  return (
    <header className="sticky top-14 z-20 -mx-4 bg-muted/90 px-4 py-4 backdrop-blur-md md:-mx-8 md:px-8 lg:top-0">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
        <div className="flex min-w-0 items-start gap-3">
          {patient.portraitDocumentId && (
            <SmoothImage src={documentUrl(caseItem.id, patient.portraitDocumentId)} alt="Fotka pacienta" className="size-12 shrink-0 rounded-full" imgClassName="size-full object-cover" />
          )}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight lg:text-2xl">
              {patient.displayName}
              {ageLabel(patient.birthDate) && <span className="ml-2 font-normal text-muted-foreground">{ageLabel(patient.birthDate)}</span>}
              {detail.closed && (
                <span className="ml-3 inline-flex items-center gap-1 align-middle text-sm font-medium text-muted-foreground">
                  <Lock className="size-4" /> Uzavřeno
                </span>
              )}
            </h1>
            {/* Diagnóza a pod ní výkon, každý na svém řádku. Co se i tak nevejde, se ořízne a celé je vidět po najetí. */}
            <Tooltip.Root>
              <Tooltip.Trigger
                delay={150}
                render={
                  <div className="mt-0.5 flex min-w-0 flex-col text-sm">
                    <p className="truncate font-medium">{diagnosis}</p>
                    {caseItem.procedureName && <p className="truncate text-muted-foreground">{caseItem.procedureName}</p>}
                  </div>
                }
              />
              <Tooltip.Portal>
                <Tooltip.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
                  <Tooltip.Popup className="flex max-w-md flex-col gap-1 rounded-2xl bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none motion-safe:transition motion-safe:duration-150 motion-safe:ease-smooth data-ending-style:opacity-0 data-starting-style:opacity-0">
                    <span>
                      <span className="text-muted-foreground">Diagnóza: </span>
                      <span className="font-medium">{diagnosis}</span>
                    </span>
                    {caseItem.procedureName && (
                      <span>
                        <span className="text-muted-foreground">Výkon: </span>
                        {caseItem.procedureName}
                      </span>
                    )}
                  </Tooltip.Popup>
                </Tooltip.Positioner>
              </Tooltip.Portal>
            </Tooltip.Root>
            {/* Pomocník z rodiny: komu volat a kdo může za pacienta posílat papíry. */}
            {detail.helpers.length > 0 && (
              <p className="truncate text-sm text-muted-foreground">Pomáhá: {detail.helpers.map((h) => `${h.displayName}, ${relationLabel(h.relation)}`).join("; ")}</p>
            )}
          </div>
        </div>
        {/* Na telefonu jeden řádek: dny, Hb a vpravo ikony, ať lepicí lišta nezabere půl obrazovky. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 sm:gap-x-6 lg:shrink-0">
          <Fact
            value={caseItem.daysToCase === null ? "—" : caseItem.daysToCase}
            unit={caseItem.daysToCase === null ? undefined : daysUnit(caseItem.daysToCase)}
            caption={caseItem.surgeryDate ? `do zákroku · ${formatDate(caseItem.surgeryDate)}` : "zákrok bez termínu"}
          />
          <HbFact hb={hb} pbmRunning={detail.pbm.status === "running"} />
          <div className="ml-auto flex gap-2 lg:ml-0">
            <Button
              variant="secondary"
              aria-label="Videohovor v Teams"
              className="h-11 w-11 rounded-full bg-background px-0 hover:bg-background/70 sm:w-auto sm:px-4"
              onClick={() => window.open(teamsMeetingUrl(patient.displayName, caseItem.procedureName, patient.phone ?? null), "_blank", "noopener,noreferrer")}
            >
              <VideoCallIcon className="size-4" />
              <span className="hidden sm:inline">Videohovor v Teams</span>
            </Button>
            {/* Uzavřít (export): uzavřít zákrok, odeslat do nemocnice (FHIR) a vytisknout do dokumentace.
                Otevřený zákrok má tlačítko v inverzních barvách, uzavřený jen odkaz na odeslání a tisk. */}
            <Link
              href={`/staff/${caseItem.id}/export`}
              aria-label={detail.closed ? "Uzavřeno: odeslat a vytisknout" : "Uzavřít zákrok"}
              className={cn(
                "press flex h-11 w-11 items-center justify-center gap-2 rounded-full text-sm font-medium sm:w-auto sm:px-4",
                detail.closed ? "bg-background hover:bg-background/70" : "bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              {detail.closed ? <Lock className="size-4" /> : <FileOutput className="size-4" />}
              <span className="hidden sm:inline">{detail.closed ? "Uzavřeno" : "Uzavřít"}</span>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
