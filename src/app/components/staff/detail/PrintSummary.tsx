"use client";

import { AIRWAY_FINDINGS, type AirwayFinding } from "@/db/catalog";
import { PrintSkeleton } from "@/app/components/shared/LoadingStates";
import { useSession } from "@/app/components/shared/Session";
import { useApi } from "@/lib/api/useApi";
import type { CaseDetail, Task } from "@/lib/api/types";
import { caseProfile, checklistTasks, pbmTask, testsOf, type Verification } from "@/lib/caseView";
import { formatDate, formatDateTime, formatFullDate, todayIso } from "@/lib/date";
import { CONSENT_SIGNING } from "@/lib/features";

// Tiskový výstup do dokumentace (ne všude jsou paperless). Čte totéž co detail.
// Neověřené údaje jsou výslovně označené. Nahoře lišta exportu (uzavřít, odeslat, vytisknout), na papír nejde.
export function PrintSummary({ caseId, toolbar }: { caseId: string; toolbar: (detail: CaseDetail) => React.ReactNode }) {
  const session = useSession();
  const detail = useApi<CaseDetail>(`/api/v1/cases/${caseId}`);
  const tasks = useApi<Task[]>(`/api/v1/cases/${caseId}/tasks`);
  const error = detail.error ?? tasks.error;
  if (error && (!detail.data || !tasks.data)) return <p className="text-base">{error.message}</p>;
  if (!detail.data || !tasks.data) return <PrintSkeleton />;

  const data = detail.data;
  const p = caseProfile(data);
  const { case: caseItem, hb } = data;
  const mark = (verified: Verification | null) => (verified ? `ověřeno${verified.verifiedAt ? ` ${formatDateTime(verified.verifiedAt)}` : ""}` : "načteno AI, neověřeno");
  const open = checklistTasks(tasks.data).filter((task) => task.status === "open" || task.status === "snoozed");
  const pbm = pbmTask(tasks.data);
  const consent = data.activity.consent;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 rounded-2xl bg-background p-8 text-sm print:max-w-none print:rounded-none print:p-0">
      <div className="print:hidden">{toolbar(data)}</div>

      <header className="flex flex-col gap-1 border-b border-border pb-4">
        <p className="text-muted-foreground">Anesteziologická ambulance · předoperační příprava</p>
        <h1 className="text-2xl font-semibold">{data.patient.displayName}</h1>
        <p>
          <strong>{p.diagnosis}</strong> · {caseItem.procedureName}
        </p>
        <p>{caseItem.surgeryDate ? `Zákrok ${formatDate(caseItem.surgeryDate)} (za ${caseItem.daysToCase} dní)` : "Zákrok bez termínu"}</p>
        {data.closed && (
          <p>
            Uzavřeno {formatDateTime(data.closed.at)}
            {data.closed.by && data.people[data.closed.by] ? `, ${data.people[data.closed.by].displayName}` : ""}
          </p>
        )}
      </header>

      <Section title="Alergie">
        {p.allergiesNone ? `neguje · ${mark(p.allergies.verified)}` : p.allergies.items.length ? `${p.allergies.items.map((a) => a.text).join(", ")} · ${mark(p.allergies.verified)}` : "ve zprávách neuvedeno"}
      </Section>

      <Section title="Laboratoř">
        {p.labs.length ? (
          <table className="w-full">
            <tbody>
              {p.labs.map((l) => (
                <tr key={l.id} className="border-b border-border">
                  <td className="py-1">{l.label}</td>
                  <td className="py-1 font-semibold">
                    {l.value} {l.flag ?? ""}
                  </td>
                  <td className="py-1">odběr {l.sampleDate ?? "neuveden"}</td>
                  <td className="py-1">{mark(l.verified)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          "žádné hodnoty"
        )}
      </Section>

      <Section title="Léky">{p.meds.items.length ? `${p.meds.items.map((m) => (m.dose ? `${m.name} ${m.dose}` : m.name)).join(", ")} · ${mark(p.meds.verified)}` : "neuvedeny"}</Section>
      {p.anamnesis.items.length > 0 && <Section title="Osobní anamnéza">{`${p.anamnesis.items.map((a) => a.text).join("; ")} · ${mark(p.anamnesis.verified)}`}</Section>}

      <Section title="PBM">
        {pbm ? `Od pacienta vyžádáno ${formatDate(pbm.createdAt)}${testsOf(pbm).length ? `: ${testsOf(pbm).join(", ")}` : ""}. Čeká se na výsledky. ${hb.info}` : hb.info}
      </Section>

      <Section title="Co ještě chybí">{open.length ? open.map((task) => `${task.title}${task.assignee === "patient" ? " (vyžádáno)" : ""}`).join("; ") : "nic"}</Section>

      {CONSENT_SIGNING && <Section title="Od pacienta">{`Souhlas s anestezií: ${consent ? `podepsán v portálu ${formatDateTime(consent.signedAt)}` : "nepodepsán"}.`}</Section>}

      {(data.airwayPhotos.length > 0 || data.airwayAssessment) && (
        <Section title="Dýchací cesty">
          {data.airwayAssessment
            ? `${data.airwayAssessment.mallampati ? `Mallampati ${["I", "II", "III", "IV"][data.airwayAssessment.mallampati - 1]}` : "Z fotek nelze hodnotit"}${
                data.airwayAssessment.findings.length ? `; ${data.airwayAssessment.findings.map((f) => AIRWAY_FINDINGS[f as AirwayFinding] ?? f).join(", ")}` : ""
              }${data.airwayAssessment.note ? `; ${data.airwayAssessment.note}` : ""}. Posoudil(a) ${data.airwayAssessment.by ?? "AA"}${
                data.airwayAssessment.at ? `, ${formatFullDate(data.airwayAssessment.at)}` : ""
              } z fotek pacienta (${data.airwayPhotos.length} ze 3 poloh).`
            : `Fotky dýchacích cest (${data.airwayPhotos.length} ze 3 poloh) zatím nehodnoceny.`}
        </Section>
      )}

      <footer className="border-t border-border pt-4 text-xs text-muted-foreground">
        Vytiskl(a) {session.displayName}, {formatFullDate(todayIso())}. Údaje označené „načteno AI“ nebyly ověřeny proti originálu. Dokument není rozhodnutím o způsobilosti k anestezii.
      </footer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="font-semibold">{title}</h2>
      <div>{children}</div>
    </section>
  );
}
