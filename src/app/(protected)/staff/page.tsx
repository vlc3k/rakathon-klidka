import { QueueOverview } from "@/app/components/staff/QueueOverview";

// Obsah je za přihlášením (SessionGate v layoutu) a data načítá klient z API, okamžitá navigace se tu nečeká.
export const instant = false;

export default function StaffPage() {
  return <QueueOverview />;
}
