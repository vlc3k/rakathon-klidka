"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { PatientCaseView } from "@/lib/api/types";
import { daysWord, documentsWord } from "@/lib/plural";
import { usePatientCase } from "@/app/components/patient/PatientCase";
import { useSession } from "@/app/components/shared/Session";
import { patientPlan, type Step } from "@/app/components/patient/plan";
import { RelayLine } from "@/app/components/shared/motion/RelayLine";
import { UploadLabel } from "@/app/components/patient/UploadLabel";
import { CalendarIcon, CameraIcon, FamilyIcon, MouthIcon, PhoneIcon, SignIcon } from "@/app/components/shared/icons/KlidkaIcons";

// Ikona u hlavního tlačítka podle toho, co pacient udělá.
const STEP_ICON: Record<Step["kind"], ((props: { className?: string }) => React.ReactElement) | null> = {
  pbm: CameraIcon,
  report: CameraIcon,
  consent: SignIcon,
  airway: MouthIcon,
  other: null,
};

// Vedlejší akce pod zprávou jako velká tlačítka (aspoň 56 px, celá šířka, ikona a popisek), ne podtržené odkazy:
// senioři se do malých odkazů netrefí a podtržený text nečtou jako něco, na co se dá klepnout.
const LINK = "press flex min-h-14 w-full max-w-sm items-center gap-3 rounded-2xl border-2 border-border bg-background px-5 py-3 text-left text-lg font-medium outline-none select-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const LINK_TEXT = "";

// Rádio Klidky (docs/brain/10-rozhodnuti.md): místo přehledu jedna zpráva od konkrétního člověka z ambulance,
// jako závodní inženýr do rádia. Jedna věta, jedno tlačítko, pod tím zavolat a pozvat pomocníka z rodiny.
// Proč: lidé v čekání před operací nejvíc trpí nejistotou, nevolají ze strachu, že obtěžují, a logistiku
// často dělá někdo z rodiny (docs/brain/25-zlidsteni-pacienta.md). Jediná modrá na stránce je tlačítko.

type Contact = PatientCaseView["contact"] | null;

// Kontakt je člověk, ne systémový účet: „Admin“ nebo e-mail by zprávu nepodepsal nikdo konkrétní.
// Pak píše ambulance v množném čísle.
export const personOf = (contact: Contact): Contact =>
  contact && !/^(admin|administr[aá]tor|test)\b/i.test(contact.displayName.trim()) && !contact.displayName.includes("@") ? contact : null;

const LONG_DATE = new Intl.DateTimeFormat("cs-CZ", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Prague" });
const DAY_MONTH = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "long", timeZone: "Europe/Prague" });
const atNoon = (iso: string) => new Date(`${iso}T12:00:00Z`);

// Se jménem píše člověk v jednotném čísle, bez kontaktu ambulance v množném.
export function messageText(step: Step | null, view: PatientCaseView, person: boolean): string {
  const v = (one: string, many: string) => (person ? one : many);
  if (view.status === "cancelled") return `Zákrok je zrušený. Kdyby vám něco nebylo jasné, ${v("zavolejte mi", "zavolejte nám")}.`;
  if (view.status === "closed") return `Zákrok je za vámi. ${v("Děkuju", "Děkujeme")} za spolupráci.`;
  if (!step) {
    return view.surgeryDate
      ? `${v("Všechno mám", "Všechno máme")}. Teď od vás nic ${v("nepotřebuju", "nepotřebujeme")}. Uvidíme se ${DAY_MONTH.format(atNoon(view.surgeryDate))}.`
      : `${v("Všechno mám", "Všechno máme")}. Termín zákroku vám ${v("dám", "dáme")} vědět.`;
  }
  switch (step.kind) {
    case "pbm":
      // Úkol na odběr vzniká i jen kvůli chybějícímu nebo starému Hb, takže bez slibu léčby („posílit“).
      return `${v("Potřebuju", "Potřebujeme")} od vás aktuální výsledek krve. Zajděte prosím k praktikovi na odběr a výsledek ${v("mi", "nám")} vyfoťte.`;
    case "report":
      // Sloveso se shoduje s počtem: zbývají 2 až 4 podklady, zbývá 5 a víc podkladů.
      return step.count > 1
        ? `Ještě vám ${step.count <= 4 ? "zbývají" : "zbývá"} ${step.count} ${documentsWord(step.count)} k dodání. Je jedno, který získáte dřív. Každý stačí vyfotit.`
        : `Ještě vám zbývá dodat jeden podklad: ${step.title}. Až ho budete mít, vyfoťte ho, zabere to asi dvě minuty.`;
    case "consent":
      return "Přečtěte si prosím, co vás čeká, a podepište souhlas s anestezií. Zabere to asi pět minut.";
    case "airway":
      return `Ukažte ${v("mi", "nám")} prosím pusu. Jedna fotka, zabere to asi minutu.`;
    case "other":
      return [step.title, step.note].filter(Boolean).join(". ");
  }
}

