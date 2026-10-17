"use client";

import { useCaseLocked } from "@/app/components/shared/CaseLock";
import { useState } from "react";
import { AlertIcon, ClockIcon, DoneIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { InfoTip } from "@/app/components/shared/InfoTip";
import { cn } from "@/lib/utils";
import { api, errorMessage } from "@/lib/api/client";
import { revalidate } from "@/lib/api/useApi";
import type { CaseDetail, Task } from "@/lib/api/types";
import { consultOf, isActive, readinessInput } from "@/lib/caseView";
import { dayLabel } from "@/lib/date";
import { CONSULTS, readiness, stepLabel, type Readiness, type Step } from "@/lib/readiness";
import config from "@/lib/casy-pripravy.json";

export const READINESS_TONE = {
  ok: { text: "Stihne se to", color: "text-green-700 [--icon-accent:currentColor]", Icon: DoneIcon },
  tight: { text: "Je to těsné", color: "text-amber-700", Icon: ClockIcon },
  risk: { text: "Může se nestihnout", color: "text-red-700", Icon: AlertIcon },
  late: { text: "Nestihne se do termínu", color: "text-red-700", Icon: AlertIcon },
  unknown: { text: "Bez termínu zákroku", color: "text-muted-foreground", Icon: ClockIcon },
} as const;

const BAR = { done: "bg-green-600", running: "bg-blue-600", todo: "bg-amber-500" } as const;
const WAIT = config.kroky as Record<string, { dny: number[] }>;

// Stihne se příprava do zákroku? Pevná pravidla: čekací doby VFN, platnost vyšetření, konsenzus PBM.
// Co dělat, když se nestihne (přednostní termín, zákrok bez vyšetření, posunutí), rozhoduje lékař.
// Vstup jsou úkoly zákroku (lib/caseView.ts). Vyžádané konzilium je úkol pro AA (payload.consult).
export function ReadinessCard({ detail, tasks }: { detail: CaseDetail; tasks: Task[] }) {
  const caseId = detail.case.id;
  const locked = useCaseLocked();
  const T = detail.case.daysToCase;
  const r = readiness(readinessInput(T, tasks, detail.hb.status === "alert"));
  const tone = READINESS_TONE[r.status];
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const consultTask = (id: string) => tasks.find((task) => consultOf(task) === id && isActive(task));

  async function toggleConsult(id: string) {
    setBusy(id);
    setError(null);
    try {
      const running = consultTask(id);
      if (running) await api.patch(`/api/v1/cases/${caseId}/tasks/${running.id}`, { status: "cancelled", statusNote: "Konzilium už není potřeba." });
      else await api.post(`/api/v1/cases/${caseId}/tasks`, { assignee: "aa", kind: "action", title: `Konzilium: ${stepLabel(id)}`, payload: { consult: id } });
      await revalidate(`/api/v1/cases/${caseId}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-6 rounded-2xl bg-background p-6 lg:p-8">
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          Časová osa připravenosti
          <InfoTip>
            Doby podle čekacích dob VFN (1/2025), platnosti vyšetření a konsenzu PBM. Kroky označené „odhad“ nemají zdroj, nastaví je VFN. Počítá se s horší variantou.
          </InfoTip>
        </span>
        <h2 className={cn("flex items-center gap-2 text-2xl font-semibold tracking-tight", tone.color)}>
          <tone.Icon className="size-6" /> {tone.text}
        </h2>
        <p className="text-base text-muted-foreground">{readinessSentence(r, T)}</p>
      </div>

      {T !== null && r.steps.length > 0 && <Timeline r={r} T={T} />}

      {r.startToday.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Co spustit</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {r.startToday.map((s) => (
              <li key={s.id} className="flex justify-between gap-4">
                <span>{s.label}</span>
                <span className={s.latestStart < 0 ? "font-medium text-red-700" : "text-muted-foreground"}>
                  {s.latestStart < 0 ? "už mělo běžet" : `nejpozději ${dayLabel(s.latestStart)}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!locked && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm text-muted-foreground">Vyžádat konzilium (čekací doba VFN)</h3>
          <div className="flex flex-wrap gap-2">
            {CONSULTS.map((id) => {
              const on = !!consultTask(id);
              const [a, b] = WAIT[id].dny;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={on}
                  disabled={busy !== null}
                  onClick={() => toggleConsult(id)}
                  className={cn("press rounded-full px-4 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60", on ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70")}
                >
                  {stepLabel(id)} <span className={on ? "text-background/60" : "text-muted-foreground"}>{a === b ? `${a / 7} týd.` : `${a / 7}–${b / 7} týd.`}</span>
                </button>
              );
            })}
          </div>
          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
        </div>
      )}
    </section>
  );
}

export function readinessSentence(r: Readiness, T: number | null) {
  if (T === null || !r.ready) return "Doplňte termín v úpravě zákroku.";
  const ironLate = r.iron && r.steps.some((s) => s.id === "zelezo" && s.end[1] > r.iron!.ivDeadline);
  const base = `Připraven mezi ${dayLabel(r.ready[0])} a ${dayLabel(r.ready[1])}, zákrok je ${dayLabel(T)}`;
  if (r.status === "late") return `${base} Ani v lepším případě to nevyjde.`;
  if (ironLate) return `${base} Nitrožilní železo musí být podané nejpozději ${dayLabel(r.iron!.ivDeadline)}, jinak skoro nezabere.`;
  if (r.status === "risk") return `${base} V horším případě chybí ${-(r.reserve ?? 0)} dní.`;
  return `${base} Rezerva ${r.reserve} dní.`;
}

function Timeline({ r, T }: { r: Readiness; T: number }) {
  const span = Math.max(T, r.ready?.[1] ?? 0, ...r.steps.map((s) => s.end[1])) + 2;
  const x = (d: number) => `${(Math.max(0, d) / span) * 100}%`;
  const w = (a: number, b: number) => `${(Math.max(0, b - a) / span) * 100}%`;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative ml-36 h-5 text-xs text-muted-foreground">
        <span className="absolute whitespace-nowrap" style={{ left: x(0) }}>
          dnes
        </span>
        {r.iron && r.iron.ivDeadline > 0 && (
          <span className="absolute -translate-x-1/2 whitespace-nowrap text-red-700" style={{ left: x(r.iron.ivDeadline) }}>
            železo nejpozději
          </span>
        )}
        <span className="absolute -translate-x-full pr-1 font-medium whitespace-nowrap text-foreground" style={{ left: x(T) }}>
          zákrok {dayLabel(T)}
        </span>
      </div>
      <div className="relative flex flex-col gap-2">
        {/* svislé čáry: dnes, termín železa, zákrok */}
        <div className="pointer-events-none absolute inset-y-0 right-0 left-36">
          <span className="absolute inset-y-0 w-px bg-border" style={{ left: x(0) }} />
          {r.iron && r.iron.ivDeadline > 0 && <span className="absolute inset-y-0 w-px border-l border-dashed border-red-500" style={{ left: x(r.iron.ivDeadline) }} />}
          <span className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: x(T) }} />
        </div>
        {r.steps.map((s) => (
          <Row key={s.id} s={s} x={x} w={w} />
        ))}
      </div>
    </div>
  );
}

function Row({ s, x, w }: { s: Step; x: (d: number) => string; w: (a: number, b: number) => string }) {
  return (
    <div className="flex items-center gap-0">
      <span className="flex w-36 shrink-0 items-center gap-1 pr-2 text-sm">
        <span className="truncate">{s.label}</span>
        {s.estimate && s.state !== "done" && (
          <span className="shrink-0 text-xs text-muted-foreground" title={s.source}>
            odhad
          </span>
        )}
      </span>
      <div className="relative h-5 flex-1" title={`${s.label}: ${s.source}`}>
        {s.state === "done" ? (
          <span className="absolute inset-y-1 left-0 flex items-center gap-1 text-xs text-green-700">
            <DoneIcon className="size-3.5" /> hotovo
          </span>
        ) : (
          <>
            <span className={cn("absolute inset-y-1 rounded-full", BAR[s.state])} style={{ left: x(s.start), width: w(s.start, s.end[0]) }} />
            <span className={cn("absolute inset-y-1 rounded-r-full opacity-35", BAR[s.state])} style={{ left: x(s.end[0]), width: w(s.end[0], s.end[1]) }} />
          </>
        )}
      </div>
    </div>
  );
}
