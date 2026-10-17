import { SessionProvider } from "@/app/components/shared/Session";
import { requireRole } from "@/lib/server/auth";
import type { Role } from "@/lib/api/types";

// Obsah jen pro přihlášeného s danou rolí, ověřený na serveru (requireRole). Patří do <Suspense>
// v layoutu: fallback (kostra stránky) je vidět hned, obsah dorazí ve stejné odpovědi.
export async function RoleGate({ role, children }: { role: Role | Role[]; children: React.ReactNode }) {
  const user = await requireRole(role);
  return <SessionProvider session={user}>{children}</SessionProvider>;
}
