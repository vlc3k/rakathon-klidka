"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { PatientCaseView } from "@/lib/api/types";
import { VoiceMessage } from "@/app/components/patient/VoiceMessage";
import { UploadLabel } from "@/app/components/patient/UploadLabel";
import type { Needed, Row } from "@/app/components/patient/plan";
import { visitIcon, type Visit } from "@/app/components/shared/VisitList";
import { DoneIcon, DropIcon, EyeIcon, MouthIcon, PhoneIcon, ReportIcon, SignIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { cn } from "@/lib/utils";

// Co od pacienta potřebujeme, jako barevné karty pod sebou (rules/design.md, „Stavy“): oranžová = ještě chybí,
// zelená = hotovo. Stav nese barva celé karty, ikona a slovo („Objednat do…“, „Nahráno 12. 10.“), žádné štítky.
// Papír od lékaře má tlačítko na nahrání (na telefonu „Vyfotit“, na počítači „Nahrát“), nahraný „Zobrazit“.
// Úkol v appce (souhlas, fotka úst) má tlačítko na svou stránku. Hotové karty jsou vždy na konci.
// Na telefonu je tlačítko pod textem (text má celou šířku), od `sm:` vpravo.

type Icon = (props: { className?: string }) => React.ReactNode;

export type TodoCard = {
  id: string;
  title: string;
  done: boolean;
  icon: Icon;
  /** co v papíru má být, jak to napsala ambulance (pacient to ukáže lékaři) */
  detail?: string;
  /** termín nebo kdy je hotovo */
  status?: string;
  /** termín už běží: tučně */
  urgent?: boolean;
  /** „Kde ho seženu?“: rozbalí, kde papír získat, a možnost se ozvat */
  where?: { label: string; text: string };
  action?: { kind: "upload"; href: string } | { kind: "view"; documentId: string } | { kind: "link"; href: string; label: string; icon: Icon };
};

const DAY_MONTH = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "long", timeZone: "Europe/Prague" });

function deadlineText(item: Needed) {
  if (item.deadline === "asap") return item.book ? "Objednejte se co nejdřív" : "Co nejdřív";
  if (!item.deadline) return undefined;
  const date = DAY_MONTH.format(new Date(`${item.deadline}T12:00:00Z`));
  return item.book ? `Objednat do ${date}` : `Do ${date}`;
}

// Papíry od lékařů: chybějící (už seřazené, odběr první a pak podle termínu), za nimi nahrané.
export function documentCards(needed: Needed[], visits: Visit[]): TodoCard[] {
  const missing = needed.map(
    (item): TodoCard => ({
      id: item.id,
      title: item.title,
      done: false,
      icon: item.kind === "pbm" ? DropIcon : visitIcon(item.documentType),
      detail: item.detail,
      status: deadlineText(item),
      urgent: item.deadline === "asap",
      where: { label: item.kind === "pbm" ? "Kam na odběr?" : "Kde ho seženu?", text: item.where },
      action: { kind: "upload", href: item.href },
    }),
  );
  const uploaded = visits
    .filter((visit) => visit.done)
    .map(
      (visit): TodoCard => ({
        id: visit.id,
        title: visit.title,
        done: true,
        icon: DoneIcon,
        status: visit.uploadedAt ? `Nahráno ${visit.uploadedAt}` : "Hotovo",
        action: visit.documentId ? { kind: "view", documentId: visit.documentId } : undefined,
      }),
    );
  return [...missing, ...uploaded];
}

const ROW_ICON: Record<NonNullable<Row["kind"]>, Icon> = { consent: SignIcon, airway: MouthIcon };

// Úkoly v appce. Otevřený s odkazem má tlačítko, hotový jen zelenou kartu s datem.
export function taskCards(rows: Row[]): TodoCard[] {
  return rows.map((row) => {
    const icon = row.done ? DoneIcon : row.kind ? ROW_ICON[row.kind] : ReportIcon;
    const action = !row.done && row.action ? { kind: "link" as const, href: row.action.href, label: row.action.label, icon } : undefined;
    return { id: row.id, title: row.title, done: row.done, icon, detail: row.note, status: row.detail, action };
  });
}

