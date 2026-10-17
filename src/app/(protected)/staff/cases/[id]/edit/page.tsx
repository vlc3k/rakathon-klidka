import { Suspense } from "react";
import { CaseEditForm } from "@/app/components/staff/cases/id/edit/CaseEditForm";

// Stejně jako úprava pacienta: id z databáze, data načte formulář z API.
export const instant = false;

export default function EditCasePage({ params }: PageProps<"/staff/cases/[id]/edit">) {
  return <Suspense>{params.then(({ id }) => <CaseEditForm id={id} />)}</Suspense>;
}
