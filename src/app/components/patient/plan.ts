import type { Visit } from "@/app/components/shared/VisitList";
import { isClientDocumentType } from "@/db/catalog";
import { documentUrl } from "@/lib/api/client";
import type { PatientCaseView, Task } from "@/lib/api/types";
import { readinessInput, stepOf } from "@/lib/caseView";
import { readiness } from "@/lib/readiness";
import { formatDate, todayIso } from "@/lib/date";
import { CONSENT_SIGNING } from "@/lib/features";

// Co má pacient udělat: úkoly zákroku převedené na řádky, zprávy od lékařů a jeden další krok.
// Sdílí to jednoduché zobrazení (jen zpráva z rádia) i podrobné (zpráva a seznamy).

export type Row = {
  id: string;
  title: string;
  detail?: string;
  note?: string;
  done: boolean;
  action?: { label: string; href: string };
  /** úkol přímo v appce (podpis souhlasu, fotka úst): podle něj ikona karty, i když je hotový */
  kind?: "consent" | "airway";
};

/** Jeden krok, který má pacient udělat teď. Text zprávy skládá RadioMessage podle druhu. */
export type Step =
  | { kind: "pbm"; label: string; href: string; detail?: string }
  | { kind: "report"; title: string; count: number; neededId: string; label: string; href: string; detail?: string }
  | { kind: "consent"; label: string; href: string }
  | { kind: "airway"; label: string; href: string }
  | { kind: "other"; title: string; note: string | null; label: string; href: string };

/** Co pacient ještě musí zařídit mimo appku (papír od lékaře, odběr krve): kde to získá a do kdy. */
export type Needed = {
  id: string;
  kind: "report" | "pbm";
  title: string;
  /** druh papíru (db/catalog.ts), podle něj ikona */
  documentType: string | null;
  /** co v dokumentu má být, jak to napsala ambulance (pacient to ukáže lékaři) */
  detail?: string;
  /** kde to pacient získá, jedna věta */
  where: string;
  /** je potřeba se objednat (praktik, specialista), ne jen najít doma */
  book: boolean;
  /** ISO datum, do kdy se objednat; null = bez termínu, "asap" = mělo už běžet */
  deadline: string | null | "asap";
  href: string;
};

// Kde pacient papír získá. Mluvíme jen o tom, kdo vyšetření běžně dělá, ne o tom, jestli je potřeba (to rozhodla ambulance).
const WHERE: Record<string, { where: string; book: boolean }> = {
  preop_exam: { where: "Předoperační vyšetření vám udělá praktický lékař.", book: true },
  lab_report: { where: "Odběr krve vám udělá praktický lékař.", book: true },
  ecg: { where: "EKG vám natočí praktický lékař.", book: true },
  imaging_report: { where: "Vyšetření dělá radiologie, domluvte se se svým praktickým lékařem.", book: true },
  specialist_report: { where: "Zprávu vám dá váš specialista.", book: true },
  outpatient_report: { where: "Zprávu vám dá ambulance, kde se léčíte.", book: false },
  anesthesia_record: { where: "Záznam má nemocnice, kde jste byli v narkóze. Když ho nemáte, nevadí.", book: false },
  medication_list: { where: "Stačí vyfotit krabičky léků, které berete.", book: false },
  discharge_report: { where: "Zprávu vám dá nemocnice, kde jste leželi.", book: false },
};
const whereOf = (documentType: string | null) => WHERE[documentType ?? ""] ?? { where: "Zeptejte se lékaře, který vás vyšetřoval.", book: false };

const addDays = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);

// Do kdy se objednat: dřívější z termínu úkolu a posledního rozumného startu podle časové osy (čekací doby VFN).
function deadlineOf(task: Task, latestStartByStep: Map<string, number>, today: string): Needed["deadline"] {
  const step = stepOf(task);
  const latest = step !== null ? latestStartByStep.get(step) : undefined;
  if (latest !== undefined && latest < 0) return "asap";
  const fromSteps = latest !== undefined ? addDays(today, latest) : null;
  const candidates = [fromSteps, task.dueDate].filter((d): d is string => !!d).sort();
  return candidates[0] ?? null;
}

export const waiting = (task: Task) => task.status === "open" || task.status === "snoozed";

// Zpráva od lékaře: úkol na nahrání dokumentu, který čte AI. Fotka, podpis a hlasovka mají vlastní místo.
// Výsledky krve vyžádané kvůli Hb (PBM) jsou taky zpráva, jen jdou v pořadí první.
const isReport = (task: Task) => task.kind === "upload" && !isClientDocumentType(task.documentType);

// Kde se úkol plní. Fotka pacienta a hlasovka jsou přímo na přehledu, odkaz nepotřebují.
function taskAction(task: Task): Row["action"] {
  if (!waiting(task)) return undefined;
  if (task.kind !== "upload") return undefined;
  if (task.documentType === "consent_signature") return { label: "Podepsat", href: "/patient/consent" };
  if (task.documentType === "airway_photo") return { label: "Vyfotit", href: "/patient/airway" };
  return undefined;
}

const rowKind = (task: Task): Row["kind"] => (task.documentType === "consent_signature" ? "consent" : task.documentType === "airway_photo" ? "airway" : undefined);

