"use client";

import { useState } from "react";
import { Check, Loader2, RotateCcw } from "lucide-react";
import { DoneIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { useCaseLocked } from "@/app/components/shared/CaseLock";
import { useSession } from "@/app/components/shared/Session";
import { api } from "@/lib/api/client";
import { revalidate } from "@/lib/api/useApi";
import type { Verification } from "@/lib/caseView";
import { formatDateTime } from "@/lib/date";
import { cn } from "@/lib/utils";

// Potvrzení údaje, který vytěžila AI, proti originálu (POST information/verify). Ponese jméno toho, kdo potvrdil.
// Chybu vyhodí, ať ji volající ukáže u svého seznamu.
export async function verifyInformation(caseId: string, ids: string[]) {
  await api.post(`/api/v1/cases/${caseId}/information/verify`, { ids });
  await revalidate(`/api/v1/cases/${caseId}`, "/api/v1/queue");
}

// Odvolání potvrzení: hodnoty se vrátí mezi nepotvrzené nálezy AI (POST information/unverify).
export async function unverifyInformation(caseId: string, ids: string[]) {
  await api.post(`/api/v1/cases/${caseId}/information/unverify`, { ids });
  await revalidate(`/api/v1/cases/${caseId}`, "/api/v1/queue");
}

// Potvrzení a jeho odvolání, vždy přes potvrzovací dialog. `what` je údaj ve 4. pádě pro text dialogu.
// - pill (detail zákroku): „Potvrdit“ → „✓ Potvrzeno“, na hover se z něj stane „↺ Odvolat“.
// - check (husté seznamy, stránka dokumentu): kulaté kolečko jako na iPhonu, prázdné → zelené s fajfkou,
//   na hover u potvrzeného šipka zpět.
// Odvolání je červené tlačítko a dialog říká, kdo a kdy potvrdil. Bez `onRevoke` jde jen potvrdit.
// Než se změna uloží, točí se spinner (`saving` zvenku, třeba při „Potvrdit vše“).
export function VerifyButton({
  what,
  verified,
  onConfirm,
  onRevoke,
  variant = "pill",
  saving = false,
}: {
  what: string;
  verified: Verification | null;
  onConfirm: () => Promise<void>;
  onRevoke?: () => Promise<void>;
  variant?: "pill" | "check";
  saving?: boolean;
}) {
  const session = useSession();
  const locked = useCaseLocked();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const busy = running || saving;
  const who = verified ? (verified.verifiedBy === session.id ? "vámi" : "v ambulanci") : "";
  const when = verified?.verifiedAt ? ` ${formatDateTime(verified.verifiedAt)}` : "";
  const revocable = Boolean(verified && onRevoke && !locked);

  const run = async (action: () => Promise<void>) => {
    setRunning(true);
    try {
      await action();
    } finally {
      setRunning(false);
    }
  };

  const dialog = verified ? (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title="Odvolat potvrzení?"
      description={`${what.charAt(0).toUpperCase()}${what.slice(1)} potvrzeno ${who}${when}. Hodnota se vrátí mezi nepotvrzené nálezy AI.`}
      confirmLabel="Odvolat potvrzení"
      destructive
      onConfirm={() => onRevoke && void run(onRevoke)}
    />
  ) : (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title={`Potvrdit ${what}?`}
      description="Porovnali jste údaj s originálem? Potvrzení ponese vaše jméno."
      confirmLabel="Potvrdit"
      onConfirm={() => void run(onConfirm)}
    />
  );

  // Uzavřený zákrok: nepotvrzený údaj už nejde potvrdit, jen je vidět, že potvrzený nebyl.
  if (locked && !verified) {
    return variant === "check" ? (
      <span role="img" aria-label="Nepotvrzeno" title="Nepotvrzeno, zákrok je uzavřený" className="flex size-11 shrink-0 items-center justify-center">
        <span className="size-7 rounded-full border-2 border-dashed border-foreground/20" />
      </span>
    ) : (
      <span className="flex h-11 shrink-0 items-center px-3 text-sm text-muted-foreground">Nepotvrzeno</span>
    );
  }

  if (variant === "check") {
    if (busy) {
      return (
        <span role="status" aria-label="Ukládám" className="flex size-11 shrink-0 items-center justify-center">
          <Loader2 className="size-6 text-muted-foreground motion-safe:animate-spin" />
        </span>
      );
    }
    if (verified && !revocable) {
      return (
        <span role="img" aria-label={`Potvrzeno ${who}${when}`} title={`Potvrzeno ${who}${when}`} className="flex size-11 shrink-0 items-center justify-center">
          <span className="flex size-7 items-center justify-center rounded-full bg-status-done-accent text-white">
            <Check className="size-4" strokeWidth={3} />
          </span>
        </span>
      );
    }
    return (
      <>
        <button
          type="button"
          disabled={busy}
          onClick={() => setOpen(true)}
          aria-label={verified ? `Potvrzeno ${who}${when}. Odvolat potvrzení: ${what}` : `Potvrdit ${what}`}
          title={verified ? `Potvrzeno ${who}${when} · klepnutím odvoláte` : "Potvrdit"}
          className="group press flex size-11 shrink-0 items-center justify-center rounded-full outline-none select-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          {verified ? (
            <span className="flex size-7 items-center justify-center rounded-full bg-status-done-accent text-white transition-colors motion-safe:ease-smooth group-hover:bg-destructive/10 group-hover:text-destructive">
              <Check className="size-4 group-hover:hidden" strokeWidth={3} />
              <RotateCcw className="hidden size-4 group-hover:block" strokeWidth={2.5} />
            </span>
          ) : (
            <span className="flex size-7 items-center justify-center rounded-full border-2 border-foreground/20 text-transparent transition-colors motion-safe:ease-smooth group-hover:border-status-done-accent group-hover:text-status-done-accent">
              <Check className="size-4" strokeWidth={3} />
            </span>
          )}
        </button>
        {dialog}
      </>
    );
  }

  if (verified) {
    return (
      <>
        <button
          type="button"
          disabled={busy || !revocable}
          onClick={() => setOpen(true)}
          title={`Potvrzeno ${who}${when}`}
          aria-label={revocable ? `Potvrzeno ${who}${when}. Odvolat potvrzení: ${what}` : `Potvrzeno ${who}${when}`}
          className={cn(
            "group press flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium whitespace-nowrap text-green-700 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
            revocable && "hover:bg-destructive/10 hover:text-destructive",
          )}
        >
          {busy ? (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="size-4 motion-safe:animate-spin" />
              Ukládám…
            </span>
          ) : (
            <>
              <DoneIcon className={cn("size-4", revocable && "group-hover:hidden")} />
              <span className={cn(revocable && "group-hover:hidden")}>Potvrzeno</span>
            </>
          )}
          {revocable && !busy && (
            <>
              <RotateCcw className="hidden size-4 group-hover:block" />
              <span className="hidden group-hover:inline">Odvolat</span>
            </>
          )}
        </button>
        {revocable && dialog}
      </>
    );
  }
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen(true)}
        className="press flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-muted px-4 text-sm font-medium outline-none select-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        {busy && <Loader2 className="size-4 motion-safe:animate-spin" />}
        {busy ? "Ukládám…" : "Potvrdit"}
      </button>
      {dialog}
    </>
  );
}

