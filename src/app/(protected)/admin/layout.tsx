import { Suspense } from "react";
import { SettingsIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { AppShell, type NavItem } from "@/app/components/shared/AppShell";
import { PageSkeleton } from "@/app/components/shared/LoadingStates";
import { RoleGate } from "@/app/components/shared/RoleGate";

const nav: NavItem[] = [
  { href: "/admin", label: "Administrace", icon: <SettingsIcon className="size-5" /> },
];

// Šablony a pravidla spravuje kdokoli z AA (role admin zatím není), ověřeno na serveru přes RoleGate.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell nav={nav} role="Administrace">
      <Suspense fallback={<PageSkeleton />}>
        <RoleGate role="aa">{children}</RoleGate>
      </Suspense>
    </AppShell>
  );
}
