import { Suspense } from "react";
import { CaseExport } from "@/app/components/staff/caseId/export/CaseExport";

export const instant = false;

export default function ExportPage({ params }: PageProps<"/staff/[caseId]/export">) {
  return <Suspense fallback={null}>{params.then(({ caseId }) => <CaseExport caseId={caseId} />)}</Suspense>;
}
