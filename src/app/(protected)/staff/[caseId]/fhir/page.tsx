import { Suspense } from "react";
import { FhirPage } from "@/app/components/staff/caseId/fhir/FhirPage";

// Co o pacientovi teď vrací nemocniční FHIR server, čitelně, s originálem každého záznamu.
// K ověření, že „Z nemocnice“ opravdu tahá data živě z nemocnice. Data načte klient z API při každém otevření.
export const instant = false;

export default function Page({ params }: PageProps<"/staff/[caseId]/fhir">) {
  return <Suspense fallback={null}>{params.then(({ caseId }) => <FhirPage caseId={caseId} />)}</Suspense>;
}
