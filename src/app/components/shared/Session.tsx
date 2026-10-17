"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, UNAUTHORIZED_EVENT } from "@/lib/api/client";
import { clearApiCache } from "@/lib/api/useApi";
import type { Session } from "@/lib/api/types";

const SessionContext = createContext<Session | null>(null);

// Přihlášeného ověří layout na serveru (RoleGate → requireRole) a pošle ho sem; klient se na session neptá.
// Když session za chodu vyprší (API vrátí 401), pošle na přihlášení.
export function SessionProvider({ session, children }: { session: Session; children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    const expired = () => router.replace("/login");
    window.addEventListener(UNAUTHORIZED_EVENT, expired);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, expired);
  }, [router]);

  return <SessionContext value={session}>{children}</SessionContext>;
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession musí být uvnitř SessionProvider (RoleGate v layoutu)");
  return session;
}

// Odhlášení zruší session na serveru i v prohlížeči a vyčistí načtená data.
export function useLogout() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    await api.post("/api/auth/logout").catch(() => undefined);
    clearApiCache();
    router.replace("/login");
  }
  return { logout, busy };
}
