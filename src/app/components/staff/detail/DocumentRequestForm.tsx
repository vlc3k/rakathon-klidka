"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/app/components/shared/TextField";
import { DOCUMENT_TYPES, type DocumentType } from "@/db/catalog";
import { api, errorMessage } from "@/lib/api/client";
import { revalidate } from "@/lib/api/useApi";
import { documentRequestTask, LAB_TESTS, REQUESTABLE } from "@/lib/documentRequest";
import { cn } from "@/lib/utils";

const chip = "press flex h-11 cursor-pointer items-center rounded-full px-4 text-sm outline-none select-none focus-visible:ring-2 focus-visible:ring-ring has-focus-visible:ring-2 has-focus-visible:ring-ring";
const chipState = (on: boolean) => (on ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70");

// Vyžádání dokumentu od pacienta, ze zkratky v Dalším kroku (výsledky krve kvůli Hb) i ze záložky Dokumenty.
// Založí úkol na nahrání, žádanku nevystavuje: pacient úkol uvidí v portálu a dokument si zařídí sám.
// Co v dokumentu má být, doplní anesteziolog. Systém jen předvyplní návrh. Formulář stojí na bílém podkladu.
export function DocumentRequestForm({
  caseId,
  type: initialType = null,
  tests: initialTests = [],
  pbm = false,
  exclude,
  onDone,
  onCancel,
}: {
  caseId: string;
  type?: DocumentType | null;
  tests?: string[];
  /** vyžádáno kvůli hemoglobinu: výsledky krve pak patří do PBM */
  pbm?: boolean;
  /** co už pacient má vyžádané a ještě neposlal; jiný dokument jde vyžádat vždy */
  exclude?: Set<string | null>;
  onDone?: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const options = REQUESTABLE.filter((code) => code === "other" || !exclude?.has(code));
  const [picked, setPicked] = useState<DocumentType | null>(initialType);
  const type = picked && options.includes(picked) ? picked : options[0];
  const [name, setName] = useState("");
  const [tests, setTests] = useState<string[]>(initialTests);
  const [extra, setExtra] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (test: string) => setTests((xs) => (xs.includes(test) ? xs.filter((x) => x !== test) : [...xs, test]));
  const lab = type === "lab_report";

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/v1/cases/${caseId}/tasks`, documentRequestTask({ type, name, tests, extra, note, pbm }));
      await revalidate(`/api/v1/cases/${caseId}`, "/api/v1/queue");
      onDone?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <span className="text-base font-semibold">Co od pacienta potřebujete?</span>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Dokument">
        {options.map((code) => (
          <button key={code} type="button" role="radio" aria-checked={type === code} onClick={() => setPicked(code)} className={cn(chip, chipState(type === code))}>
            {DOCUMENT_TYPES[code].name}
          </button>
        ))}
      </div>

      {type === "other" && <TextField id={`${id}-name`} label="Název dokumentu" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoComplete="off" />}

      {lab && (
        <div className="flex flex-col gap-2" role="group" aria-labelledby={`${id}-tests`}>
          <span id={`${id}-tests`} className="text-sm font-medium">
            Co má být ve výsledcích
          </span>
          <div className="flex flex-wrap gap-2">
            {LAB_TESTS.map((test) => (
              <label key={test} className={cn(chip, chipState(tests.includes(test)))}>
                <input type="checkbox" className="sr-only" checked={tests.includes(test)} onChange={() => toggle(test)} />
                {test}
              </label>
            ))}
          </div>
          <TextField id={`${id}-extra`} label="Další hodnoty vlastními slovy (nepovinné)" value={extra} onChange={(e) => setExtra(e.target.value)} maxLength={300} autoComplete="off" />
        </div>
      )}

      <TextField id={`${id}-note`} label="Poznámka pro pacienta (nepovinné)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} autoComplete="off" />

      <p className="text-xs text-muted-foreground">
        {pbm && lab ? "Předvyplněno podle Hb. " : ""}
        {lab ? "Pacient uvidí úkol v portálu a výsledky si zařídí u svého lékaře." : "Pacient uvidí úkol v portálu."}
      </p>
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
        <Button className="h-11 rounded-full px-6 text-base" disabled={busy || (type === "other" && !name.trim())} onClick={send}>
          Vyžádat od pacienta
        </Button>
        <Button variant="ghost" className="h-11 rounded-full px-5 text-base" onClick={onCancel}>
          Zrušit
        </Button>
      </div>
    </div>
  );
}
