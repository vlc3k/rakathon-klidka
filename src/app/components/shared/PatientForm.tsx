"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { EditIcon, TrashIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { Button } from "@/components/ui/button";
import { BackButton, useGoBack } from "@/app/components/shared/BackButton";
import {
  CASE_FIELDS,
  CaseFields,
  caseInput,
  emptyCase,
  Field,
  FieldError,
  submitError,
} from "@/app/components/shared/CaseFields";
import { EditCard } from "@/app/components/shared/EditCard";
import { Reveal } from "@/app/components/shared/motion/Reveal";
import { Stagger, StaggerItem } from "@/app/components/shared/motion/Stagger";
import { activeCases, fullName, LoadError, type PatientCase } from "@/app/components/shared/PatientStore";
import { FormSkeleton } from "@/app/components/shared/LoadingStates";
import { api, ApiError } from "@/lib/api/client";
import type { PatientDetail } from "@/lib/api/types";
import { revalidate, useApi } from "@/lib/api/useApi";
import { formatDate } from "@/lib/date";

const listHref = "/staff/patients";

const PATIENT_FIELDS = ["firstName", "lastName", "externalId", "phone", "birthNumber", "birthDate"];

// Stránka pro vytvoření (bez `id`) i úpravu pacienta (s `id`). Pacient má jeden nebo víc zákroků.
// Nový pacient vyplní první zákroky rovnou. Při úpravě jsou zákroky karty a každý se upravuje
// zvlášť (/staff/cases/[id]/edit), stejně jako pacient z úpravy zákroku.
//
// Next s cacheComponents opuštěné stránky jen schová i s jejich stavem (React Activity).
// Klíč z dat proto zajistí, že úprava vždy začne z aktuálních údajů (třeba když mezitím
// přibyl zákrok), a po uložení nebo zrušení se formulář vyčistí.
export function PatientForm({ id }: { id?: string }) {
  const [leaves, setLeaves] = useState(0);
  const goBack = useGoBack(listHref);
  const { data: patient, error, reload } = useApi<PatientDetail>(id ? `/api/v1/patients/${id}` : null);

  if (id && error?.status === 404) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-4">
        <BackButton onClick={goBack} />
        <h1 className="text-3xl font-semibold tracking-tight">Pacient nenalezen</h1>
        <p className="text-base text-muted-foreground">Možná byl odebrán. Zkuste ho najít v seznamu znovu.</p>
      </div>
    );
  }

  if (id && !patient) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <BackButton onClick={goBack} />
        {error ? <LoadError error={error} onRetry={reload} /> : <FormSkeleton back={false} />}
      </div>
    );
  }

  return (
    <PatientFormContent
      key={`${patient ? JSON.stringify(patient) : "new"}-${leaves}`}
      patient={patient}
      onLeave={() => {
        setLeaves((count) => count + 1);
        goBack();
      }}
    />
  );
}

