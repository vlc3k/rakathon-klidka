import { PatientForm } from "@/app/components/shared/PatientForm";

// Obsah je za přihlášením (SessionGate v layoutu) a data načítá klient z API, okamžitá navigace se tu nečeká.
export const instant = false;

export default function CreatePatientPage() {
  return <PatientForm />;
}
