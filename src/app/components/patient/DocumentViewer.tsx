"use client";

import { useState } from "react";
import { Loader } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { SmoothImage } from "@/app/components/shared/LoadingStates";
import { documentUrl } from "@/lib/api/client";

// Nahraný papír v okně přímo v aplikaci (ne v nové záložce). Svůj papír jde odstranit, např. když se fotka
// nepovedla: server pustí jen to, co pacient nahrál sám, a jen dokud s ním nepracovala ambulance.
export function DocumentViewer({
  caseId,
  documentId,
  title,
  canRemove,
  onClose,
  onRemoved,
}: {
  caseId: string;
  documentId: string;
  title: string;
  canRemove: boolean;
  onClose: () => void;
  onRemoved: () => Promise<void> | void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/cases/${caseId}/documents/${documentId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Podklad se nepodařilo odstranit.");
      // Okno zavře až obnovený přehled, ať smazaný papír v seznamu chvíli nevisí.
      await onRemoved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Podklad se nepodařilo odstranit.");
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-full w-full max-w-lg flex-col gap-4 overflow-hidden rounded-3xl bg-background p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="px-2 pt-1 text-lg font-semibold tracking-tight">{title}</h2>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl bg-muted">
          <SmoothImage src={documentUrl(caseId, documentId)} alt={title} className="w-full" imgClassName="w-full" placeholderClassName="aspect-3/4" />
        </div>
        {error && (
          <p role="alert" className="px-2 text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {canRemove && (
            <Button variant="ghost" className="h-11 rounded-full px-5 text-base text-destructive hover:text-destructive" disabled={busy} onClick={() => setConfirm(true)}>
              {busy && <Loader className="size-4 motion-safe:animate-spin" />}
              Odstranit
            </Button>
          )}
          <Button variant="secondary" className="h-11 rounded-full px-5 text-base" onClick={onClose}>
            Zavřít
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Odstranit podklad?"
        description="Ambulance ho pak neuvidí. Když jde o nepovedenou fotku, vyfoťte ho znovu."
        confirmLabel="Odstranit"
        destructive
        onConfirm={() => void remove()}
      />
    </div>
  );
}
