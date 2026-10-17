"use client";

import { useId } from "react";
import { Switch } from "@base-ui/react/switch";
import { ChevronDown } from "lucide-react";
import { TrashIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { TextField } from "@/app/components/shared/TextField";
import { RULES } from "@/db/catalog";
import type { ApiError } from "@/lib/api/client";
import type { Template } from "@/lib/api/types";
import { useApi } from "@/lib/api/useApi";

// Rozepsaný zákrok ve formuláři. Hodnoty jsou řetězce jako v polích, do API je převede
// caseInput (nový zákrok) nebo casePatch (jen změny). `key` je jen pro React.
export type CaseDraft = {
  key: string;
  templateId: string;
  procedureName: string;
  diagnosis: string;
  surgeryDate: string;
  bloodLossMl: string;
  isOncological: boolean;
};

// Pole zákroku, jak jim říká API (cesty v `issues`).
export const CASE_FIELDS = ["diagnosis", "procedureName", "templateId", "surgeryDate", "bloodLossMl"];

export function emptyCase(key: string): CaseDraft {
  return { key, templateId: "", procedureName: "", diagnosis: "", surgeryDate: "", bloodLossMl: "", isOncological: false };
}

type SavedCase = {
  id: string;
  procedureName: string | null;
  diagnosis: { text: string } | null;
  surgeryDate: string | null;
  bloodLossMl: number | null;
  isOncological: boolean;
};

export function draftFromCase(caseItem: SavedCase): CaseDraft {
  return {
    key: caseItem.id,
    templateId: "",
    procedureName: caseItem.procedureName ?? "",
    diagnosis: caseItem.diagnosis?.text ?? "",
    surgeryDate: caseItem.surgeryDate ?? "",
    bloodLossMl: caseItem.bloodLossMl === null ? "" : String(caseItem.bloodLossMl),
    isOncological: caseItem.isOncological,
  };
}

// Nový zákrok pro POST: nevyplněná nepovinná pole se neposílají.
// Se šablonou doplní server výkon i krevní ztrátu sám.
export function caseInput(draft: CaseDraft) {
  const procedureName = draft.procedureName.trim();
  return {
    diagnosis: { text: draft.diagnosis.trim() },
    ...(draft.templateId ? { templateId: draft.templateId } : {}),
    ...(procedureName ? { procedureName } : {}),
    ...(draft.surgeryDate ? { surgeryDate: draft.surgeryDate } : {}),
    ...(draft.bloodLossMl !== "" ? { bloodLossMl: Number(draft.bloodLossMl) } : {}),
    ...(draft.isOncological ? { isOncological: true } : {}),
  };
}

// Úprava pro PATCH: jen změněná pole. Prázdný termín a krevní ztráta se mažou (null).
export function casePatch(initial: CaseDraft, draft: CaseDraft) {
  const patch: Record<string, unknown> = {};
  const procedureName = draft.procedureName.trim();
  const diagnosis = draft.diagnosis.trim();
  if (procedureName !== initial.procedureName) patch.procedureName = procedureName;
  if (diagnosis !== initial.diagnosis) patch.diagnosis = { text: diagnosis };
  if (draft.surgeryDate !== initial.surgeryDate) patch.surgeryDate = draft.surgeryDate || null;
  if (draft.bloodLossMl !== initial.bloodLossMl) {
    patch.bloodLossMl = draft.bloodLossMl === "" ? null : Number(draft.bloodLossMl);
  }
  if (draft.isOncological !== initial.isOncological) patch.isOncological = draft.isOncological;
  return patch;
}

const matches = (path: string, field: string) => path === field || path.startsWith(`${field}.`);

// Chyba k tlačítku: konflikt (409), výpadek spojení nebo chyba pole, které formulář nemá.
// Když jsou všechny chyby u polí, tlačítko na ně jen upozorní (pole může být mimo obrazovku).
export function submitError(error: ApiError | undefined, fields: string[]) {
  if (!error) return undefined;
  if (error.issues.length === 0) return error.message;
  const unplaced = error.issues.filter((issue) => !fields.some((field) => matches(issue.path, field)));
  if (unplaced.length) return unplaced.map((issue) => issue.message).join(" ");
  return "Zkontrolujte prosím údaje u polí výše.";
}

// Textové pole s chybou z API pod sebou, textem, ne jen barvou.
export function Field({ error, ...props }: React.ComponentProps<typeof TextField> & { error?: string }) {
  const errorId = `${props.id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <TextField
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...props}
      />
      <FieldError id={errorId} message={error} />
    </div>
  );
}

export function FieldError({ id, message }: { id?: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-sm font-medium text-destructive">
      {message}
    </p>
  );
}

// 1 úkol, 2 až 4 úkoly, 0 a víc než 4 úkolů.
function taskCount(count: number) {
  if (count === 1) return "1 úkol";
  if (count >= 2 && count <= 4) return `${count} úkoly`;
  return `${count} úkolů`;
}

// Jeden zákrok. Šablona jde vybrat jen při založení (`withTemplate`), pak už má zákrok vlastní kopii úkolů.
// `issue` vrací chybu z API k poli zákroku (podle názvu z CASE_FIELDS).
export function CaseFields({
  draft,
  onChange,
  title,
  onRemove,
  withTemplate = false,
  issue = () => undefined,
}: {
  draft: CaseDraft;
  onChange: (draft: CaseDraft) => void;
  title: string;
  onRemove?: () => void;
  withTemplate?: boolean;
  issue?: (field: string) => string | undefined;
}) {
  // Id přes useId: schovaná stránka (React Activity) zůstává v DOM a stejné id by si vzalo popisek.
  const uid = useId();
  const id = (field: string) => `${uid}-${field}`;
  const set = <K extends keyof CaseDraft>(field: K, value: CaseDraft[K]) => onChange({ ...draft, [field]: value });

  const { data, error: templatesError } = useApi<Template[]>(withTemplate ? "/api/v1/templates" : null);
  const templates = data?.filter((template) => template.isActive) ?? [];
  const chosen = templates.find((template) => template.id === draft.templateId);

  // Výkon se předvyplní názvem šablony, když je prázdný nebo v něm zůstal název předchozí šablony.
  function chooseTemplate(templateId: string) {
    const next = templates.find((template) => template.id === templateId);
    const prefilled = !draft.procedureName.trim() || draft.procedureName === chosen?.name;
    onChange({ ...draft, templateId, procedureName: prefilled ? (next?.name ?? "") : draft.procedureName });
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-background p-5 md:p-6">
      <div className="flex min-h-11 items-center justify-between gap-4">
        <h3 className="text-base font-semibold">{title}</h3>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="press -mr-2 flex h-11 items-center gap-2 rounded-full px-3 text-sm text-muted-foreground outline-none select-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <TrashIcon className="size-4" />
            Odebrat
          </button>
        )}
      </div>

      {withTemplate && (
        <div className="flex flex-col gap-1">
          <div className="flex flex-col gap-2">
            <label htmlFor={id("templateId")} className="text-sm font-medium">
              Šablona (nepovinné)
            </label>
            <div className="relative">
              <select
                id={id("templateId")}
                value={draft.templateId}
                onChange={(event) => chooseTemplate(event.target.value)}
                aria-invalid={issue("templateId") ? true : undefined}
                className="h-12 w-full cursor-pointer appearance-none rounded-xl bg-muted pr-10 pl-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Bez šablony</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>
          {chosen && (
            <p className="text-sm text-muted-foreground">
              Přidá {taskCount(chosen.taskCount)}
              {chosen.bloodLossMl !== null && ` · krevní ztráta ${chosen.bloodLossMl} ml`}
            </p>
          )}
          <FieldError message={issue("templateId") ?? (templatesError && "Šablony se nepodařilo načíst.")} />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Field
          id={id("diagnosis")}
          label="Diagnóza"
          value={draft.diagnosis}
          onChange={(event) => set("diagnosis", event.target.value)}
          error={issue("diagnosis")}
          required
        />
        <Field
          id={id("procedureName")}
          label="Výkon"
          info={withTemplate ? "Se šablonou můžete nechat prázdné, vezme se její název." : undefined}
          value={draft.procedureName}
          onChange={(event) => set("procedureName", event.target.value)}
          error={issue("procedureName")}
          required={!draft.templateId}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field
          id={id("surgeryDate")}
          label="Datum zákroku"
          info="Termín určuje lékař. Když ho ještě nemáte, nechte prázdné."
          type="date"
          value={draft.surgeryDate}
          onChange={(event) => set("surgeryDate", event.target.value)}
          error={issue("surgeryDate")}
        />
        <Field
          id={id("bloodLossMl")}
          label="Očekávaná krevní ztráta (ml)"
          info={
            <>
              Nad {RULES.pbm.bloodLossThresholdMl} ml se spouští PBM, péče o krev před operací.
              {chosen?.bloodLossMl != null && " Když necháte prázdné, platí hodnota ze šablony."}
            </>
          }
          type="number"
          inputMode="numeric"
          min={0}
          max={20000}
          step={1}
          value={draft.bloodLossMl}
          onChange={(event) => set("bloodLossMl", event.target.value)}
          error={issue("bloodLossMl")}
        />
      </div>

      <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4 rounded-xl bg-muted px-4 py-2">
        <span className="text-base">Onkologický pacient</span>
        <Switch.Root
          checked={draft.isOncological}
          onCheckedChange={(checked) => set("isOncological", checked)}
          className="relative flex h-8 w-13 shrink-0 items-center rounded-full bg-border p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring data-checked:bg-primary motion-safe:transition-colors motion-safe:duration-200"
        >
          <Switch.Thumb className="size-7 rounded-full bg-background shadow-sm data-checked:translate-x-5 motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-smooth" />
        </Switch.Root>
      </label>
    </div>
  );
}
