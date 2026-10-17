import { Suspense } from "react";
import { CaseForm } from "@/app/components/staff/cases/create/CaseForm";

// Obsah je za přihlášením (SessionGate v layoutu) a data načítá klient z API, okamžitá navigace se tu nečeká.
export const instant = false;

// CaseForm čte ?patient=… (useSearchParams), proto Suspense: zbytek stránky zůstane předrenderovaný.
export default function CreateCasePage() {
  return (
    <Suspense>
      <CaseForm />
    </Suspense>
  );
}
