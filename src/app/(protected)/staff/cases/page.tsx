import { CaseManager } from "@/app/components/staff/cases/CaseManager";

// Obsah je za přihlášením (SessionGate v layoutu) a data načítá klient z API, okamžitá navigace se tu nečeká.
export const instant = false;

export default function StaffCasesPage() {
  return <CaseManager />;
}
