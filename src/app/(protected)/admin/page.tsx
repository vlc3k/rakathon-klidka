import { AdminOverview } from "@/app/components/admin/AdminOverview";

// Obsah je za přihlášením (SessionGate v layoutu) a data načítá klient z API, okamžitá navigace se tu nečeká.
export const instant = false;

export default function AdminPage() {
  return <AdminOverview />;
}
