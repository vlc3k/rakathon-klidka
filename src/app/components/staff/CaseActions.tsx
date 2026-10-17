"use client";

import { useState } from "react";
import { ClockIcon, DoneIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { DocumentRequestForm } from "@/app/components/staff/detail/DocumentRequestForm";
import { api, errorMessage } from "@/lib/api/client";
import { revalidate } from "@/lib/api/useApi";
import type { CaseDetail, QueueRow, Task } from "@/lib/api/types";
import { pbmTask, requestDetail } from "@/lib/caseView";
import { formatDate } from "@/lib/date";

// Další krok ve frontě (nextStep z API).
export const NEXT_STEP_LABEL: Record<NonNullable<QueueRow["nextStep"]>, string> = {
  assess_pbm: "Vyžádat výsledky",
  request_hb: "Vyžádat výsledky",
  verify: "Ověřit",
  await_lab: "Čeká na výsledky",
};

// Jedno upozornění na pacienta, s jednou akcí. Systém navrhne, člověk potvrdí. Léčbu nenavrhuje.
export function CaseActions({ detail, tasks }: { detail: CaseDetail; tasks: Task[] }) {
  const { hb } = detail;
  const caseId = detail.case.id;
  const running = pbmTask(tasks);
  const alert = hb.status === "alert";

  if (running) {
    const detail = requestDetail(running);
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">Další krok</span>
          <h2 className="text-2xl font-semibold tracking-tight">{alert ? "Časné PBM posouzení" : "Vyžádat aktuální hemoglobin"}</h2>
          <p className="max-w-prose text-base text-muted-foreground">{hb.info}</p>
        </div>
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-sm font-medium text-blue-700">
            <ClockIcon className="size-4" /> Vyžádáno {formatDate(running.createdAt)} · {running.status === "submitted" ? "pacient nahrál" : "čeká na pacienta"}
          </p>
          {detail && <p className="max-w-prose text-sm text-muted-foreground">{detail}</p>}
        </div>
      </div>
    );
  }

  if (hb.status === "ok") {
    return <p className="text-base text-muted-foreground">{hb.info} Bez upozornění.</p>;
  }

  if (hb.status === "uncertain" && hb.reason === "identity") {
    return (
      <Step title="Patří tenhle dokument pacientovi?" info={hb.info}>
        <p className="text-sm text-muted-foreground">Porovnejte jméno a rodné číslo na originálu v sekci Dokumenty.</p>
      </Step>
    );
  }

  if (hb.status === "uncertain" && hb.reason === "checks" && hb.informationId) {
    return <VerifyHb caseId={caseId} informationId={hb.informationId} value={hb.value} info={hb.info} />;
  }

  // Pozor (anémie), Doplnit (chybí nebo je starý) a Nejisté bez data odběru nebo s neznámou jednotkou: nové výsledky krve.
  return <RequestLab caseId={caseId} alert={alert} info={hb.info} />;
}

function Step({ title, info, children }: { title: string; info: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">Další krok</span>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="max-w-prose text-base text-muted-foreground">{info}</p>
      </div>
      {children}
    </div>
  );
}

const refresh = (caseId: string) => revalidate(`/api/v1/cases/${caseId}`, "/api/v1/queue");

// Hodnota neprošla kontrolou čtení: člověk ji porovná s dokumentem a potvrdí, nebo zamítne.
function VerifyHb({ caseId, informationId, value, info }: { caseId: string; informationId: string; value: number | null; info: string }) {
  const [dialog, setDialog] = useState<"verify" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: "verify" | "reject") {
    setBusy(true);
    setError(null);
    try {
      if (action === "verify") await api.post(`/api/v1/cases/${caseId}/information/verify`, { ids: [informationId] });
      else await api.post(`/api/v1/cases/${caseId}/information/${informationId}/reject`, { note: "Hodnota nesedí s dokumentem." });
      await refresh(caseId);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Step title="Ověřit hemoglobin" info={info}>
      <div className="flex flex-wrap gap-2">
        <Button className="h-12 rounded-full px-8" disabled={busy} onClick={() => setDialog("verify")}>
          Sedí s dokumentem
        </Button>
        <Button variant="secondary" className="h-12 rounded-full px-8" disabled={busy} onClick={() => setDialog("reject")}>
          Nesedí
        </Button>
      </div>
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
      <ConfirmDialog
        open={dialog === "verify"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={`Potvrdit hemoglobin${value !== null ? ` ${value} g/l` : ""}?`}
        description="Porovnali jste hodnotu s originálem? Potvrzení ponese vaše jméno a hodnota se započítá do PBM pravidla."
        confirmLabel="Potvrdit"
        onConfirm={() => run("verify")}
      />
      <ConfirmDialog
        open={dialog === "reject"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Hodnota nesedí s dokumentem?"
        description="Hodnota se vyřadí a do PBM pravidla se nezapočítá."
        confirmLabel="Vyřadit hodnotu"
        destructive
        onConfirm={() => run("reject")}
      />
    </Step>
  );
}

// Výsledky krve kvůli Hb: stejné vyžádání dokumentu jako v záložce Dokumenty, jen předvyplněné. Žádanku nevystavujeme,
// pacient si odběr domluví u svého lékaře a výsledek nahraje.
const SUGGESTED_TESTS = (alert: boolean) => (alert ? ["krevní obraz", "ferritin", "saturace transferinu"] : ["krevní obraz"]);

function RequestLab({ caseId, alert, info }: { caseId: string; alert: boolean; info: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Step title={alert ? "Časné PBM posouzení" : "Vyžádat aktuální hemoglobin"} info={info}>
      {open ? (
        <DocumentRequestForm caseId={caseId} type="lab_report" tests={SUGGESTED_TESTS(alert)} pbm onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />
      ) : (
        <Button className="h-12 w-full rounded-full text-base sm:w-max sm:px-8" onClick={() => setOpen(true)}>
          Vyžádat laboratorní výsledky
        </Button>
      )}
    </Step>
  );
}

// Stav procesu vedle stavu údaje (Hb může zůstat Pozor a výsledky krve jsou už vyžádané).
export function ProcessBadge({ running }: { running: boolean }) {
  if (!running) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap">
      <ClockIcon className="size-4 text-blue-600" />
      Čeká na výsledky
    </span>
  );
}

export function Done({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 text-sm font-medium text-green-700">
      <DoneIcon className="size-4" /> {text}
    </p>
  );
}
