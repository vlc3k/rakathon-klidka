import { Suspense } from "react";
import { DocumentDetail } from "@/app/components/staff/caseId/documents/documentId/DocumentDetail";

// Zákroky i dokumenty jsou v databázi, předem je neznáme. Parametry se čtou uvnitř Suspense, data načte klient z API.
export const instant = false;

export default function DocumentPage({ params }: PageProps<"/staff/[caseId]/documents/[documentId]">) {
  return <Suspense fallback={null}>{params.then(({ caseId, documentId }) => <DocumentDetail caseId={caseId} documentId={documentId} />)}</Suspense>;
}
