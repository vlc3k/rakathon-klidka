import { PatientHome } from "@/app/components/patient/PatientHome";

// Obsah je za přihlášením (SessionGate v layoutu) a data načítá klient z API, okamžitá navigace se tu nečeká.
export const instant = false;

// Přehled přípravy k vybranému zákroku. Data z API načítá PatientCaseProvider v layoutu.
export default function PatientPage() {
  return <PatientHome />;
}
