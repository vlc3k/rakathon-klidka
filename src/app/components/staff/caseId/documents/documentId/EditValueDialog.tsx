"use client";

import { useState } from "react";
import { Loader } from "lucide-react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { TextField } from "@/app/components/shared/TextField";
import { api, errorMessage } from "@/lib/api/client";
import { revalidate } from "@/lib/api/useApi";
import type { Information } from "@/lib/api/types";

// Ruční oprava údaje, který AI přečetla špatně. Pole podle tvaru hodnoty (laboratoř: hodnota, jednotka, norma;
// lék: název, síla, dávkování; alergie, diagnóza…), k tomu datum. Uložení = POST information/:id/reject
// s opravou: původní hodnota se zamítne a opravená vznikne rovnou jako ověřená lékařem, svázaná se stejným
// dokumentem a místem na fotce. Příznak mimo normu (L/H) se u laboratoře dopočítá z nové hodnoty a mezí.

const LABELS: Record<string, string> = {
  value: "Hodnota",
  unit: "Jednotka",
  refLow: "Norma od",
  refHigh: "Norma do",
  referenceRange: "Norma (text)",
  name: "Název",
  strength: "Síla",
  dose: "Dávkování",
  reason: "Důvod",
  substance: "Látka",
  reaction: "Reakce",
  text: "Text",
  icd10: "MKN-10",
  year: "Rok",
};
const ORDER = Object.keys(LABELS);
// Pole, která se neupravují (odvozená nebo „nemám žádné“).
const SKIP = new Set(["flag", "none"]);

type Value = Record<string, unknown>;

export function EditValueDialog({
  caseId,
  info,
  label,
  open,
  onOpenChange,
}: {
  caseId: string;
  info: Information;
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const original = (info.value ?? {}) as Value;
  const keys = Object.keys(original)
    .filter((key) => !SKIP.has(key) && (typeof original[key] === "string" || typeof original[key] === "number" || original[key] === null))
    .sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  // Laboratoř: hodnota je číslo a jdou doplnit meze, i když v dokumentu nebyly. Váha a výška ne (jiný tvar hodnoty).
  const lab = info.area === "labs" && typeof original.value === "number";
  if (lab) for (const key of ["unit", "refLow", "refHigh"]) if (!keys.includes(key)) keys.push(key);
  const numeric = (key: string) => ((lab || typeof original.value === "number") && (key === "value" || key === "refLow" || key === "refHigh")) || key === "year";

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value: Value = { ...original };
    for (const key of keys) {
      const raw = String(form.get(key) ?? "").trim().replace(",", ".");
      if (!raw) {
        if (key === "value") return setError("Vyplňte hodnotu.");
        delete value[key];
        continue;
      }
      if (numeric(key)) {
        const n = Number(raw);
        if (!Number.isFinite(n)) return setError(`${LABELS[key] ?? key}: zadejte číslo.`);
        value[key] = n;
      } else {
        value[key] = String(form.get(key)).trim();
      }
    }
    if (lab) {
      const v = value.value as number;
      const low = typeof value.refLow === "number" ? value.refLow : null;
      const high = typeof value.refHigh === "number" ? value.refHigh : null;
      value.flag = low !== null && v < low ? "L" : high !== null && v > high ? "H" : null;
    }
    const observedDate = String(form.get("observedDate") ?? "").trim() || null;

    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/v1/cases/${caseId}/information/${info.id}/reject`, { correction: { value, observedDate } });
      revalidate(`/api/v1/cases/${caseId}`);
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const display = (key: string) => {
    const v = original[key];
    return v === null || v === undefined ? "" : String(v).replace(".", numeric(key) ? "," : ".");
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="gap-6 rounded-2xl p-6 sm:max-w-md">
        <AlertDialogHeader className="gap-2">
          <AlertDialogTitle className="text-xl font-semibold tracking-tight">Opravit: {label}</AlertDialogTitle>
          <AlertDialogDescription className="text-base">
            Přepište podle originálu. Opravená hodnota se uloží jako ověřená s vaším jménem, původní od AI zůstane v historii.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {keys.map((key) => (
            <TextField
              key={key}
              id={`edit-${info.id}-${key}`}
              name={key}
              label={LABELS[key] ?? key}
              defaultValue={display(key)}
              inputMode={numeric(key) ? "decimal" : undefined}
              autoComplete="off"
            />
          ))}
          <TextField id={`edit-${info.id}-date`} name="observedDate" label={lab ? "Datum odběru" : "Datum"} type="date" defaultValue={info.observedDate ?? ""} />
          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel variant="secondary" className="h-11 rounded-full px-5 text-base" disabled={busy}>
              Zrušit
            </AlertDialogCancel>
            <Button type="submit" className="h-11 rounded-full px-5 text-base" disabled={busy}>
              {busy && <Loader className="size-4 motion-safe:animate-spin" />}
              {busy ? "Ukládám…" : "Uložit opravu"}
            </Button>
          </div>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