function PatientFormContent({ patient, onLeave }: { patient?: PatientDetail; onLeave: () => void }) {
  // Nový pacient: rozepsané zákroky. Úprava: zákroky, které se po uložení zruší.
  const [drafts, setDrafts] = useState(() => [emptyCase("new")]);
  const [cancelled, setCancelled] = useState<string[]>([]);
  const [birthNumber, setBirthNumber] = useState(patient?.birthNumber ?? "");
  const [error, setError] = useState<ApiError>();
  const [sending, setSending] = useState(false);
  const lastKey = useRef(0);
  const uid = useId(); // viz CaseFields: schovaná stránka zůstává v DOM
  // Karty, které byly při načtení, se animují s celou sekcí. Nově přidané se objeví samy.
  const [initialKeys] = useState(() => new Set(drafts.map((draft) => draft.key)));

  const cases = patient ? activeCases(patient.cases).filter((caseItem) => !cancelled.includes(caseItem.id)) : [];
  const caseCount = patient ? cases.length : drafts.length;
  const issue = (path: string) => error?.issue(path);
  const formError = submitError(error, [
    ...PATIENT_FIELDS,
    ...drafts.flatMap((_, index) => CASE_FIELDS.map((field) => `cases.${index}.${field}`)),
  ]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const field = (name: string) => String(data.get(name) ?? "").trim();
    setSending(true);
    setError(undefined);
    try {
      if (patient) await save(patient, field);
      else await create(field);
      void revalidate("/api/v1/patients", "/api/v1/cases", "/api/v1/queue", "/api/v1/users");
      onLeave();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, "Něco se pokazilo. Zkuste to prosím znovu."));
      setSending(false);
    }
  }

  // Nepovinná pole se posílají, jen když jsou vyplněná. S RČ je datum narození vypnuté, odvodí ho server.
  async function create(field: (name: string) => string) {
    await api.post("/api/v1/patients", {
      firstName: field("firstName"),
      lastName: field("lastName"),
      externalId: field("externalId"),
      ...(field("phone") ? { phone: field("phone") } : {}),
      ...(field("birthNumber") ? { birthNumber: field("birthNumber") } : {}),
      ...(field("birthDate") ? { birthDate: field("birthDate") } : {}),
      cases: drafts.map(caseInput),
    });
  }

  // Úprava posílá jen změněná pole. Smazané RČ = null (datum narození zůstane).
  // Odebrané zákroky se zruší až teď, po „Uložit změny“.
  async function save(current: PatientDetail, field: (name: string) => string) {
    const patch: Record<string, string | null> = {};
    if (field("firstName") !== current.firstName) patch.firstName = field("firstName");
    if (field("lastName") !== current.lastName) patch.lastName = field("lastName");
    if (field("externalId") !== (current.externalId ?? "")) patch.externalId = field("externalId");
    if (field("phone") !== (current.phone ?? "")) patch.phone = field("phone") || null;
    if (field("birthNumber") !== (current.birthNumber ?? "")) patch.birthNumber = field("birthNumber") || null;
    if (!field("birthNumber") && field("birthDate") !== current.birthDate) patch.birthDate = field("birthDate");
    if (Object.keys(patch).length) await api.patch(`/api/v1/patients/${current.id}`, patch);
    await Promise.all(cancelled.map((caseId) => api.patch(`/api/v1/cases/${caseId}`, { status: "cancelled" })));
  }

  function addDraft() {
    lastKey.current += 1;
    const key = String(lastKey.current);
    setDrafts((list) => [...list, emptyCase(key)]);
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <Reveal className="flex flex-col gap-4">
        <BackButton onClick={onLeave} />
        <div>
          <h1 className="text-3xl font-semibold tracking-tight lg:text-4xl">
            {patient ? fullName(patient) : "Nový pacient"}
          </h1>
          {patient && (
            <p className="text-base text-muted-foreground">
              {patient.externalId && `${patient.externalId} · `}přidáno {formatDate(patient.createdAt)}
            </p>
          )}
        </div>
      </Reveal>

      <Stagger delay={0.05} className="flex flex-col gap-8">
        <StaggerItem as="section" className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Pacient</h2>
          <div className="flex flex-col gap-4 rounded-2xl bg-background p-5 md:p-6">
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                id={`${uid}-firstName`}
                name="firstName"
                label="Jméno"
                autoComplete="off"
                defaultValue={patient?.firstName}
                error={issue("firstName")}
                required
              />
              <Field
                id={`${uid}-lastName`}
                name="lastName"
                label="Příjmení"
                autoComplete="off"
                defaultValue={patient?.lastName}
                error={issue("lastName")}
                required
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                id={`${uid}-externalId`}
                name="externalId"
                label="Identifikátor"
                info="Číslo pacienta z nemocnice. Pacient se jím přihlásí spolu s datem narození."
                placeholder="VFN-2026-0142"
                autoCapitalize="characters"
                autoCorrect="off"
                autoComplete="off"
                defaultValue={patient?.externalId ?? ""}
                error={issue("externalId")}
                required
              />
              <Field
                id={`${uid}-phone`}
                name="phone"
                label="Telefon (nepovinné)"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="+420 600 000 000"
                defaultValue={patient?.phone ?? ""}
                error={issue("phone")}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                id={`${uid}-birthNumber`}
                name="birthNumber"
                label="Rodné číslo (nepovinné)"
                info="Z rodného čísla se odvodí datum narození a pohlaví."
                inputMode="numeric"
                autoComplete="off"
                autoCorrect="off"
                placeholder="600301/1234"
                value={birthNumber}
                onChange={(event) => setBirthNumber(event.target.value)}
                error={issue("birthNumber")}
              />
              <Field
                id={`${uid}-birthDate`}
                name="birthDate"
                label="Datum narození"
                info="Povinné, když nevyplníte rodné číslo. S rodným číslem se doplní samo."
                type="date"
                defaultValue={patient?.birthDate}
                disabled={birthNumber.trim() !== ""}
                error={issue("birthDate")}
                required={birthNumber.trim() === ""}
              />
            </div>
          </div>
        </StaggerItem>

        <StaggerItem as="section" className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold tracking-tight">
            Zákrok
            {caseCount > 1 && <span className="ml-2 text-muted-foreground">{caseCount}</span>}
          </h2>
          {patient ? (
            <>
              {cases.length === 0 && (
                <p className="rounded-2xl bg-background p-5 text-base text-muted-foreground md:p-6">
                  Pacient zatím nemá žádný zákrok.
                </p>
              )}
              {cases.map((caseItem) => (
                <CaseCard
                  key={caseItem.id}
                  caseItem={caseItem}
                  onRemove={
                    cases.length > 1 ? () => setCancelled((list) => [...list, caseItem.id]) : undefined
                  }
                />
              ))}
              <Link href={`/staff/cases/create?patient=${patient.id}`} className={addClass}>
                <Plus className="size-5" />
                Přidat zákrok
              </Link>
            </>
          ) : (
            <>
              {drafts.map((draft, index) => {
                const card = (
                  <CaseFields
                    draft={draft}
                    onChange={(next) => setDrafts((list) => list.map((item) => (item.key === next.key ? next : item)))}
                    title={`Zákrok ${index + 1}`}
                    withTemplate
                    issue={(field) => issue(`cases.${index}.${field}`)}
                    onRemove={
                      drafts.length > 1
                        ? () => setDrafts((list) => list.filter((item) => item.key !== draft.key))
                        : undefined
                    }
                  />
                );
                return initialKeys.has(draft.key) ? (
                  <div key={draft.key}>{card}</div>
                ) : (
                  <Reveal key={draft.key}>{card}</Reveal>
                );
              })}
              <button type="button" onClick={addDraft} className={addClass}>
                <Plus className="size-5" />
                Přidat zákrok
              </button>
            </>
          )}
        </StaggerItem>

        <StaggerItem className="flex flex-col gap-3">
          <FieldError message={formError} />
          <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
            <Button
              type="submit"
              disabled={sending}
              className="h-12 w-full rounded-full px-6 text-base sm:w-auto"
            >
              {sending ? "Ukládám…" : patient ? "Uložit změny" : "Přidat pacienta"}
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

const addClass =
  "press flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-background text-base font-medium outline-none select-none hover:bg-background/70 focus-visible:ring-2 focus-visible:ring-ring";

// Stejná karta jako pacient v úpravě zákroku. Odebrání (zrušení zákroku) se projeví až po „Uložit změny“.
function CaseCard({ caseItem, onRemove }: { caseItem: PatientCase; onRemove?: () => void }) {
  const name = caseItem.procedureName ?? "Zákrok";
  return (
    <EditCard
      title={name}
      subtitle={caseItem.surgeryDate ? formatDate(caseItem.surgeryDate) : "Bez termínu"}
      edit={{
        href: `/staff/cases/${caseItem.id}/edit`,
        label: `Upravit zákrok ${name}`,
        icon: <EditIcon className="size-4" />,
      }}
    >
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Odebrat zákrok ${name}`}
          className="press flex size-11 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <TrashIcon className="size-4" />
        </button>
      )}
    </EditCard>
  );
}