export function TodoCards({ cards, contact, onView }: { cards: TodoCard[]; contact: PatientCaseView["contact"]; onView: (documentId: string, title: string) => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const sorted = [...cards].sort((a, b) => Number(a.done) - Number(b.done));
  return (
    <ul className="flex flex-col gap-3">
      {sorted.map((card) => (
        <Card key={card.id} card={card} contact={contact} open={openId === card.id} onToggle={() => setOpenId(openId === card.id ? null : card.id)} onView={onView} />
      ))}
    </ul>
  );
}

const BUTTON = "press flex h-12 w-fit shrink-0 items-center gap-2 rounded-full px-5 text-base font-semibold outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const TODO_BUTTON = cn(BUTTON, "bg-status-todo-foreground text-status-todo hover:bg-status-todo-foreground/90");

function Card({
  card,
  contact,
  open,
  onToggle,
  onView,
}: {
  card: TodoCard;
  contact: PatientCaseView["contact"];
  open: boolean;
  onToggle: () => void;
  onView: (documentId: string, title: string) => void;
}) {
  const { icon: Icon, action } = card;
  return (
    <li
      className={cn(
        "flex flex-col gap-4 rounded-2xl py-4 pr-4 pl-5 sm:flex-row sm:items-start sm:gap-6",
        card.done ? "bg-status-done text-status-done-foreground" : "bg-status-todo text-status-todo-foreground",
      )}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <Icon className="mt-0.5 size-6 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="text-xl leading-snug font-semibold wrap-anywhere">{card.title}</h3>
          {card.detail && <p className="max-w-prose text-lg">{card.detail}</p>}
          {card.status && <p className={cn("text-lg", card.urgent && "font-semibold")}>{card.status}</p>}
          {card.where && (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              className="-ml-1 inline-flex min-h-11 w-fit items-center gap-1 rounded-lg px-1 text-lg font-medium underline underline-offset-4 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {card.where.label}
              <ChevronDown className={cn("size-5 transition-transform motion-safe:ease-smooth", open && "rotate-180")} />
            </button>
          )}
          {open && card.where && <Where text={card.where.text} contact={contact} />}
        </div>
      </div>
      {action && (
        <div className="pl-9 sm:pl-0">
          {action.kind === "upload" && (
            <Link href={action.href} aria-label={`Vyfotit nebo nahrát: ${card.title}`} className={TODO_BUTTON}>
              <UploadLabel phone="Vyfotit" computer="Nahrát" />
            </Link>
          )}
          {action.kind === "link" && (
            <Link href={action.href} className={TODO_BUTTON}>
              <action.icon className="size-5 shrink-0" />
              {action.label}
            </Link>
          )}
          {action.kind === "view" && (
            <button
              type="button"
              onClick={() => onView(action.documentId, card.title)}
              aria-label={`Zobrazit: ${card.title}`}
              className={cn(BUTTON, "bg-background/70 text-status-done-foreground hover:bg-background")}
            >
              <EyeIcon className="size-5 shrink-0" />
              Zobrazit
            </button>
          )}
        </div>
      )}
    </li>
  );
}

// Kde papír sehnat, a když to pacient nestihne nebo neví: namluvit zprávu nebo zavolat do ambulance.
function Where({ text, contact }: { text: string; contact: PatientCaseView["contact"] }) {
  const phone = contact?.phone?.replace(/\s+/g, "");
  return (
    <div className="mt-2 flex flex-col gap-4 rounded-xl bg-background p-4 text-foreground sm:p-5">
      <p className="text-lg font-medium">{text}</p>
      <div className="flex flex-col gap-3">
        <p className="text-base text-muted-foreground">Nestihnete to nebo si nevíte rady? Řekněte nám to, domluvíme se.</p>
        <div className="flex flex-wrap items-start gap-2">
          <VoiceMessage variant="button" />
          {phone && (
            <a
              href={`tel:${phone}`}
              aria-label={`Zavolat do ambulance, ${contact?.phone}`}
              className="press flex h-12 w-fit items-center gap-2 rounded-full bg-muted px-5 text-base font-semibold outline-none select-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <PhoneIcon className="size-5 shrink-0" />
              Zavolat do ambulance
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