// „Potvrdit vše“ v hlavičce karty: jedním potvrzením všechny ještě nepotvrzené položky karty (s dialogem).
// Během ukládání spinner; `onSavingChange` ať karta točí i kolečka položek, které se potvrzují.
export function ConfirmAllButton({
  count,
  card,
  onConfirm,
  onSavingChange,
}: {
  count: number;
  // Název karty pro dialog („Laboratoř“).
  card: string;
  onConfirm: () => Promise<void>;
  onSavingChange?: (saving: boolean) => void;
}) {
  const locked = useCaseLocked();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  if (locked) return null;
  const save = async () => {
    setSaving(true);
    onSavingChange?.(true);
    try {
      await onConfirm();
    } finally {
      setSaving(false);
      onSavingChange?.(false);
    }
  };
  return (
    <>
      <button
        type="button"
        disabled={saving}
        onClick={() => setOpen(true)}
        className="press -mr-2 flex h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-primary outline-none select-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:text-muted-foreground"
      >
        {saving && <Loader2 className="size-4 motion-safe:animate-spin" />}
        {saving ? "Potvrzuji…" : "Potvrdit vše"}
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Potvrdit ${count} ${count < 5 ? "položky" : "položek"}?`}
        description={`Porovnali jste všechno z karty ${card} s originálem? Potvrzení ponese vaše jméno.`}
        confirmLabel="Potvrdit vše"
        onConfirm={() => void save()}
      />
    </>
  );
}
