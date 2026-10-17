import { Suspense } from "react";
import { CaseDetail } from "@/app/components/staff/CaseDetail";

// Zákroky jsou v databázi, předem je neznáme. Parametr se čte uvnitř Suspense, data načte klient z API.
export const instant = false;

export default function CasePage({ params }: PageProps<"/staff/[caseId]">) {
  return <Suspense fallback={null}>{params.then(({ caseId }) => <CaseDetail caseId={caseId} />)}</Suspense>;
}
