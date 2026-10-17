"use client";

import { useEffect, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, RotateCw } from "lucide-react";
import { WarningIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/app/components/shared/InfoTip";
import { RadioReply } from "@/app/components/patient/TodayPanel";
import { StaggerRow } from "@/app/components/shared/motion/StaggerRow";
import type { UploadController, UploadPage, UploadState } from "@/lib/documentUpload";
import { ease, transition } from "@/lib/motion";
import { cn } from "@/lib/utils";

// Průběh nahrání dokumentu. Nahoře vějíř nafocených stránek s kroužkem průběhu, pod ním stránky jako
// řádky seznamu, každá se svým stavem (skutečná procenta nahrání, čtení, hotovo). Chyba je přímo
// v řádku stránky i s volbou „Zkusit znovu“ / „Přeskočit“; ostatní stránky mezitím běží dál.
// Žádné vyčtené údaje: pacient je nevidí, kontroluje je ambulance.
export function UploadProgress({ upload, onAnother }: { upload: UploadController; onAnother: () => void }) {
  const state = useSyncExternalStore(upload.subscribe, upload.getSnapshot, upload.getSnapshot);
  const { pages, finish } = state;
  const done = finish === "done";
  const working = finish === "working" || pages.some((page) => ["waiting", "uploading", "reading"].includes(page.status));

  // Během odesílání se stránka nezavře omylem.
  useEffect(() => {
    if (!working) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [working]);

  return (
    <div className="flex flex-col gap-8 pb-12 lg:mx-auto lg:w-full lg:max-w-md">
      <header className="flex flex-col items-center gap-6 pt-2 text-center">
        <PageStack pages={pages} progress={progressOf(state)} done={done} />
        <div className="flex flex-col gap-1" aria-live="polite">
          <h1 className="text-3xl font-semibold tracking-tight">{title(state)}</h1>
          <p className="text-base text-muted-foreground">{summary(state)}</p>
        </div>
      </header>

      <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-background">
        {pages.map((page, index) => (
          <StaggerRow key={page.key} index={index}>
            <PageRow page={page} number={index + 1} onRetry={() => upload.retryPage(page.key)} onSkip={() => upload.skipPage(page.key)} />
          </StaggerRow>
        ))}
      </ul>

      <AnimatePresence mode="wait" initial={false}>
        {finish === "failed" && (
          <motion.section key="failed" role="alert" className="flex flex-col gap-4 rounded-2xl bg-background p-5" {...fadeUp}>
            <div className="flex items-start gap-3">
              <WarningIcon className="mt-0.5 size-5 shrink-0 text-destructive" />
              <h2 className="flex-1 text-base font-semibold">Dokument se nepodařilo dokončit</h2>
              {state.finishError && <InfoTip>{state.finishError}</InfoTip>}
            </div>
            <Choice onRetry={upload.retryFinish} onSkip={upload.skipFinish} />
          </motion.section>
        )}
        {(done || finish === "empty") && (
          <motion.div key="done" className="flex flex-col gap-2" {...fadeUp}>
            {done ? (
              <RadioReply
                secondary={
                  <button type="button" onClick={onAnother} className="underline underline-offset-4 hover:text-muted-foreground">
                    Vyfotit další podklad
                  </button>
                }
              />
            ) : (
              <Button className="h-12 rounded-full text-base" onClick={onAnother}>
                Vyfotit znovu
              </Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const fadeUp = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 8 }, transition: transition.enter };

const settled = (page: UploadPage) => page.status === "done" || page.status === "skipped";

// Celkový průběh: nahrání stránky váží půl, přečtení druhou půlku, dokončení dokumentu poslední díl.
function progressOf({ pages, finish }: UploadState) {
  const perPage = pages.map((page) => (settled(page) ? 1 : page.status === "reading" ? 0.5 + 0.25 : page.status === "uploading" ? page.progress * 0.5 : 0));
  const total = perPage.reduce((sum, value) => sum + value, 0) + (finish === "done" || finish === "empty" ? 1 : 0);
  return total / (pages.length + 1);
}

function title({ pages, finish }: UploadState) {
  if (finish === "done") return "Odesláno";
  if (finish === "empty") return "Nic se neodeslalo";
  if (finish === "failed" || pages.some((page) => page.status === "failed")) return "Něco se nepovedlo";
  if (finish === "working") return "Dokončuji";
  return "Odesílám";
}

function summary({ pages, finish }: UploadState) {
  const sent = pages.filter((page) => page.status === "done").length;
  const skipped = pages.filter((page) => page.status === "skipped").length;
  if (finish === "done" || finish === "empty") return [pageCount(sent), skipped ? `${skipped} přeskočeno` : null].filter(Boolean).join(" · ");
  return `${pages.filter(settled).length} z ${pages.length}`;
}

// Nafocené stránky jako vějíř (nejvýš tři), přes ně kroužek s průběhem; na konci se vyplní fajfkou.
function PageStack({ pages, progress, done }: { pages: UploadPage[]; progress: number; done: boolean }) {
  const shown = pages.slice(0, 3);
  const tilt = [0, -7, 6];
  const shift = [0, -14, 14];
  return (
    <div className="relative h-36 w-28" aria-hidden>
      {shown
        .map((page, i) => ({ page, i }))
        .reverse()
        .map(({ page, i }) => (
          <motion.div
            key={page.key}
            className="absolute inset-0 overflow-hidden rounded-xl bg-background shadow-md ring-1 ring-black/5"
            initial={{ opacity: 0, y: 12, rotate: 0 }}
            animate={{ opacity: 1, y: 0, rotate: done ? tilt[i] * 0.5 : tilt[i], x: shift[i] }}
            transition={{ ...transition.enter, delay: i * 0.05 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={page.previewUrl} alt="" className="size-full object-cover" />
          </motion.div>
        ))}
      <div className="absolute -right-5 -bottom-4 flex size-14 items-center justify-center rounded-full bg-background shadow-md">
        <svg viewBox="0 0 56 56" className="size-full -rotate-90">
          <circle cx="28" cy="28" r="22" fill="none" strokeWidth="4" className="stroke-muted" />
          <motion.circle
            cx="28"
            cy="28"
            r="22"
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            className="stroke-primary"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: progress }}
            transition={transition.enter}
          />
        </svg>
        <motion.span
          className="absolute inset-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground"
          initial={false}
          animate={{ scale: done ? 1 : 0, opacity: done ? 1 : 0 }}
          transition={{ duration: 0.3, ease }}
        >
          <Check className="size-6" strokeWidth={3} />
        </motion.span>
      </div>
    </div>
  );
}

const STATUS_TEXT: Record<UploadPage["status"], string> = {
  waiting: "Čeká",
  uploading: "Nahrávám",
  reading: "Čtu",
  done: "Hotovo",
  failed: "",
  skipped: "Přeskočeno",
};

function PageRow({ page, number, onRetry, onSkip }: { page: UploadPage; number: number; onRetry: () => void; onSkip: () => void }) {
  const failed = page.status === "failed";
  const active = page.status === "uploading" || page.status === "reading";
  return (
    <div className={cn("flex flex-col gap-3 px-4 py-3", failed && "bg-destructive/5")}>
      <div className="flex items-center gap-4">
        <div className="relative h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-muted ring-1 ring-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={page.previewUrl} alt="" className={cn("size-full object-cover", page.status === "skipped" && "opacity-40 grayscale")} />
          {active && (
            <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
              <div className="h-1/3 w-full bg-linear-to-b from-transparent via-background/80 to-transparent motion-safe:animate-scan" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-medium">Strana {number}</div>
          <div className={cn("text-sm tabular-nums", failed ? "text-destructive" : "text-muted-foreground")}>
            {failed ? (page.documentId ? "Nepodařilo se přečíst" : "Nepodařilo se nahrát") : page.status === "uploading" ? `Nahrávám ${Math.round(page.progress * 100)} %` : STATUS_TEXT[page.status]}
          </div>
        </div>
        <RowMark page={page} />
      </div>
      <AnimatePresence initial={false}>
        {failed && (
          <motion.div
            className="flex items-center gap-2 pl-15"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={transition.quick}
          >
            <Choice onRetry={onRetry} onSkip={onSkip} compact />
            {page.error && <InfoTip>{page.error}</InfoTip>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Stav vpravo v řádku: kroužek s procenty při nahrávání, točící se oblouk při čtení, fajfka, výstraha.
function RowMark({ page }: { page: UploadPage }) {
  return (
    <span className="relative flex size-7 shrink-0 items-center justify-center" aria-hidden>
      <AnimatePresence mode="popLayout" initial={false}>
        {page.status === "done" ? (
          <motion.span key="done" className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground" {...pop}>
            <Check className="size-4" strokeWidth={3} />
          </motion.span>
        ) : page.status === "failed" ? (
          <motion.span key="failed" className="text-destructive" {...pop}>
            <WarningIcon className="size-5" />
          </motion.span>
        ) : page.status === "uploading" || page.status === "reading" ? (
          <motion.svg key="ring" viewBox="0 0 28 28" className={cn("size-7 -rotate-90", page.status === "reading" && "motion-safe:animate-spin")} {...pop}>
            <circle cx="14" cy="14" r="11" fill="none" strokeWidth="3" className="stroke-muted" />
            <motion.circle
              cx="14"
              cy="14"
              r="11"
              fill="none"
              strokeWidth="3"
              strokeLinecap="round"
              className="stroke-primary"
              initial={false}
              animate={{ pathLength: page.status === "reading" ? 0.3 : Math.max(0.04, page.progress) }}
              transition={transition.quick}
            />
          </motion.svg>
        ) : page.status === "waiting" ? (
          <motion.span key="waiting" className="size-2 rounded-full bg-border" {...pop} />
        ) : null}
      </AnimatePresence>
    </span>
  );
}

const pop = { initial: { scale: 0.6, opacity: 0 }, animate: { scale: 1, opacity: 1 }, exit: { scale: 0.6, opacity: 0 }, transition: transition.quick };

function Choice({ onRetry, onSkip, compact = false }: { onRetry: () => void; onSkip: () => void; compact?: boolean }) {
  const size = compact ? "h-11 rounded-full px-4 text-sm" : "h-12 rounded-full text-base";
  return (
    <div className={cn("flex gap-2", !compact && "grid grid-cols-2")}>
      <Button variant="secondary" className={cn(size, !compact && "bg-muted hover:bg-muted/70")} onClick={onSkip}>
        Přeskočit
      </Button>
      <Button className={size} onClick={onRetry}>
        <RotateCw className="size-4" />
        Zkusit znovu
      </Button>
    </div>
  );
}

const pageCount = (count: number) => (count === 1 ? "1 strana" : count < 5 ? `${count} strany` : `${count} stran`);
