"use client";

import { useCaseLocked } from "@/app/components/shared/CaseLock";
import { useState } from "react";
import Link from "next/link";
import { Check, ChevronRight, Loader2, Plus } from "lucide-react";
import { EyeIcon, ReportIcon, WaitingIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { buttonVariants } from "@/components/ui/button";
import { InfoTip } from "@/app/components/shared/InfoTip";
import { ListCard } from "@/app/components/shared/ListCard";
import { visitIcon } from "@/app/components/shared/VisitList";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { DocumentRequestForm } from "@/app/components/staff/detail/DocumentRequestForm";
import { api, errorMessage } from "@/lib/api/client";
import { revalidate } from "@/lib/api/useApi";
import type { CaseDetail, CaseDocument, Task } from "@/lib/api/types";
import { consultOf, documentGroups, pagesLabel, requestDetail } from "@/lib/caseView";
import { formatDate, todayIso } from "@/lib/date";
import { helperUploadNote } from "@/lib/helpers";
import { cn } from "@/lib/utils";

// Co jsme od pacienta vyžádali (zprávy od lékařů, výsledky krve, podpis, fotka úst) a kde každá věc je:
// vyžádáno → viděno pacientem (otevřel si přípravu v aplikaci, tasks.read_at) → nahráno.
// Řádek jako sledování zásilky (eBay Playbook, progress stepper): pod názvem věta s posledním stavem, vedle tenký
// pruh ze tří úseků s malými popisky. Zelená = hotovo, žlutá = čeká na pacienta (červená po termínu), šedá = až potom.
// Modrým tlačítkem v hlavičce („Vyžádat další dokument“) se vyžádá další dokument (DocumentRequestForm), nepotřebný se
// odebere (s potvrzením) a zmizí ze seznamu, žádný stav „není potřeba“. Odebraný jde kdykoli vyžádat znovu.
// „Zobrazit“ otevře stránku dokumentu (co AI vytěžila + originál). Pod tím dokumenty nahrané bez žádosti (pacient, pomocník)
// a úkoly ambulance ze šablony. Konzilia řeší časová osa. Výsledky krve vyžádané kvůli Hb jsou tady taky, stav PBM ukazuje další krok.

// done = hotovo (zelená), waiting = čeká na pacienta (žlutá), idle = zatím ne.
type StepState = "done" | "waiting" | "idle";
type Step = { label: string; state: StepState; late?: boolean };
// Věta s posledním stavem po částech („Viděno pacientem 16. 10. · čeká na nahrání · do 24. 10.“), termín po splatnosti červeně.
type Status = { tone: "done" | "waiting" | "late"; parts: { text: string; late?: boolean }[] };

const pill = "press h-11 shrink-0 rounded-full px-4 text-sm font-medium outline-none select-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

const inScope = (task: Task) => consultOf(task) === null;
const isRequest = (task: Task) => task.kind === "upload" && inScope(task);
const isOpen = (task: Task) => task.status === "open" || task.status === "snoozed";

export function UploadRequests({ caseId, detail, tasks }: { caseId: string; detail: CaseDetail; tasks: Task[] }) {
  const locked = useCaseLocked();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waive, setWaive] = useState<Task | null>(null);
  const [picking, setPicking] = useState(false);

  const today = todayIso();
  const rows = tasks
    .filter((task) => isRequest(task) && task.status !== "cancelled")
    .map((task) => {
      const document = detail.documents.find((doc) => doc.taskId === task.id || doc.id === task.documentId);
      return { task, document, ...requestProgress(task, document, today) };
    })
    // Nejdřív to, na co se čeká, hotové na konec.
    .sort((a, b) => progress(a.steps) - progress(b.steps));
  // Poslední krok je „Nahráno“.
  const uploaded = rows.filter((row) => row.steps.at(-1)?.state === "done").length;
  const staffTasks = tasks.filter((task) => task.kind !== "upload" && inScope(task) && task.process !== "pbm");
  const openStaffTasks = staffTasks.filter(isOpen);
  const finished = staffTasks.filter((task) => task.status === "done");
  // Nahrané dokumenty, o které jsme nežádali (zpráva navíc, nečitelná fotka…).
  const requestTaskIds = new Set(rows.map(({ task }) => task.id));
  const requestDocIds = new Set(rows.flatMap(({ document }) => (document ? [document.id] : [])));
  const taskOf = new Map(detail.documents.map((doc) => [doc.id, doc.taskId]));
  const others = documentGroups(detail).filter((group) =>
    group.pages.every((page) => !requestDocIds.has(page.id) && !requestTaskIds.has(taskOf.get(page.id) ?? "")),
  );
  const requestedTypes = new Set(rows.filter(({ task }) => task.status !== "done").map(({ task }) => task.documentType));

  async function run(key: string, call: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await call();
      await revalidate(`/api/v1/cases/${caseId}`, "/api/v1/queue");
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(null);
    }
  }
  const setStatus = (task: Task, status: "done" | "cancelled") =>
    run(task.id, () => api.patch(`/api/v1/cases/${caseId}/tasks/${task.id}`, status === "cancelled" ? { status, statusNote: "Odebráno ambulancí." } : { status }));

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            Vyžádáno od pacienta
            <InfoTip>
              Co jsme pacienta požádali nahrát a kde to je: vyžádáno, pacient požadavek viděl (otevřel si přípravu v aplikaci) a nahrál. Žlutá čeká na pacienta. Nepotřebný požadavek jde odebrat a kdykoli zase vyžádat.
            </InfoTip>
          </h2>
          {rows.length > 0 && <p className="text-sm text-muted-foreground tabular-nums">{`${uploaded} z ${rows.length} nahráno`}</p>}
        </div>
        {!picking && !locked && (
          <button
            type="button"
            onClick={() => setPicking(true)}
            className={cn(buttonVariants(), "h-11 shrink-0 rounded-full px-5 text-base")}
          >
            <Plus className="size-4" />
            <span className="sm:hidden">Vyžádat další</span>
            <span className="hidden sm:inline">Vyžádat další dokument</span>
          </button>
        )}
      </div>

      {picking && (
        <div className="rounded-2xl bg-background p-5">
          <DocumentRequestForm caseId={caseId} exclude={requestedTypes} onDone={() => setPicking(false)} onCancel={() => setPicking(false)} />
        </div>
      )}

      <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-background">
        {rows.map(({ task, document, steps, status }) => {
          const Icon = visitIcon(task.documentType);
          const uploader = document ? helperUploadNote(detail.people, document.uploadedBy) : null;
          const waivable = isOpen(task) && !document;
          const wanted = requestDetail(task);
          return (
            <li key={task.id} className="flex flex-col gap-3 px-4 py-4 md:grid md:grid-cols-12 md:items-center md:gap-6 md:px-5">
              <div className="flex min-w-0 items-start gap-3 md:col-span-7">
                <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="truncate text-base font-medium">{task.title}</div>
                  {wanted && <div className="truncate text-sm text-muted-foreground" title={wanted}>{wanted}</div>}
                  <StatusLine status={status} />
                  {uploader && <div className="truncate text-sm text-muted-foreground">{uploader}</div>}
                  {task.status === "snoozed" && (
                    <div className="truncate text-sm text-muted-foreground">
                      Odloženo{task.snoozedUntil ? ` do ${formatDate(task.snoozedUntil)}` : ""}
                      {task.statusNote ? ` · ${task.statusNote}` : ""}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4 md:col-span-5">
                <StepBar steps={steps} className="min-w-0 flex-1" />
                {/* Akce řádku úplně vpravo: nahraný zobrazit, nenahraný odebrat (červeně, s potvrzením). */}
                <div className="flex w-28 shrink-0 justify-end">
                  {document ? (
                    <Link
                      href={`/staff/${caseId}/documents/${document.id}`}
                      aria-label={`Zobrazit: ${task.title}`}
                      className={cn(pill, "flex items-center gap-1.5 bg-muted hover:bg-muted/70")}
                    >
                      <EyeIcon className="size-4" />
                      Zobrazit
                    </Link>
                  ) : (
                    waivable &&
                    !locked && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => setWaive(task)}
                        className={cn(pill, "bg-destructive/10 text-destructive hover:bg-destructive/15")}
                      >
                        Odebrat
                      </button>
                    )
                  )}
                </div>
              </div>
            </li>
          );
        })}

        {rows.length === 0 && (
          <li className="flex min-h-14 items-center gap-3 px-5 py-3 text-base text-muted-foreground">Od pacienta zatím nic nechceme</li>
        )}


      </ul>

      {others.length > 0 && (
        <ListCard title="Další dokumenty nahrané pacientem" count={others.length} info="Co nahrál pacient nebo jeho pomocník z rodiny, i když jsme o to nežádali.">
          {others.map((group) => {
            const unsure = group.pages.some((page) => !page.identityOk);
            const uploader = group.pages.map((page) => helperUploadNote(detail.people, detail.documents.find((doc) => doc.id === page.id)?.uploadedBy)).find(Boolean);
            return (
              <li key={group.id}>
                <Link
                  href={`/staff/${caseId}/documents/${group.id}`}
                  className="press flex min-h-14 items-center gap-3 px-5 py-3 outline-none select-none hover:bg-muted/50 focus-visible:bg-muted"
                >
                  <ReportIcon className="size-5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base">{group.typeLabel}</span>
                    <span className={cn("block text-sm", unsure ? "text-amber-700" : "text-muted-foreground")}>
                      {unsure ? "Nelze přiřadit pacientovi" : `${group.date ?? "Bez data"} · ${pagesLabel(group.pages.length)}`}
                    </span>
                    {uploader && <span className="block text-sm text-muted-foreground">{uploader}</span>}
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ListCard>
      )}

      {/* Úkoly ambulance stejně jako vyžádané dokumenty: nadpis nad seznamem, řádky v bílém bloku, akce na konci řádku.
          Splnění kolečkem vlevo (jako v Připomínkách na iPhonu), hotové zůstanou dole se zelenou fajfkou a datem. */}
      {(openStaffTasks.length > 0 || finished.length > 0) && (
        <div className="mt-5 flex flex-col gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              Úkoly ambulance
              <InfoTip>Úkoly ze šablony zákroku a ty, které jste přidali. Kolečkem vlevo označíte úkol jako hotový, nepotřebný jde odebrat.</InfoTip>
            </h2>
            <p className="text-sm text-muted-foreground tabular-nums">
              {[openStaffTasks.length > 0 && countWord(openStaffTasks.length, ["otevřený", "otevřené", "otevřených"]), finished.length > 0 && countWord(finished.length, ["hotový", "hotové", "hotových"])]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-background">
            {openStaffTasks.map((task) => {
              const ours = task.assignee === "aa";
              return (
                <li key={task.id} className="flex items-center gap-2 py-2 pr-4 pl-2 md:pr-5">
                  {ours ? (
                    <TaskCheck title={task.title} saving={busy === task.id} disabled={busy !== null || locked} onDone={() => void setStatus(task, "done")} />
                  ) : (
                    <span className="flex size-11 shrink-0 items-center justify-center" aria-hidden>
                      <WaitingIcon className="size-5 text-muted-foreground" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1 py-1">
                    <div className="text-base font-medium">{task.title}</div>
                    <div className="text-sm text-muted-foreground">
                      {ours ? "Udělá ambulance" : "Čeká na pacienta"}
                      {task.dueDate && ` · do ${formatDate(task.dueDate)}`}
                    </div>
                  </div>
                  {!locked && (
                    <button type="button" disabled={busy !== null} onClick={() => setWaive(task)} className={cn(pill, "bg-destructive/10 text-destructive hover:bg-destructive/15")}>
                      Odebrat
                    </button>
                  )}
                </li>
              );
            })}
            {finished.map((task) => (
              <li key={task.id} className="flex items-center gap-2 py-2 pr-4 pl-2 md:pr-5">
                <span className="flex size-11 shrink-0 items-center justify-center" role="img" aria-label="Hotovo">
                  <span className="flex size-7 items-center justify-center rounded-full bg-status-done-accent text-white">
                    <Check className="size-4" strokeWidth={3} />
                  </span>
                </span>
                <div className="min-w-0 flex-1 py-1">
                  <div className="text-base text-muted-foreground">{task.title}</div>
                  <div className="text-sm text-muted-foreground tabular-nums">{task.completedAt ? `Hotovo ${formatDate(task.completedAt)}` : "Hotovo"}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={waive !== null}
        onOpenChange={(open) => !open && setWaive(null)}
        title="Odebrat ze seznamu?"
        description={waive ? `„${waive.title}“ zmizí z toho, co po pacientovi chceme, a pacient to nebude muset nahrávat. Kdykoli to můžete vyžádat znovu.` : ""}
        confirmLabel="Odebrat"
        destructive
        onConfirm={() => waive && void setStatus(waive, "cancelled")}
      />
    </section>
  );
}

// Kolečko u úkolu ambulance: prázdné, na najetí zelená fajfka, klik úkol splní. Během ukládání spinner.
// Splnění je vratné (úkol jde otevřít znovu), proto bez potvrzovacího dialogu.
function TaskCheck({ title, saving, disabled, onDone }: { title: string; saving: boolean; disabled: boolean; onDone: () => void }) {
  if (saving) {
    return (
      <span role="status" aria-label="Ukládám" className="flex size-11 shrink-0 items-center justify-center">
        <Loader2 className="size-6 text-muted-foreground motion-safe:animate-spin" />
      </span>
    );
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onDone}
      aria-label={`Hotovo: ${title}`}
      title="Označit jako hotové"
      className="group press flex size-11 shrink-0 items-center justify-center rounded-full outline-none select-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
    >
      <span className="flex size-7 items-center justify-center rounded-full border-2 border-foreground/20 text-transparent transition-colors motion-safe:ease-smooth group-hover:border-status-done-accent group-hover:text-status-done-accent">
        <Check className="size-4" strokeWidth={3} />
      </span>
    </button>
  );
}

// 1 otevřený, 2 až 4 otevřené, 0 a 5 a víc otevřených.
const countWord = (count: number, [one, few, many]: [string, string, string]) => `${count} ${count === 1 ? one : count >= 2 && count <= 4 ? few : many}`;

function requestProgress(task: Task, document: CaseDocument | undefined, today: string): { steps: Step[]; status: Status } {
  const uploaded = Boolean(document) || task.status === "submitted" || task.status === "done";
  const uploadedAt = document?.uploadedAt ?? (uploaded ? task.completedAt : null);
  // Viděno: pacient otevřel přehled zákroku, když už byl požadavek v seznamu (tasks.read_at, zapisuje markTasksRead).
  // Kdo nahrál, požadavek viděl, i když přehled neotevřel (nahrál pomocník z rodiny): pak platí datum nahrání.
  const seenAt = task.readAt ?? (uploaded ? uploadedAt : null);
  const late = !uploaded && task.dueDate !== null && task.dueDate < today;
  const due = task.status === "snoozed" ? "odloženo" : task.dueDate ? `${late ? "po termínu" : "do"} ${formatDate(task.dueDate)}` : null;

  // Žlutý (po termínu červený) je jen úsek, na který se právě čeká. Dokud pacient požadavek neviděl, je nahrání až potom.
  const steps: Step[] = [
    { label: "Vyžádáno", state: "done" },
    { label: "Viděno", state: seenAt ? "done" : "waiting", late: !seenAt && late },
    { label: "Nahráno", state: uploaded ? "done" : seenAt ? "waiting" : "idle", late: Boolean(seenAt) && late },
  ];
  const status: Status = uploaded
    ? { tone: "done", parts: [{ text: uploadedAt ? `Nahráno ${formatDate(uploadedAt)}` : "Nahráno" }] }
    : seenAt
      ? { tone: late ? "late" : "waiting", parts: [{ text: `Viděno pacientem ${formatDate(seenAt)}` }, { text: "čeká na nahrání" }, ...(due ? [{ text: due, late }] : [])] }
      : { tone: late ? "late" : "waiting", parts: [{ text: "Pacientem zatím neviděno" }, { text: `vyžádáno ${formatDate(task.createdAt)}` }, ...(late && due ? [{ text: due, late }] : [])] };
  return { steps, status };
}

const progress = (steps: Step[]) => steps.filter((step) => step.state === "done").length / steps.length;

// Poslední stav jednou větou pod názvem: fajfka u hotového, jinak tečka v barvě úseku, na který se čeká.
function StatusLine({ status }: { status: Status }) {
  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      {status.tone === "done" ? (
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-status-done-accent text-white">
          <Check className="size-2.5" strokeWidth={3.5} />
        </span>
      ) : (
        <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", status.tone === "late" ? "bg-destructive" : "bg-status-todo-accent")} />
      )}
      <span>
        {status.parts.map((part, i) => (
          <span key={part.text}>
            {i > 0 && " · "}
            <span className={cn(part.late && "font-medium text-destructive")}>{part.text}</span>
          </span>
        ))}
      </span>
    </p>
  );
}

// Tenký pruh ze tří úseků a pod ním malé popisky, ten, na který se čeká, tučně. Jen pro oko: totéž říká věta
// pod názvem, čtečka pruh přeskočí.
function StepBar({ steps, className }: { steps: Step[]; className?: string }) {
  return (
    <div aria-hidden className={cn("flex flex-col gap-1.5", className)}>
      <div className="grid grid-cols-3 gap-1">
        {steps.map((step) => (
          <span
            key={step.label}
            className={cn(
              "h-1.5 rounded-full",
              step.state === "done" ? "bg-status-done-accent" : step.state === "waiting" ? (step.late ? "bg-destructive" : "bg-status-todo-accent") : "bg-border",
            )}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1 text-xs text-muted-foreground">
        {steps.map((step) => (
          <span key={step.label} className={cn("truncate", step.state === "waiting" && "font-semibold text-foreground")}>
            {step.label}
          </span>
        ))}
      </div>
    </div>
  );
}
