"use client";

import Link from "next/link";
import { Menu } from "@base-ui/react/menu";
import { useSession } from "@/app/components/shared/Session";
import { MENU_ITEM, ShellUser } from "@/app/components/shared/ShellUser";
import { CameraIcon, FamilyIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { KlidkaLogo } from "@/app/components/login/KlidkaLogo";
import { PATIENT_FRAME } from "@/app/components/patient/frame";
import { cn } from "@/lib/utils";

// Rám pacientské aplikace. Pacient nemá boční panel, jeho aplikace je jedna obrazovka.
// - Telefon a tablet: dole plovoucí bublina (rounded-full) jako v mobilní aplikaci, celá na dosah palce. Vlevo logo
//   (vede na přehled), uprostřed velké tlačítko „Vyfotit“ (nahrání podkladu), vpravo profil: menu se jménem,
//   pozváním pomocníka a „Odhlásit“, takže se na odhlášení omylem neklepne.
// - Desktop: nahoře logo a vpravo profil se jménem. Nahrání je v levém sloupci přehledu a u každé karty.
// Pomocník z rodiny má nahoře vždy vidět, za koho jedná.
export function PatientShell({ children }: { children: React.ReactNode }) {
  const { displayName, role, helping } = useSession();
  const roleLabel = role === "helper" ? "Pomocník z rodiny" : "Pacient";
  // Pomocníky zve jen pacient sám (API), pomocník tuhle položku nevidí.
  const extra = role === "patient" && (
    <Menu.Item render={<Link href="/patient/pomocnik" />} className={MENU_ITEM}>
      <FamilyIcon className="size-5" />
      Pozvat pomocníka
    </Menu.Item>
  );
  return (
    <>
      {helping && (
        <p className="bg-muted px-4 py-2 text-center text-lg">
          Pomáháte: <span className="font-semibold">{helping.patientName}</span>
        </p>
      )}
      <header className={cn(PATIENT_FRAME, "hidden h-20 items-center justify-between lg:flex")}>
        <HomeLogo logoClassName="text-3xl" />
        <ShellUser variant="patient" name={displayName} role={roleLabel} extra={extra} />
      </header>
      {/* Na telefonu místo pod obsahem, ať poslední karta nezůstane pod spodní bublinou. */}
      <main className="flex-1 pb-safe">
        <div className={cn(PATIENT_FRAME, "pt-6 pb-32 lg:pt-8 lg:pb-0")}>{children}</div>
      </main>
      {/* Obsah pod bublinou plynule mizí do bílé (přechod přes spodní okraj), klikat jde jen na bublinu. */}
      <nav
        aria-label="Hlavní nabídka"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center bg-linear-to-t from-background from-40% to-transparent px-4 pt-12 pb-safe lg:hidden"
      >
        <div className="pointer-events-auto mb-4 grid h-18 w-full max-w-md grid-cols-3 items-center rounded-full bg-background py-2 pr-2 pl-5 shadow-lg ring-1 ring-foreground/5">
          <HomeLogo className="justify-self-start" logoClassName="text-2xl" />
          <Link
            href="/patient/upload"
            className="press flex h-14 items-center justify-center gap-2 justify-self-center rounded-full bg-primary px-6 text-lg font-semibold text-primary-foreground outline-none select-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <CameraIcon className="size-6 shrink-0" />
            Vyfotit
          </Link>
          <div className="justify-self-end">
            <ShellUser variant="dock" name={displayName} role={roleLabel} extra={extra} />
          </div>
        </div>
      </nav>
    </>
  );
}

function HomeLogo({ className, logoClassName }: { className?: string; logoClassName: string }) {
  return (
    <Link href="/patient" aria-label="Klidka, přehled přípravy" className={cn("press -ml-1 rounded-lg px-1 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring", className)}>
      <KlidkaLogo className={logoClassName} />
    </Link>
  );
}
