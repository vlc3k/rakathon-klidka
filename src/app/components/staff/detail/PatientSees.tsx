"use client";

import Link from "next/link";
import { patientPlan } from "@/app/components/patient/plan";
import { messageText, personOf } from "@/app/components/patient/TodayPanel";
import { useApi } from "@/lib/api/useApi";
import type { PatientCaseView, Task } from "@/lib/api/types";

// Co teď pacient čte na telefonu: stejná zpráva z rádia, jakou mu skládá jeho přehled (rádio Klidky).
// Sestra tak ví, co pacient ví, a když volá, navazuje na stejnou větu. Data z pohledu pacienta (GET users/:id/cases/:id).
export function PatientSees({ caseId, patientId, tasks }: { caseId: string; patientId: string; tasks: Task[] }) {
  const { data: view } = useApi<PatientCaseView>(`/api/v1/users/${patientId}/cases/${caseId}`, { refreshMs: 10_000 });
  if (!view) return null;
  // Pacient vidí jen své úkoly (server mu jiné nevrátí), personál dostává i úkoly ambulance.
  const { next } = patientPlan(caseId, view, tasks.filter((task) => task.assignee === "patient"), false);
  const contact = personOf(view.contact);
  const sentence = messageText(next, view, !!contact);
  // SMS je spouštěč, appka místo, kde se to udělá: stejná věta a odkaz. Odeslání zatím zapojené není.
  const sms = `Anesteziologická ambulance VFN: ${sentence} ${typeof window === "undefined" ? "" : `${window.location.origin}/patient`}`.trim();
  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-background p-6" aria-labelledby="pacient-cte">
      <h3 id="pacient-cte" className="text-sm text-muted-foreground">
        Co teď pacient čte v aplikaci
      </h3>
      <blockquote className="max-w-[40ch] text-xl leading-snug font-medium text-balance">„{sentence}“</blockquote>
      <p className="text-sm text-muted-foreground">
        {contact ? `Podepsáno: ${contact.displayName}` : "Zákrok nemá kontaktní osobu se jménem, zpráva je podepsaná ambulancí. "}
        {!contact && (
          <Link href={`/staff/cases/${caseId}/edit`} className="font-medium text-primary underline-offset-4 hover:underline">
            Doplnit kontakt
          </Link>
        )}
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Stejná zpráva jako SMS ({sms.length} znaků)</summary>
        <p className="mt-2 rounded-xl bg-muted p-3">{sms}</p>
        <p className="mt-1 text-muted-foreground">Náhled. Odesílání SMS zatím zapojené není.</p>
      </details>
    </section>
  );
}