// Co přesně má pacient udělat nebo přinést: ve zprávě tučně a podbarvené jako zvýrazňovačem.
// Barevný text by se četl hůř, korál se proto dává jen pod písmo.
const keyPhrase = (step: Step | null): string | null => {
  switch (step?.kind) {
    case "pbm":
      return "aktuální výsledek krve";
    case "report":
      return step.count > 1 ? null : step.title;
    case "consent":
      return "souhlas s anestezií";
    case "airway":
      return "pusu";
    default:
      return null;
  }
};

function Highlighted({ text, phrase }: { text: string; phrase: string | null }) {
  const at = phrase ? text.indexOf(phrase) : -1;
  if (!phrase || at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark className="bg-transparent bg-linear-to-b from-transparent from-55% to-highlight to-55% font-semibold text-inherit">{phrase}</mark>
      {text.slice(at + phrase.length)}
    </>
  );
}

export function RadioMessage({
  step,
  view,
  contact,
  more,
}: {
  step: Step | null;
  view: PatientCaseView;
  contact: Contact;
  /** odkaz na podrobnější zobrazení, jen v jednoduchém */
  more?: React.ReactNode;
  /** „Nemám ho“ u chybějícího papíru: otevře, kde ho získat a do kdy */
  onNotHave?: (neededId: string) => void;
}) {
  contact = personOf(contact);
  const phone = contact?.phone?.replace(/\s+/g, "");
  const days = view.daysToCase;
  const detail = step?.kind === "pbm" || step?.kind === "report" ? step.detail : undefined;
  return (
    <section className="flex flex-col gap-8" aria-label="Zpráva z ambulance">
      {view.surgeryDate && days !== null && days >= 0 && (
        <p className="flex items-center gap-2 text-lg text-muted-foreground">
          <CalendarIcon className="size-6 text-foreground" />
          Zákrok {LONG_DATE.format(atNoon(view.surgeryDate))} · {days === 0 ? "dnes" : `za ${days} ${daysWord(days)}`}
        </p>
      )}
      <div className="flex flex-col gap-4">
        {/* Bez jména: oslovení by chtělo 5. pád (Leoši, Jano), ten spolehlivě skloňovat neumíme. */}
        <p className="text-xl text-muted-foreground">Dobrý den,</p>
        <p className="max-w-[22ch] text-3xl leading-snug font-medium tracking-tight text-balance sm:text-4xl"><Highlighted text={messageText(step, view, !!contact)} phrase={keyPhrase(step)} /></p>
        {/* Co v dokumentu má být, jak to napsala ambulance: pacient to ukáže svému lékaři. */}
        {detail && <p className="max-w-prose text-xl leading-snug">{detail}</p>}
        <p className="text-lg text-muted-foreground">{signature(contact)}</p>
      </div>
      {step && (
        <Link
          href={step.href}
          className="press flex min-h-16 w-full max-w-sm items-center justify-center gap-3 rounded-full bg-primary px-8 text-xl font-semibold text-primary-foreground outline-none select-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {step.kind === "pbm" || step.kind === "report" ? (
            <UploadLabel phone={step.label} computer={step.label.replace("Vyfotit", "Nahrát")} iconClassName="size-6" />
          ) : (
            <>
              <StepIcon kind={step.kind} />
              {step.label}
            </>
          )}
        </Link>
      )}
      <div className="flex flex-col gap-3">
        {phone && contact && (
          <a href={`tel:${phone}`} className={LINK}>
            <PhoneIcon className="size-6" />
            <span className={LINK_TEXT}>Zavolat {contact.phone}</span>
          </a>
        )}
        <InviteHelper />
        {more}
      </div>
    </section>
  );
}

