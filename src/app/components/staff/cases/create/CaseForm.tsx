"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BackButton, useGoBack } from "@/app/components/shared/BackButton";
import {
  CASE_FIELDS,
  CaseFields,
  caseInput,
  emptyCase,
  FieldError,
  submitError,
} from "@/app/components/shared/CaseFields";
import { EditCard } from "@/app/components/shared/EditCard";
import { Reveal } from "@/app/components/shared/motion/Reveal";
import { Stagger, StaggerItem } from "@/app/components/shared/motion/Stagger";
import { activeCases, fullName, LoadError } from "@/app/components/shared/PatientStore";
import { EditCardSkeleton } from "@/app/components/shared/LoadingStates";
import { PatientPicker } from "@/app/components/staff/cases/create/PatientPicker";
import { api, ApiError } from "@/lib/api/client";
import type { PatientDetail } from "@/lib/api/types";
import { revalidate, useApi } from "@/lib/api/useApi";
import { caseCount } from "@/lib/plural";

// Nový zákrok: nejdřív vybrat pacienta, pak vyplnit zákrok. Z úpravy pacienta přijde
// s ?patient=…, pacient je pak daný a výběr se nezobrazí. Po uložení zpět, odkud přišel.
// Next s cacheComponents opuštěnou stránku jen schová i se stavem (React Activity),
// proto se formulář po uložení nebo zrušení vyčistí přes nový klíč.
export function CaseForm() {
  const fixedId = useSearchParams().get("patient");
  const [leaves, setLeaves] = useState(0);
  const goBack = useGoBack("/staff/cases");
  return (
    <CaseFormContent
      key={`${fixedId}-${leaves}`}
      fixedId={fixedId}
      onLeave={() => {
        setLeaves((count) => count + 1);
        goBack();
      }}
    />
  );
}

function CaseFormContent({ fixedId, onLeave }: { fixedId: string | null; onLeave: () => void }) {
  const fixed = useApi<PatientDetail>(fixedId ? `/api/v1/patients/${fixedId}` : null);
  const [patientId, setPatientId] = useState<string | null>(fixedId);
  const [draft, setDraft] = useState(() => emptyCase("new"));
  const [pickError, setPickError] = useState<string>();
  const [error, setError] = useState<ApiError>();
  const [sending, setSending] = useState(false);
  // Chyba pacienta se ukáže u výběru; daný pacient výběr nemá, tak u tlačítka.
  const formError = submitError(error, [...(fixedId ? [] : ["patientId"]), ...CASE_FIELDS]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patientId) {
      setPickError("Vyberte pacienta, ke kterému zákrok patří.");
      return;
    }
    setSending(true);
    setError(undefined);
    try {
      await api.post("/api/v1/cases", { patientId, ...caseInput(draft) });
      void revalidate("/api/v1/cases", "/api/v1/patients", "/api/v1/queue", "/api/v1/users");
      onLeave();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, "Něco se pokazilo. Zkuste to prosím znovu."));
      setSending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <Reveal className="flex flex-col gap-4">
        <BackButton onClick={onLeave} />
        <h1 className="text-3xl font-semibold tracking-tight lg:text-4xl">Nový zákrok</h1>
      </Reveal>

      <Stagger delay={0.05} className="flex flex-col gap-8">
        <StaggerItem as="section" className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Pacient</h2>
          {fixedId ? (
            fixed.data ? (
              <EditCard
                title={fullName(fixed.data)}
                subtitle={`${fixed.data.externalId ? `${fixed.data.externalId} · ` : ""}${caseCount(activeCases(fixed.data.cases).length)}`}
              />
            ) : fixed.error ? (
              <div className="rounded-2xl bg-background">
                <LoadError error={fixed.error} onRetry={fixed.reload} />
              </div>
            ) : (
              <EditCardSkeleton />
            )
          ) : (
            <PatientPicker
              selectedId={patientId}
              onSelect={(id) => {
                setPatientId(id);
                setPickError(undefined);
              }}
              error={pickError ?? error?.issue("patientId")}
            />
          )}
        </StaggerItem>

        <StaggerItem as="section" className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Zákrok</h2>
          <CaseFields
            draft={draft}
            onChange={setDraft}
            title="Údaje o zákroku"
            withTemplate
            issue={(field) => error?.issue(field)}
          />
        </StaggerItem>

        <StaggerItem className="flex flex-col gap-3">
          <FieldError message={formError} />
          <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
            <Button
              type="submit"
              disabled={sending || (fixedId !== null && !fixed.data)}
              className="h-12 w-full rounded-full px-6 text-base sm:w-auto"
            >
              {sending ? "Ukládám…" : "Přidat zákrok"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onLeave}
              className="h-11 w-full rounded-full px-6 text-base sm:h-12 sm:w-auto"
            >
              Zrušit
            </Button>
          </div>
        </StaggerItem>
      </Stagger>
    </form>
  );
}
