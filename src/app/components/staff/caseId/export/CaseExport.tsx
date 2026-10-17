"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, Loader2, Lock } from "lucide-react";
import { PrintIcon, ServerIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { PrintSummary } from "@/app/components/staff/detail/PrintSummary";
import { api, errorMessage } from "@/lib/api/client";
import { revalidate } from "@/lib/api/useApi";
import type { CaseDetail } from "@/lib/api/types";
import { formatDateTime } from "@/lib/date";

// Export zákroku: nahoře co s ním (uzavřít → odeslat do nemocnice, vytisknout), pod tím souhrn tak, jak půjde na papír.
// Uzavření jde přes potvrzovací dialog: pak už nejde nic upravovat (hlídá i server). Znovu otevřít jde, kdyby to bylo omylem.
export function CaseExport({ caseId }: { caseId: string }) {
  return <PrintSummary caseId={caseId} toolbar={(detail) => <ExportBar caseId={caseId} detail={detail} />} />;
}

type Sent = { created: number; existing: number; known: number; failed: number };

function ExportBar({ caseId, detail }: { caseId: string; detail: CaseDetail }) {
  const [confirm, setConfirm] = useState<"close" | "reopen" | null>(null);
  const [busy, setBusy] = useState<"close" | "reopen" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const closed = detail.closed;
  const unverified = detail.information.filter((info) => info.status === "ai_extracted").length;
  const closedBy = closed?.by ? detail.people[closed.by]?.displayName : null;

  async function run(kind: "close" | "reopen" | "send", action: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e, "Nepodařilo se to."));
    } finally {
      setBusy(null);
    }
  }

  const setClosed = (close: boolean) =>
    run(close ? "close" : "reopen", async () => {
      await (close ? api.post(`/api/v1/cases/${caseId}/close`) : api.delete(`/api/v1/cases/${caseId}/close`));
      setSent(null);
      await revalidate(`/api/v1/cases/${caseId}`, "/api/v1/queue");
    });

  const send = () =>
    run("send", async () => {
      const result = await api.post<{ sent: Sent }>(`/api/fhir/${caseId}`);
      setSent(result.sent);
    });

  return (
    <div className="flex flex-col gap-5 border-b border-border pb-6">
      <Link href={`/staff/${caseId}`} className="press -ml-1 flex w-fit items-center gap-1 text-base text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-5" /> Zpět na pacienta
      </Link>

      {closed ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Lock className="size-5" /> Uzavřeno
            </h1>
            <p className="text-base text-muted-foreground">
              {formatDateTime(closed.at)}
              {closedBy ? ` · ${closedBy}` : ""}. Údaje už nejde upravovat.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button className="h-12 rounded-full px-6 text-base" disabled={busy !== null} onClick={() => void send()}>
              {busy === "send" ? <Loader2 className="size-4 motion-safe:animate-spin" /> : <ServerIcon className="size-4" />}
              Odeslat do nemocnice
            </Button>
            <Button variant="secondary" className="h-12 rounded-full px-6 text-base" onClick={() => window.print()}>
              <PrintIcon className="size-4" /> Vytisknout
            </Button>
            <Button variant="ghost" className="ml-auto h-11 rounded-full px-4 text-base text-muted-foreground" disabled={busy !== null} onClick={() => setConfirm("reopen")}>
              Znovu otevřít
            </Button>
          </div>
          {sent && (
            <p role="status" className="text-base">
              {sentText(sent)}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Export do dokumentace</h1>
            <p className="max-w-prose text-base text-muted-foreground">
              Zákrok se uzavře a údaje už nepůjde upravovat. Potom ho odešlete do nemocnice a vytisknete.
            </p>
          </div>
          {unverified > 0 && (
            <p className="text-base font-medium text-amber-700">
              {unverified} {unverified === 1 ? "údaj od AI není potvrzený" : unverified < 5 ? "údaje od AI nejsou potvrzené" : "údajů od AI není potvrzených"}, v exportu budou označené.
            </p>
          )}
          <Button className="h-12 w-fit rounded-full px-6 text-base" disabled={busy !== null} onClick={() => setConfirm("close")}>
            {busy === "close" ? <Loader2 className="size-4 motion-safe:animate-spin" /> : <Lock className="size-4" />}
            Uzavřít a exportovat
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-base font-medium text-destructive">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={confirm === "close"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Uzavřít zákrok?"
        description={`Po uzavření už nepůjde upravovat údaje, potvrzovat hodnoty ani vyžadovat dokumenty od pacienta.${
          unverified > 0 ? ` ${unverified} ${unverified === 1 ? "údaj zůstane nepotvrzený" : unverified < 5 ? "údaje zůstanou nepotvrzené" : "údajů zůstane nepotvrzených"}.` : ""
        }`}
        confirmLabel="Uzavřít"
        onConfirm={() => void setClosed(true)}
      />
      <ConfirmDialog
        open={confirm === "reopen"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Znovu otevřít zákrok?"
        description="Údaje půjde zase upravovat. Před tiskem a odesláním ho bude potřeba znovu uzavřít."
        confirmLabel="Znovu otevřít"
        destructive
        onConfirm={() => void setClosed(false)}
      />
    </div>
  );
}

function sentText({ created, existing, known, failed }: Sent) {
  const parts = [
    created ? `zapsáno ${created} ${created === 1 ? "nový údaj" : created < 5 ? "nové údaje" : "nových údajů"}` : null,
    existing + known ? `${existing + known} už tam ${existing + known === 1 ? "byl" : existing + known < 5 ? "byly" : "bylo"}` : null,
    failed ? `${failed} se nepodařilo zapsat` : null,
  ].filter(Boolean);
  return `Odesláno do nemocnice: ${parts.length ? parts.join(", ") : "nebylo co odeslat (žádné potvrzené údaje)"}.`;
}