// Pečující dělá logistiku a často je sám senior. Pacient ho pozve jako pomocníka z rodiny
// (/patient/pomocnik): ten má vlastní přístup a nepotřebuje pacientovy přihlašovací údaje.
// Pomocník sám další pomocníky nezve, tlačítko nevidí.
function InviteHelper() {
  const { role } = useSession();
  if (role !== "patient") return null;
  return (
    <Link href="/patient/pomocnik" className={LINK}>
      <FamilyIcon className="size-6" />
      <span className={LINK_TEXT}>Pozvat pomocníka z rodiny</span>
    </Link>
  );
}

function StepIcon({ kind }: { kind: Step["kind"] }) {
  const Glyph = STEP_ICON[kind];
  return Glyph ? <Glyph className="size-6" /> : null;
}

const signature = (contact: Contact) => (contact ? `${contact.displayName}, anesteziologická ambulance VFN` : "Vaše anesteziologická ambulance VFN");

// Odpověď z rádia hned po splněném kroku: potvrzení stejným hlasem a rovnou další krok.
// Lidé se po odeslání ptají „došlo to?“; tady to člověk z ambulance potvrdí a řekne, co dál.
export function RadioReply({ secondary }: { secondary?: React.ReactNode }) {
  const { caseId, view, tasks, refresh } = usePatientCase();
  const { role } = useSession();
  // Další krok až z čerstvých dat: jinak by na chvíli chtěl přesně to, co pacient právě poslal.
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    void refresh().finally(() => setFresh(true));
  }, [refresh]);
  const { next } = patientPlan(caseId, view, tasks, role === "helper");
  const contact = personOf(view.contact);
  const person = !!contact;
  // Jedna kostra pro oba stavy: „Předáno“ se po načtení dat nepřekreslí a čára se nekreslí dvakrát.
  return (
    <section className="flex flex-col gap-6" aria-live="polite" aria-label="Odpověď z ambulance">
      <div className="flex flex-col gap-3">
        <HandedOver person={person} />
        {fresh && <p className="max-w-[26ch] text-xl leading-snug text-balance">{messageText(next, view, person)}</p>}
        <p className="text-base text-muted-foreground">{signature(contact)}</p>
      </div>
      {fresh && (
        <div className="flex flex-col gap-3">
          {next ? (
            <Link
              href={next.href}
              className="press flex h-14 w-full max-w-sm items-center justify-center rounded-full bg-primary px-8 text-lg font-semibold text-primary-foreground outline-none select-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {next.label}
            </Link>
          ) : null}
          <div className="flex flex-wrap gap-x-6 gap-y-3 text-base">
            <Link href="/patient" className="underline decoration-brand-dot decoration-2 underline-offset-4 hover:text-muted-foreground">
              {next ? "Udělám to později" : "Zpět na přípravu"}
            </Link>
            {secondary}
          </div>
        </div>
      )}
    </section>
  );
}

// „Předáno“ s fotkou předávky kolíku: papír přešel z ruky pacienta k ambulanci. Fotka je malá,
// aby další krok zůstal na telefonu bez posouvání. Úder EKG pod větou je jen ozdoba.
function HandedOver({ person }: { person: boolean }) {
  return (
    <div className="flex items-center gap-4">
      <Image src="/brand/predavka-ruce.webp" alt="" width={480} height={480} sizes="4rem" className="size-16 shrink-0 rounded-xl object-cover" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-2xl font-semibold tracking-tight">{person ? "Předáno. Mám to, díky." : "Předáno. Máme to, díky."}</p>
        <RelayLine blip className="w-36" />
      </div>
    </div>
  );
}

/** Chyba bez viny: co se stalo, že to nevadí a co teď. Senioři při chybě viní sebe (NN/g). */
export const BLAMELESS = {
  send: "Nepovedlo se to odeslat. Nic jste nezkazili, zkuste to prosím znovu za chvilku.",
  empty: "Nic se nenahrálo, to se stává. Zkuste to prosím znovu.",
} as const;
