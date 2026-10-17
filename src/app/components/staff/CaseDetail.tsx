"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Lock } from "lucide-react";
import { EditIcon, UserEditIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { Button, buttonVariants } from "@/components/ui/button";
import { CaseActions } from "@/app/components/staff/CaseActions";
import { AirwayCard } from "@/app/components/staff/AirwayCard";
import { ActivityCalendar } from "@/app/components/staff/detail/ActivityCalendar";
import { CaseHeader } from "@/app/components/staff/detail/CaseHeader";
import { CaseSummary } from "@/app/components/staff/detail/CaseSummary";
import { PatientSees } from "@/app/components/staff/detail/PatientSees";
import { HospitalPanel } from "@/app/components/staff/detail/HospitalPanel";
import { MedicationRecordCard } from "@/app/components/staff/detail/MedicationRecordCard";
import { ProfilePanel } from "@/app/components/staff/detail/ProfilePanel";
import { PatientActivity } from "@/app/components/staff/detail/PatientActivity";
import { ReadinessCard } from "@/app/components/staff/detail/ReadinessCard";
import { UploadRequests } from "@/app/components/staff/detail/UploadRequests";
import { Stagger, StaggerItem } from "@/app/components/shared/motion/Stagger";
import { CaseLock } from "@/app/components/shared/CaseLock";
import { CaseDetailSkeleton } from "@/app/components/shared/LoadingStates";
import { api } from "@/lib/api/client";
import { revalidate, useApi } from "@/lib/api/useApi";
import type { CaseDetail as Detail, Task } from "@/lib/api/types";
import { caseProfile } from "@/lib/caseView";
import { formatDateTime } from "@/lib/date";
import { cn } from "@/lib/utils";
import type { SummaryAnchor } from "@/lib/caseSummary";

// Souhrn je první záložka, ostatní jsou podklady, na které souhrn odkazuje.
type Tab = "souhrn" | SummaryAnchor | "aktivita";
const TABS: { id: Tab; label: string }[] = [
  { id: "souhrn", label: "Souhrn" },
  { id: "priprava", label: "Časová osa" },
  { id: "dokumenty", label: "Dokumenty" },
  { id: "zpravy", label: "Údaje ze zpráv" },
  { id: "pacient", label: "Od pacienta" },
  { id: "nemocnice", label: "Z nemocnice" },
  { id: "aktivita", label: "Aktivita" },
];

// Detail se obnovuje každých pár sekund, ať lékař vidí, co pacient zrovna poslal z telefonu.
const REFRESH_MS = 10_000;

// Detail zákroku z GET /api/v1/cases/:id a jeho úkoly z /tasks. Jeden sloupec, každá sekce odpovídá na jednu otázku:
// 0. zpět na přehled, úprava zákroku a pacienta
// 1. kdo to je (lepicí hlavička: jméno, diagnóza, výkon, dny, Hb, videohovor, tisk)
// 2. co teď udělat (další krok)
// 3. záložky, vidět je vždy jen jedna, na začátku Souhrn (řádek na oblast předoperačního vyšetření,
//    výjimky svítí, řádek se rozbalí na místě), pak podklady: časová osa, údaje ze zpráv (potvrzení),
//    dokumenty a vyžádání, co poslal pacient, data z nemocnice a aktivita po dnech (kalendář jako na GitHubu).
//    Souhrn na ně odkazuje.
// Originály dokumentů mají vlastní stránku /staff/[caseId]/documents/[documentId].
export function CaseDetail({ caseId }: { caseId: string }) {
  const router = useRouter();
  // Na začátku souhrn: celý zákrok na jeden pohled, podklady jsou o záložku dál.
  const [tab, setTab] = useState<Tab>("souhrn");
  const tabsRef = useRef<HTMLElement>(null);
  const openTab = (next: SummaryAnchor) => {
    setTab(next);
    requestAnimationFrame(() => tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const detail = useApi<Detail>(`/api/v1/cases/${caseId}`, { refreshMs: REFRESH_MS });
  const tasks = useApi<Task[]>(`/api/v1/cases/${caseId}/tasks`, { refreshMs: REFRESH_MS });
  // Hodnota, na kterou lékař klikl: otevře se její dokument a hodnota na něm svítí.
  const showSource = (key: string, file: string) => router.push(`/staff/${caseId}/documents/${file}?value=${key}`);

  // Otevření detailu zhasne „Nové“ ve frontě.
  useEffect(() => {
    api
      .post(`/api/v1/cases/${caseId}/mark-seen`)
      .then(() => revalidate("/api/v1/queue"))
      .catch(() => undefined);
  }, [caseId]);

  if (detail.error?.status === 404) return <NotFound />;
  const error = detail.error ?? tasks.error;
  if (error && (!detail.data || !tasks.data)) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl bg-background p-6">
        <p className="text-base">{error.message}</p>
        <Button variant="secondary" className="h-11 rounded-full px-5" onClick={() => (detail.reload(), tasks.reload())}>
          Zkusit znovu
        </Button>
      </div>
    );
  }
  if (!detail.data || !tasks.data) return <CaseDetailSkeleton />;

  const data = detail.data;
  const profile = caseProfile(data);

  return (
    <CaseLock locked={!!data.closed}>
      <div className="flex flex-col gap-8">
        <div className="-mb-4 flex items-center justify-between gap-2">
          <Link
            href="/staff"
            className="press -ml-2 inline-flex h-11 w-fit items-center gap-1 rounded-full pr-3 pl-1 text-base text-muted-foreground outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="size-5" />
            Přehled
          </Link>
          {/* Uzavřený (exportovaný) zákrok se už neupravuje. */}
          {!data.closed && (
            <div className="flex gap-2">
              <EditLink href={`/staff/patients/${data.patient.id}/edit`} icon={<UserEditIcon className="size-4" />} label="Upravit pacienta" short="Pacient" />
              <EditLink href={`/staff/cases/${caseId}/edit`} icon={<EditIcon className="size-4" />} label="Upravit zákrok" short="Zákrok" />
            </div>
          )}
        </div>

        <CaseHeader detail={data} diagnosis={profile.diagnosis} />

        <Stagger className="flex flex-col gap-8">
          <StaggerItem as="section" className="rounded-2xl bg-background p-6 lg:p-8">
            {data.closed ? (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
                    <Lock className="size-5" /> Zákrok je uzavřený
                  </h2>
                  <p className="text-base text-muted-foreground">Exportováno {formatDateTime(data.closed.at)}. Údaje už nejde upravovat.</p>
                </div>
                <Link href={`/staff/${caseId}/export`} className={cn(buttonVariants({ variant: "secondary" }), "h-11 rounded-full px-5 text-base")}>
                  Odeslat a vytisknout
                </Link>
              </div>
            ) : (
              <CaseActions detail={data} tasks={tasks.data} />
            )}
          </StaggerItem>

          <StaggerItem>
            <section ref={tabsRef} aria-label="Detail zákroku" className="flex scroll-mt-24 flex-col gap-4">
              <div role="tablist" aria-label="Detail zákroku" className="flex flex-wrap gap-x-8 gap-y-2 border-b-2 border-border">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.id}
                    onClick={() => setTab(t.id)}
                    className={cn(
                      "-mb-0.5 flex h-12 items-center gap-2 border-b-[3px] text-lg outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      tab === t.id ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                    )}
                  >
                    {t.label}
                    {t.id === "dokumenty" && data.documents.length > 0 && <span className="text-sm font-normal text-muted-foreground">{data.documents.length}</span>}
                  </button>
                ))}
              </div>
              {tab === "souhrn" && (
                <CaseSummary caseId={caseId} detail={data} tasks={tasks.data} profile={profile} onShowSource={showSource} onOpenTab={openTab} />
              )}
              {tab === "priprava" && <ReadinessCard detail={data} tasks={tasks.data} />}
              {tab === "zpravy" && (
                <div className="flex flex-col gap-4">
                  <ProfilePanel caseId={caseId} profile={profile} onShowSource={showSource} focus={null} />
                  <MedicationRecordCard caseId={caseId} detail={data} />
                </div>
              )}
              {tab === "dokumenty" && <UploadRequests caseId={caseId} detail={data} tasks={tasks.data} />}
              {tab === "pacient" && (
                <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
                  <div className="lg:col-span-2">
                    <PatientSees caseId={caseId} patientId={data.patient.id} tasks={tasks.data} />
                  </div>
                  <div className="flex flex-col gap-4">
                    <PatientActivity caseId={caseId} activity={data.activity} people={data.people} />
                  </div>
                  <AirwayCard caseId={caseId} photos={data.airwayPhotos} assessment={data.airwayAssessment} />
                </div>
              )}
              {tab === "nemocnice" && <HospitalPanel caseId={caseId} />}
              {tab === "aktivita" && <ActivityCalendar caseId={caseId} />}
            </section>
          </StaggerItem>
        </Stagger>
      </div>
    </CaseLock>
  );
}

function NotFound() {
  return (
    <div className="flex flex-col items-start gap-4">
      <Link href="/staff" className="press -ml-2 inline-flex h-11 items-center gap-1 rounded-full pr-3 pl-1 text-base text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-5" />
        Přehled
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight">Zákrok nenalezen</h1>
      <p className="text-base text-muted-foreground">Možná byl zrušen. Zkuste ho najít v přehledu.</p>
    </div>
  );
}

// Na telefonu jen „Pacient“ a „Zákrok“, aby se obě tlačítka vešla vedle odkazu zpět.
function EditLink({ href, icon, label, short }: { href: string; icon: React.ReactNode; label: string; short: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        buttonVariants({ variant: "secondary" }),
        "h-11 rounded-full bg-background px-4 text-base hover:bg-background/70",
      )}
    >
      {icon}
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}
