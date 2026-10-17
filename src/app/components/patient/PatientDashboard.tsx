"use client";

import { Children, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, Loader } from "lucide-react";
import { DetailSection } from "@/app/components/shared/DetailSection";
import { Reveal } from "@/app/components/shared/motion/Reveal";
import { Stagger, StaggerItem } from "@/app/components/shared/motion/Stagger";
import { usePatientCase } from "@/app/components/patient/PatientCase";
import { RadioMessage, personOf } from "@/app/components/patient/TodayPanel";
import { RelayTrack } from "@/app/components/patient/RelayTrack";
import { TodoCards, documentCards, taskCards, type TodoCard } from "@/app/components/patient/TodoCards";
import { UploadLabel } from "@/app/components/patient/UploadLabel";
import { patientPlan } from "@/app/components/patient/plan";
import { DocumentViewer } from "@/app/components/patient/DocumentViewer";
import { DoneIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { useSession } from "@/app/components/shared/Session";
import { documentTypeLabel } from "@/lib/caseView";
import { formatDate } from "@/lib/date";
import { documentsWord } from "@/lib/plural";
import { cn } from "@/lib/utils";

// Přehled pacienta k vybranému zákroku (data z PatientCaseProvider), dvě úrovně:
// - jednoduchá (výchozí): zpráva z rádia od člověka z ambulance s jedním tlačítkem a pod ní karty, co je potřeba
// - podrobná: termín a souhrn nahoře, pod tím papíry, úkoly a další sekce
// Pacient nevidí hodnoty ani diagnózy, jen co má udělat.
// Rozložení (rules/design.md): telefon a tablet jeden sloupec. Desktop dva: v jednoduché úrovni vlevo zpráva
// (zůstává na místě, když se karty vpravo posouvají), v podrobné vlevo co udělat a vpravo informace a nastavení.

type Props = {
  /** jednoduchá: zpráva a karty; podrobná: souhrn a všechny sekce */
  detailed: boolean;
  /** přepínač úrovně, ukáže se pod zprávou */
  levelToggle: React.ReactNode;
  // Pomocník nepodepisuje souhlas za pacienta.
  forHelper?: boolean;
  // Další sekce do pravého sloupce (jen podrobná úroveň).
  children?: React.ReactNode;
};

export function PatientDashboard({ detailed, levelToggle, forHelper = false, children }: Props) {
  const { caseId, view, tasks, refresh } = usePatientCase();
  const { id: userId } = useSession();
  const { visits, rows, open, uploaded, needed, next } = patientPlan(caseId, view, tasks, forHelper);
  // Papír otevřený v okně (zobrazit, svůj odstranit) a rozbalení „Další nahrané papíry“.
  const [viewing, setViewing] = useState<{ id: string; title: string; canRemove: boolean } | null>(null);
  const [extraOpen, setExtraOpen] = useState(false);
  // Dokud AI nějaký papír čte, přehled se sám obnovuje, ať je vidět, až dočte.
  const reading = view.documents.some(isReading);
  useEffect(() => {
    if (!reading) return;
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [reading, refresh]);
  const showDoc = (id: string, title: string) => setViewing({ id, title, canRemove: view.documents.find((doc) => doc.id === id)?.uploadedBy === userId });

  const finished = view.status === "cancelled" || view.status === "closed";
  // Svůj úsek má pacient za sebou: karta s přetrženou páskou (RelayTrack). Ke zrušenému a proběhlému zákroku ne.
  const relayDone = next === null && !finished;
  // Křestní jméno z kontaktu ambulance pro štafetu („Kolík teď nese Jana“), systémový účet nepočítáme.
  const firstName = personOf(view.contact)?.displayName.trim().split(/\s+/)[0] ?? null;
  const relay = relayDone && <RelayTrack view={view} patientRunning={false} contactName={firstName} />;
  const papers = documentCards(needed, visits);

  const viewer = viewing && (
    <DocumentViewer
      caseId={caseId}
      documentId={viewing.id}
      title={viewing.title}
      canRemove={viewing.canRemove}
      onClose={() => setViewing(null)}
      onRemoved={async () => {
        await refresh();
        setViewing(null);
      }}
    />
  );

  if (!detailed) {
    // Papíry i úkoly v appce (souhlas, fotka úst) v jednom seznamu karet. Ke skončenému zákroku karty nejsou.
    const cards = finished ? [] : [...papers, ...taskCards(rows.filter((row) => row.kind))];
    const otherPaper = !finished && needed.length === 0;
    const side = relayDone || cards.length > 0 || otherPaper;
    return (
      <>
        {/* Pro seniory: zpráva s jedním velkým tlačítkem, pod ní karty. Když je hotovo, karta „Svůj úsek máte za sebou“
            jde na telefonu nahoru. Na desktopu stojí zpráva vlevo a vše ostatní je vpravo (umístění v mřížce). */}
        <Reveal className={cn("flex flex-col gap-12 pb-16", side && "lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-16 lg:gap-y-12")}>
          {relay && <div className="lg:col-span-7 lg:col-start-6 lg:row-start-1">{relay}</div>}
          <div className={cn(side ? "lg:sticky lg:top-8 lg:col-span-5 lg:col-start-1 lg:row-span-3 lg:row-start-1" : "lg:max-w-2xl")}>
            <RadioMessage step={next} view={view} contact={view.contact} more={levelToggle} />
          </div>
          {cards.length > 0 && (
            <section aria-labelledby="co-je-potreba" className="flex flex-col gap-4 lg:col-span-7 lg:col-start-6">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 id="co-je-potreba" className="text-2xl font-semibold tracking-tight">
                  {cards.every((card) => card.done) ? "Co jste nám poslali" : "Co od vás potřebujeme"}
                </h2>
                <p className="text-lg text-muted-foreground tabular-nums">{doneLabel(cards)}</p>
              </div>
              <TodoCards cards={cards} contact={view.contact} onView={showDoc} />
            </section>
          )}
          {otherPaper && (
            <Link
              href="/patient/upload"
              className="inline-flex min-h-12 w-fit items-center text-lg text-muted-foreground underline underline-offset-4 hover:text-foreground lg:col-span-7 lg:col-start-6"
            >
              <span className="lg:hidden">Máte jiný podklad od lékaře? Vyfoťte ho</span>
              <span className="hidden lg:inline">Máte jiný podklad od lékaře? Nahrajte ho</span>
            </Link>
          )}
        </Reveal>
        {viewer}
      </>
    );
  }

  // Podrobné zobrazení: pro toho, kdo chce vidět všechno najednou (často pomocník z rodiny). Nahoře termín, souhrn
  // a jedno tlačítko, pod tím vlevo papíry a úkoly, vpravo „Než přijdete“, „Pro ambulanci“ a pomocníci.
  // Papíry nahrané navíc, mimo vyžádané (seznam léků, zpráva bez úkolu, fotky z telefonu): ať pacient vidí,
  // že dorazily. Vyžádané jsou už nahoře u „Papíry od lékařů“.
  const requested = new Set(tasks.flatMap((task) => (task.documentId ? [task.documentId] : [])));
  const extra = view.documents.filter((doc) => !doc.taskId && !requested.has(doc.id));
  const extraReading = extra.filter(isReading).length;
  const extraCards = extra.map((doc): TodoCard => {
    const unread = isReading(doc);
    const title = doc.type ? documentTypeLabel(doc.type) : "Podklad od lékaře";
    return {
      id: doc.id,
      title: unread ? "Nahráno, čeká na přečtení" : title,
      done: true,
      icon: unread ? ReadingIcon : DoneIcon,
      status: unread ? "AI podklad čte, chvilku to potrvá" : doc.status === "failed" ? "Nepodařilo se přečíst, ambulance ho uvidí i tak" : `Nahráno ${formatDate(doc.uploadedAt)}`,
      action: { kind: "view", documentId: doc.id },
    };
  });
  const tasksList = rows.length > 0 ? taskCards(rows) : [{ id: "none", title: "Teď od vás nic nepotřebujeme", done: true, icon: DoneIcon }];
  const missing = visits.filter((visit) => !visit.done).length;
  const summary = [missing ? `chybí ${missing} ${documentsWord(missing)}` : null, open.length ? `${open.length} ${open.length === 1 ? "úkol" : open.length < 5 ? "úkoly" : "úkolů"} v aplikaci` : null]
    .filter(Boolean)
    .join(" · ");
  const sections = Children.toArray(children).filter(Boolean);
  return (
    <div className="flex flex-col gap-10 pb-16">
      <Reveal className="flex flex-col gap-6 border-b border-border pb-8 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">Vaše příprava</p>
          <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">{surgeryLine(view)}</h1>
          <p className="text-base text-muted-foreground lg:text-lg">{summary || "Teď od vás nic nepotřebujeme."}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3">
          <Link
            href="/patient/upload"
            className="press flex h-12 items-center gap-2 rounded-full bg-primary px-6 text-base font-semibold text-primary-foreground outline-none select-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <UploadLabel phone="Vyfotit podklad" computer="Nahrát podklad" />
          </Link>
          <span className="text-base">{levelToggle}</span>
        </div>
      </Reveal>

      <Stagger delay={0.05} className="flex flex-col gap-10 lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-16">
        <div className="flex flex-col gap-10 lg:col-span-7">
          {relay && <StaggerItem>{relay}</StaggerItem>}
          {papers.length > 0 && (
            <StaggerItem>
              <DetailSection title="Podklady od lékařů" aside={`${uploaded} z ${visits.length} nahráno`}>
                <TodoCards cards={papers} contact={view.contact} onView={showDoc} />
              </DetailSection>
            </StaggerItem>
          )}
          {extra.length > 0 && (
            <StaggerItem>
              {/* Rozbalovací: papíry navíc nejsou úkol, jen potvrzení, že dorazily. V nadpisu počet a kolik se jich čte. */}
              <section className="flex flex-col gap-3">
                <button
                  type="button"
                  aria-expanded={extraOpen}
                  onClick={() => setExtraOpen((value) => !value)}
                  className="flex min-h-12 items-center justify-between gap-4 rounded-xl text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <h2 className="text-xl font-semibold tracking-tight">Další nahrané podklady</h2>
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    {extraReading > 0 && <Loader className="size-4 motion-safe:animate-spin" />}
                    {extraReading > 0 ? `${extra.length} · ${extraReading} se čte` : extra.length}
                    <ChevronDown className={cn("size-5 transition-transform motion-safe:ease-smooth", extraOpen && "rotate-180")} />
                  </span>
                </button>
                {extraOpen && <TodoCards cards={extraCards} contact={view.contact} onView={showDoc} />}
              </section>
            </StaggerItem>
          )}
          <StaggerItem>
            <DetailSection title="Úkoly v aplikaci" aside={open.length ? remainingLabel(open.length) : "Vše hotovo"}>
              <TodoCards cards={tasksList} contact={view.contact} onView={showDoc} />
            </DetailSection>
          </StaggerItem>
        </div>
        {sections.length > 0 && (
          <div className="flex flex-col gap-10 lg:col-span-5">
            {sections.map((section, i) => (
              <StaggerItem key={i}>{section}</StaggerItem>
            ))}
          </div>
        )}
      </Stagger>
      {viewer}
    </div>
  );
}

// Nahraný papír, který AI ještě čte.
const isReading = (doc: { status: string }) => doc.status === "uploaded" || doc.status === "processing";

const ReadingIcon = ({ className }: { className?: string }) => <Loader className={cn(className, "motion-safe:animate-spin")} aria-label="Čte se" />;

function doneLabel(cards: TodoCard[]) {
  const done = cards.filter((card) => card.done).length;
  return done === cards.length ? "vše hotovo" : `${done} z ${cards.length} hotovo`;
}

const LONG_DATE = new Intl.DateTimeFormat("cs-CZ", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Prague" });

function surgeryLine(view: { surgeryDate: string | null; daysToCase: number | null }) {
  if (!view.surgeryDate) return "Termín zákroku vám dáme vědět";
  const date = LONG_DATE.format(new Date(`${view.surgeryDate}T12:00:00Z`));
  const d = view.daysToCase;
  return `Zákrok ${date}${d !== null && d >= 0 ? ` · ${d === 0 ? "dnes" : d === 1 ? "zítra" : `za ${d} ${d < 5 ? "dny" : "dní"}`}` : ""}`;
}

const remainingLabel = (count: number) => (count === 1 ? "1 zbývá" : count < 5 ? `${count} zbývají` : `${count} zbývá`);
