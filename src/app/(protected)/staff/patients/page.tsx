import { PatientManager } from "@/app/components/staff/patients/PatientManager";

// Obsah je za přihlášením (SessionGate v layoutu) a data načítá klient z API, okamžitá navigace se tu nečeká.
export const instant = false;

export default function StaffPatientsPage() {
  return <PatientManager />;
}
