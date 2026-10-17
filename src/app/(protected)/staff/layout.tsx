import { Suspense } from "react";
import { CalendarIcon, ListIcon, UserIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { AppShell, type NavItem } from "@/app/components/shared/AppShell";
import { PatientStoreProvider } from "@/app/components/shared/PatientStore";
import { PageSkeleton } from "@/app/components/shared/LoadingStates";
import { RoleGate } from "@/app/components/shared/RoleGate";

const nav: NavItem[] = [
  { href: "/staff", label: "Přehled", icon: <ListIcon className="size-5" /> },
  { href: "/staff/patients", label: "Spravovat pacienty", icon: <UserIcon className="size-5" /> },
  {
    href: "/staff/cases",
    label: "Spravovat zákroky",
    icon: <CalendarIcon className="size-5" />,
  },
];

// Jen pro lidi z AA, ověřeno na serveru (RoleGate); do té doby kostra stránky. Filtry a řazení seznamů (PatientStore) přežijí odchod na úpravu a návrat.
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell nav={nav} role="Anesteziologická ambulance">
      <Suspense fallback={<PageSkeleton />}>
        <RoleGate role="aa">
          <PatientStoreProvider>{children}</PatientStoreProvider>
        </RoleGate>
      </Suspense>
    </AppShell>
  );
}
