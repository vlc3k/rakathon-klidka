"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { DoneIcon, WaitingIcon, WarningIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { AITag } from "@/app/components/shared/AITag";
import { InfoTip } from "@/app/components/shared/InfoTip";
import type { CaseDetail, Task } from "@/lib/api/types";
import { READINESS_TONE, readinessSentence } from "@/app/components/staff/detail/ReadinessCard";
import { caseSummary, type SummaryAnchor, type SummaryItem, type SummaryRow, type SummaryTone } from "@/lib/caseSummary";
import { documentTypeLabel, readinessInput, type CaseProfile } from "@/lib/caseView";
import { readiness } from "@/lib/readiness";
import { useHospitalSnapshots } from "@/lib/hospitalStore";
import { cn } from "@/lib/utils";

const ICON: Record<SummaryTone, React.ReactNode> = {
  ok: <span role="img" aria-label="V pořádku" className="flex"><DoneIcon className="size-5 text-green-600 [--icon-accent:currentColor]" /></span>,
  attention: <span role="img" aria-label="Pozor" className="flex"><WarningIcon className="size-5 text-amber-600" /></span>,
  missing: <span role="img" aria-label="Chybí" className="flex"><WaitingIcon className="size-5 text-muted-foreground" /></span>,
};

// Tlačítko pod rozbaleným řádkem otevře záložku podkladů, kde je víc (časová osa, potvrzení, fotky, podpis).
const MORE_LINK: Record<string, string> = {
  readiness: "Otevřít časovou osu",
  conditions: "Potvrdit údaje ze zpráv",
  meds: "Potvrdit údaje ze zpráv",
  allergies: "Potvrdit údaje ze zpráv",
  hb: "Všechny laboratorní hodnoty",
  airway: "Otevřít fotky a hodnocení",
  consent: "Otevřít podpis a hlasové zprávy",
  documents: "Otevřít dokumenty",
};

type ShowSource = (informationId: string, documentId: string) => void;
type OpenTab = (tab: SummaryAnchor) => void;

// Souhrn pro anesteziologa hned pod hlavičkou: jeden řádek na oblast předoperačního vyšetření, výjimky svítí.
// Klik řádek rozbalí na místě: z čeho vychází, odkud to je a kdy. Stránka nikam neskáče.
export function CaseSummary({
  caseId,
  detail,
  tasks,
  profile,
  onShowSource,
  onOpenTab,
}: {
  caseId: string;
  detail: CaseDetail;
  tasks: Task[];
  profile: CaseProfile;
  onShowSource: ShowSource;
  onOpenTab: OpenTab;
}) {
  const { snapshots } = useHospitalSnapshots(caseId);
  const [open, setOpen] = useState<string | null>(null);
  const unassignedIds = new Set(detail.alerts.filter((a) => a.key.startsWith("document.identity:")).flatMap((a) => a.documentIds));
  // Úkol chtěl jeden druh papíru, AI poznala jiný (pacient vyfotil laboratoř místo EKG). „Jiný dokument“ se nepočítá.
  const wanted = new Map(tasks.filter((t) => t.documentId && t.documentType).map((t) => [t.documentId!, t.documentType!]));
  const mismatchOf = (d: CaseDetail["documents"][number]) => {
    const want = wanted.get(d.id);
    return want && d.type && d.type !== "other" && d.type !== want ? want : null;
  };
  const T = detail.case.daysToCase;
  const r = readiness(readinessInput(T, tasks, detail.hb.status === "alert"));
  const rows = caseSummary({
    readiness: { status: r.status, text: READINESS_TONE[r.status].text, sentence: readinessSentence(r, T) },
    hb: detail.hb,
    hbLabs: profile.labs.filter((l) => l.code === "hemoglobin"),
    anamnesis: profile.anamnesis,
    meds: profile.meds,
    allergies: profile.allergies,
    allergiesNone: profile.allergiesNone,
    airway: { photos: detail.airwayPhotos.length, assessment: detail.airwayAssessment },
    consentSigned: !!detail.activity.consent,
    documents: {
      total: detail.documents.length,
      failed: detail.documents.filter((d) => d.status === "failed").length,
      unassigned: unassignedIds.size,
      mismatched: detail.documents.filter((d) => mismatchOf(d) !== null).length,
      list: detail.documents.map((d) => ({
        id: d.id,
        label: documentTypeLabel(d.type),
        problem:
          d.status === "failed"
            ? "AI nepřečetla"
            : unassignedIds.has(d.id)
              ? "nelze přiřadit pacientovi"
              : mismatchOf(d)
                ? `chtěli jsme ${documentTypeLabel(mismatchOf(d))}`
                : null,
        href: `/staff/${caseId}/documents/${d.id}`,
      })),
    },
    hospital: snapshots[0]?.items ?? null,
  });
  const attention = rows.filter((r) => r.tone === "attention").length;
  const missing = rows.filter((r) => r.tone === "missing").length;

  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-background p-6 lg:p-8" aria-labelledby="souhrn">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="souhrn" className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          Souhrn
          <InfoTip>
            Jeden řádek na každou oblast předoperačního vyšetření. Spojuje zprávy, data z nemocnice a to, co poslal pacient. Nic nedoporučuje, jen
            ukazuje, co v podkladech je a co chybí. Kliknutím na řádek uvidíte, z čeho vychází.
          </InfoTip>
        </h2>
        <p className="text-sm text-muted-foreground">
          {attention === 0 && missing === 0 ? "Vše v pořádku" : [attention > 0 && `${attention}× pozor`, missing > 0 && `${missing}× chybí`].filter(Boolean).join(" · ")}
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {rows.map((row) => (
          <Row key={row.key} row={row} open={open === row.key} onToggle={() => setOpen(open === row.key ? null : row.key)} onShowSource={onShowSource} onOpenTab={onOpenTab} />
        ))}
      </ul>
    </section>
  );
}

