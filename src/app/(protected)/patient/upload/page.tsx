import { Suspense } from "react";
import { DocumentUpload } from "@/app/components/patient/upload/DocumentUpload";

// Obsah je za přihlášením (SessionGate v layoutu) a data načítá klient z API, okamžitá navigace se tu nečeká.
export const instant = false;

// Nahrání lékařské zprávy (skener → průběh → hotovo). Vede sem „Vyfotit zprávu“ na přehledu a karty
// zpráv od lékařů (?task=<id>). DocumentUpload čte ?task (useSearchParams), proto Suspense.
export default function UploadPage() {
  return (
    <Suspense fallback={null}>
      <DocumentUpload />
    </Suspense>
  );
}
