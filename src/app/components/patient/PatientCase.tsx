"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageSkeleton } from "@/app/components/shared/LoadingStates";
import { useSession } from "@/app/components/shared/Session";
import type { ClientDocumentType } from "@/db/catalog";
import { api, type ApiError } from "@/lib/api/client";
import { revalidate, useApi } from "@/lib/api/useApi";
import type { DocumentMetadata, PatientCaseView, Task, UserCase } from "@/lib/api/types";

// Zákrok, ke kterému se pacient právě připravuje: seznam jeho zákroků, přehled vybraného
// a úkoly pro pacienta. Žije v layoutu, takže výběr vydrží přechody mezi podstránkami.
// Dokud přehled a úkoly nejsou načtené, ukazuje načítání, chybu nebo prázdný stav,
// takže stránky uvnitř mají `view` a `tasks` vždy k dispozici.

export type PatientCase = {
  cases: UserCase[];
  caseId: string;
  selectCase: (caseId: string) => void;
  view: PatientCaseView;
  tasks: Task[];
  /** obnovuje se na pozadí (data jsou mezitím ta poslední) */
  loading: boolean;
  /** poslední načtení selhalo, data jsou z dřívějška */
  error: ApiError | undefined;
  /** znovu načte zákroky, přehled i úkoly; volat po každém nahrání */
  refresh: () => Promise<void>;
};

const PatientCaseContext = createContext<PatientCase | null>(null);

// Výchozí zákrok: první, který ještě běží (nejbližší termín, řadí server), jinak první v seznamu.
const OPEN: UserCase["status"][] = ["new", "active"];
const defaultCase = (cases: UserCase[]) => cases.find((c) => OPEN.includes(c.status)) ?? cases[0];

export function PatientCaseProvider({ children }: { children: React.ReactNode }) {
  const session = useSession();
  // Pomocník z rodiny vidí zákroky pacienta, který ho pozval.
  const casesPath = `/api/v1/users/${session.helping?.patientId ?? session.id}/cases`;
  const list = useApi<UserCase[]>(casesPath);
  const [selected, setSelected] = useState<string | null>(null);

  const cases = list.data;
  const caseId = cases ? ((cases.find((c) => c.id === selected) ?? defaultCase(cases))?.id ?? null) : null;
  const view = useApi<PatientCaseView>(caseId ? `${casesPath}/${caseId}` : null);
  const tasks = useApi<Task[]>(caseId ? `/api/v1/cases/${caseId}/tasks` : null);

  // Předpona zákroků uživatele obnoví i přehled, předpona zákroku i jeho úkoly.
  const refresh = useCallback(async () => {
    await revalidate(casesPath, ...(caseId ? [`/api/v1/cases/${caseId}`] : []));
  }, [casesPath, caseId]);

  const error = list.error ?? view.error ?? tasks.error;
  const loading = list.loading || view.loading || tasks.loading;

  if (!cases || (caseId && (!view.data || !tasks.data))) {
    if (error && !loading) return <LoadError message={error.message} onRetry={refresh} />;
    return <PageSkeleton />;
  }
  if (!caseId || !view.data || !tasks.data) return <NoCase firstName={session.firstName} />;

  return (
    <PatientCaseContext value={{ cases, caseId, selectCase: setSelected, view: view.data, tasks: tasks.data, loading, error, refresh }}>
      {children}
    </PatientCaseContext>
  );
}

export function usePatientCase() {
  const value = useContext(PatientCaseContext);
  if (!value) throw new Error("usePatientCase musí být uvnitř PatientCaseProvider");
  return value;
}

// Nahrání jednoho souboru k zákroku. Bez `type` jde o lékařskou zprávu, s `type` o fotku, podpis
// nebo hlasovku (tvar `meta` podle typu hlídá server). Po nahrání zavolejte refresh().
export function uploadDocument(
  caseId: string,
  file: Blob,
  fileName: string,
  { type, meta, taskId }: { type?: ClientDocumentType; meta?: Record<string, unknown>; taskId?: string } = {},
) {
  const form = new FormData();
  form.set("file", file, fileName);
  if (type) form.set("type", type);
  if (meta) form.set("meta", JSON.stringify(meta));
  if (taskId) form.set("taskId", taskId);
  return api.upload<DocumentMetadata>(`/api/v1/cases/${caseId}/documents`, form);
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-4 pb-12 lg:mx-auto lg:max-w-md">
      <h1 className="text-3xl font-semibold tracking-tight">Přípravu se nepodařilo načíst</h1>
      <p className="text-base text-muted-foreground">{message}</p>
      <Button variant="secondary" className="h-11 rounded-full px-5" onClick={onRetry}>
        Zkusit znovu
      </Button>
    </div>
  );
}

function NoCase({ firstName }: { firstName: string }) {
  return (
    <div className="flex flex-col gap-2 pb-12 lg:mx-auto lg:max-w-md">
      <p className="text-base text-muted-foreground">Dobrý den, {firstName}</p>
      <h1 className="text-3xl font-semibold tracking-tight">Zatím nemáte naplánovaný zákrok</h1>
      <p className="text-base text-muted-foreground">Až ho ambulance naplánuje, uvidíte tady, co si připravit. Ozveme se vám.</p>
    </div>
  );
}