function taskRow(task: Task): Row {
  const { title } = task;
  const kind = rowKind(task);
  const requested = `Vyžádáno ${formatDate(task.createdAt)}${task.dueDate ? ` · do ${formatDate(task.dueDate)}` : ""}`;
  if (task.status === "done") return { id: task.id, title, detail: "Hotovo", done: true, kind };
  if (task.status === "submitted") return { id: task.id, title, detail: "Nahráno, ambulance si to prohlédne", done: true, kind };
  return { id: task.id, title, detail: requested, note: task.instructions ?? undefined, done: false, action: taskAction(task), kind };
}

function reportVisit(caseId: string, task: Task, view: PatientCaseView): Visit {
  const document = task.documentId ? view.documents.find((doc) => doc.id === task.documentId) : undefined;
  const uploadedAt = document?.uploadedAt ?? task.completedAt;
  return {
    id: task.id,
    title: task.title,
    documentType: task.documentType,
    done: !waiting(task),
    uploadedAt: uploadedAt ? formatDate(uploadedAt) : undefined,
    uploadHref: `/patient/upload?task=${task.id}`,
    viewHref: task.documentId ? documentUrl(caseId, task.documentId) : undefined,
    documentId: task.documentId ?? undefined,
  };
}

// Pořadí: výsledky krve (PBM spěchá), chybějící zprávy (nejdřív ta s nejbližším termínem), souhlas, fotka úst, ostatní.
function nextStepOf(needed: Needed[], rows: Row[]): Step | null {
  const lab = needed.find((item) => item.kind === "pbm");
  if (lab) return { kind: "pbm", label: "Vyfotit výsledek", href: lab.href, detail: lab.detail };
  const reports = needed.filter((item) => item.kind === "report");
  // Pořadí papírů neurčujeme: záleží, kde a kdy je pacient získá. Jedno tlačítko „Vyfotit papír“, AI pozná, o který jde.
  // Detail od ambulance jen u jediného papíru; u víc papírů je u každého v seznamu.
  if (reports.length > 1) return { kind: "report", title: reports[0].title, count: reports.length, neededId: reports[0].id, label: "Vyfotit podklad", href: "/patient/upload" };
  if (reports[0]) return { kind: "report", title: reports[0].title, count: 1, neededId: reports[0].id, label: "Vyfotit podklad", href: reports[0].href, detail: reports[0].detail };
  if (rows.some((row) => !row.done && row.action?.href === "/patient/consent")) return { kind: "consent", label: "Přečíst a podepsat", href: "/patient/consent" };
  if (rows.some((row) => !row.done && row.action?.href === "/patient/airway")) return { kind: "airway", label: "Vyfotit pusu", href: "/patient/airway" };
  const other = rows.find((row) => !row.done && row.action);
  return other?.action ? { kind: "other", title: other.title, note: other.note ?? null, label: other.action.label, href: other.action.href } : null;
}

export function patientPlan(caseId: string, view: PatientCaseView, tasks: Task[], forHelper: boolean) {
  // Pomocník souhlas nepodepisuje (hlídá i API), úkol na podpis mu proto ani nenabízíme. Když je podpis v appce
  // vypnutý (lib/features.ts), nevidí ho nikdo.
  const live = tasks.filter((task) => task.status !== "cancelled" && !((forHelper || !CONSENT_SIGNING) && task.documentType === "consent_signature"));
  const visits = live.filter(isReport).map((task) => reportVisit(caseId, task, view));
  const rows: Row[] = live.filter((task) => !isReport(task)).map(taskRow);
  // Souhlas podepisuje jen pacient. Když na něj ambulance nemá úkol, je tu i tak.
  if (CONSENT_SIGNING && !forHelper && !live.some((task) => task.documentType === "consent_signature")) {
    rows.push(
      view.consent
        ? { id: "consent", title: "Souhlas s anestezií", detail: `Podepsáno ${formatDate(view.consent.signedAt)}`, done: true, kind: "consent" }
        : { id: "consent", title: "Souhlas s anestezií", done: false, action: { label: "Podepsat", href: "/patient/consent" }, kind: "consent" },
    );
  }
  const finished = view.status === "cancelled" || view.status === "closed";
  const today = todayIso();
  const steps = readiness(readinessInput(view.daysToCase, live, false)).steps;
  const latestStartByStep = new Map(steps.map((step) => [step.id, step.latestStart]));
  const order = (d: Needed["deadline"]) => (d === "asap" ? "0" : (d ?? "9"));
  const needed: Needed[] = live
    .filter((task) => waiting(task) && isReport(task))
    .map((task): Needed => {
      const { where, book } = whereOf(task.documentType);
      return {
        id: task.id,
        kind: task.process === "pbm" ? "pbm" : "report",
        title: task.title,
        documentType: task.documentType,
        detail: task.instructions ?? undefined,
        where,
        book,
        deadline: deadlineOf(task, latestStartByStep, today),
        href: `/patient/upload?task=${task.id}`,
      };
    })
    .sort((a, b) => Number(b.kind === "pbm") - Number(a.kind === "pbm") || order(a.deadline).localeCompare(order(b.deadline)));
  return {
    visits,
    rows,
    open: rows.filter((row) => !row.done),
    done: rows.filter((row) => row.done),
    uploaded: visits.filter((visit) => visit.done).length,
    /** kolik věcí na pacienta čeká, pro „Zobrazit všechno“ */
    waitingCount: rows.filter((row) => !row.done).length + visits.filter((visit) => !visit.done).length,
    /** co je ještě potřeba zařídit, nejdřív odběr a pak podle termínu */
    needed: finished ? [] : needed,
    next: finished ? null : nextStepOf(needed, rows),
  };
}
