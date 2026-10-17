"use client";

import { useState } from "react";
import { UserEditIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { Button } from "@/components/ui/button";
import { BackButton, useGoBack } from "@/app/components/shared/BackButton";
import {
  CASE_FIELDS,
  CaseFields,
  casePatch,
  draftFromCase,
  FieldError,
  submitError,
} from "@/app/components/shared/CaseFields";
import { EditCard } from "@/app/components/shared/EditCard";
import { Reveal } from "@/app/components/shared/motion/Reveal";
import { Stagger, StaggerItem } from "@/app/components/shared/motion/Stagger";
import { fullName, LoadError } from "@/app/components/shared/PatientStore";
import { FormSkeleton } from "@/app/components/shared/LoadingStates";
import { api, ApiError } from "@/lib/api/client";
import type { CaseDetail } from "@/lib/api/types";
import { revalidate, useApi } from "@/lib/api/useApi";

// Úprava jednoho zákroku. Údaje pacienta a jeho další zákroky se mění v úpravě pacienta.
// Otevírá se z detailu zákroku, ze správy zákroků i z úpravy pacienta, proto se po uložení
// vrací, odkud přišla.
//
// Next s cacheComponents opuštěnou stránku jen schová i se stavem (React Activity).
// Klíč z dat a počítadlo odchodů zajistí, že úprava vždy začne z uložených údajů.
export function CaseEditForm({ id }: { id: string }) {
  const [leaves, setLeaves] = useState(0);
  const goBack = useGoBack("/staff/cases");
  const { data, error, reload } = useApi<CaseDetail>(`/api/v1/cases/${id}`);

  if (error?.status === 404) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-4">
        <BackButton onClick={goBack} />
        <h1 className="text-3xl font-semibold tracking-tight">Zákrok nenalezen</h1>
        <p className="text-base text-muted-foreground">Možná byl odebrán. Zkuste ho najít v seznamu znovu.</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <BackButton onClick={goBack} />
        {error ? <LoadError error={error} onRetry={reload} /> : <FormSkeleton back={false} />}
      </div>
    );
  }

  return (
    <CaseEditContent
      key={`${JSON.stringify(data.case)}-${leaves}`}
      detail={data}
      onLeave={() => {
        setLeaves((count) => count + 1);
        goBack();
      }}
    />
  );
}

function CaseEditContent({ detail, onLeave }: { detail: CaseDetail; onLeave: () => void }) {
  const { case: caseItem, patient } = detail;
  const [initial] = useState(() => draftFromCase(caseItem));
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<ApiError>();
  const [sending, setSending] = useState(false);
  const formError = submitError(error, CASE_FIELDS);

  // Posílá jen změněná pole. Bez změn se jen vrátí.
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const patch = casePatch(initial, draft);
    if (Object.keys(patch).length === 0) {
      onLeave();
      return;
    }
    setSending(true);
    setError(undefined);
    try {
      await api.patch(`/api/v1/cases/${caseItem.id}`, patch);
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
        <div>
          <h1 className="text-3xl font-semibold tracking-tight lg:text-4xl">Úprava zákroku</h1>
          {caseItem.status === "cancelled" && (
            <p className="text-base text-muted-foreground">Zákrok je zrušený.</p>
          )}
        </div>
      </Reveal>

      <Stagger delay={0.05} className="flex flex-col gap-8">
        <StaggerItem as="section" className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Pacient</h2>
          <EditCard
            title={fullName(patient)}
            subtitle={patient.externalId ?? ""}
            edit={{
              href: `/staff/patients/${patient.id}/edit`,
              label: `Upravit pacienta ${fullName(patient)}`,
              icon: <UserEditIcon className="size-4" />,
            }}
          />
        </StaggerItem>

        <StaggerItem as="section" className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Zákrok</h2>
          <CaseFields
            draft={draft}
            onChange={setDraft}
            title="Údaje o zákroku"
            issue={(field) => error?.issue(field)}
          />
        </StaggerItem>

        <StaggerItem className="flex flex-col gap-3">
          <FieldError message={formError} />
          <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
            <Button
              type="submit"
              disabled={sending}
              className="h-12 w-full rounded-full px-6 text-base sm:w-auto"
            >
              {sending ? "Ukládám…" : "Uložit změny"}
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
