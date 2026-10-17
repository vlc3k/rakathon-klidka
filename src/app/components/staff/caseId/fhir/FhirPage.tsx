"use client";

import { FhirSkeleton } from "@/app/components/shared/LoadingStates";
import { FhirRecord } from "@/app/components/staff/caseId/fhir/FhirRecord";
import { useApi } from "@/lib/api/useApi";
import type { HospitalRecord } from "@/lib/fhir/hospital";

type Answer = { patientName: string; record: HospitalRecord | { error: string } };

// Ptá se API (jen AA, pacient podle rodného čísla z databáze), API se ptá nemocničního FHIR serveru.
export function FhirPage({ caseId }: { caseId: string }) {
  const { data, error } = useApi<Answer>(`/api/fhir/${caseId}?view=record`);
  if (error && !data) return <p className="text-base text-red-700">{error.message}</p>;
  if (!data) return <FhirSkeleton />;
  return <FhirRecord caseId={caseId} patientName={data.patientName} result={data.record} />;
}