function Row({ row, open, onToggle, onShowSource, onOpenTab }: { row: SummaryRow; open: boolean; onToggle: () => void; onShowSource: ShowSource; onOpenTab: OpenTab }) {
  const panelId = `souhrn-${row.key}`;
  return (
    <li className="flex flex-col">
      <div className="flex items-start gap-3 py-3">
        <span className="mt-0.5">{ICON[row.tone]}</span>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="press grid min-w-0 flex-1 gap-x-4 gap-y-0.5 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[9rem_1fr_auto]"
        >
          <span className="text-sm text-muted-foreground">{row.label}</span>
          <span className="flex min-w-0 flex-col">
            <span className={cn("text-base", row.tone === "attention" && "font-semibold", row.tone === "missing" && "text-muted-foreground")}>{row.text}</span>
            {row.more && <span className="text-sm text-muted-foreground">{row.more}</span>}
          </span>
          <ChevronDown className={cn("mt-1 hidden size-4 text-muted-foreground transition-transform sm:block", open && "rotate-180")} aria-hidden />
        </button>
        {row.unverified && (
          <span className="mt-0.5 shrink-0">
            <AITag>Část údajů přečetla AI ze zpráv a nikdo je zatím nepotvrdil.</AITag>
          </span>
        )}
      </div>
      {open && (
        <div id={panelId} className="mb-3 ml-8 flex flex-col gap-1 rounded-xl bg-muted/60 p-3 sm:ml-[calc(2rem+9rem+1rem)]">
          {row.items.length > 0 && (
            <ul className="flex flex-col">
              {row.items.map((item, i) => (
                <Item key={`${item.text}-${i}`} item={item} onShowSource={onShowSource} />
              ))}
            </ul>
          )}
          {row.items.length === 0 && row.tone === "missing" && <p className="text-sm text-muted-foreground">V podkladech zatím nic není.</p>}
          {MORE_LINK[row.key] && (
            <button type="button" onClick={() => onOpenTab(row.anchor)} className="mt-1 w-max text-sm font-medium text-primary underline-offset-4 hover:underline">
              {MORE_LINK[row.key]}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function Item({ item, onShowSource }: { item: SummaryItem; onShowSource: ShowSource }) {
  const meta = [item.source === "dokumenty" ? "zpráva" : item.source, item.date].filter(Boolean).join(" · ");
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5">
      <span className={cn("text-sm", item.warn && "font-semibold text-amber-700")}>{item.text}</span>
      <span className="flex items-baseline gap-3 text-xs text-muted-foreground">
        {meta}
        {item.informationId && item.documentId && (
          <button type="button" onClick={() => onShowSource(item.informationId!, item.documentId!)} className="font-medium text-primary underline-offset-4 hover:underline">
            Ukázat ve zprávě
          </button>
        )}
        {item.href && (
          <Link href={item.href} className="font-medium text-primary underline-offset-4 hover:underline">
            Otevřít
          </Link>
        )}
      </span>
    </li>
  );
}
