import { Suspense } from "react";
import { NavLink, NavLinkView } from "@/app/components/shared/NavLink";
import { ShellUser } from "@/app/components/shared/ShellUser";
import { SidebarToggle } from "@/app/components/shared/SidebarToggle";
import { cn } from "@/lib/utils";
import { KlidkaLogo } from "@/app/components/login/KlidkaLogo";

export type NavItem = { href: string; label: string; icon: React.ReactNode };

// Navigace plave: bílá bublina odsazená od okrajů obrazovky, nad šedým podkladem stránky (standard, rules/design.md).
// Desktop: boční panel, jde sbalit na úzký pruh s ikonami (SidebarToggle). Telefon: horní lišta a dole plovoucí
// pilulka s navigací od 3 položek. Klik na uživatele otevře menu s odhlášením.
// Kdo je přihlášený, ukazuje ShellUser podle session. Adresa (aktivní položka) je u dynamických rout
// (/staff/[caseId]) známá až za běhu, proto je navigace v Suspense a do té doby bez zvýraznění.
export function AppShell({
  nav,
  role,
  children,
}: {
  nav: NavItem[];
  role: string;
  children: React.ReactNode;
}) {
  const hasTabs = nav.length >= 3;
  const hrefs = nav.map((item) => item.href);
  const links = (variant: "sidebar" | "tab") => (
    <Suspense fallback={nav.map((item) => <NavLinkView key={item.href} {...item} variant={variant} />)}>
      {nav.map((item) => (
        <NavLink key={item.href} {...item} hrefs={hrefs} variant={variant} />
      ))}
    </Suspense>
  );

  return (
    <div className="flex flex-1 bg-muted">
      <aside className="sticky top-0 hidden h-dvh shrink-0 self-start pt-safe pb-safe lg:block print:hidden">
        <div className="h-full p-3">
          <div
            id="sidebar"
            className="flex h-full w-60 flex-col gap-8 overflow-hidden rounded-3xl bg-background px-3 py-5 motion-safe:transition-all motion-safe:duration-200 motion-safe:ease-smooth collapsed:w-18"
          >
            <div className="-my-1.5 flex items-center justify-between collapsed:justify-center">
              <KlidkaLogo className="px-3 text-2xl whitespace-nowrap collapsed:hidden" />
              <SidebarToggle />
            </div>
            <nav className="flex flex-col gap-1">{links("sidebar")}</nav>
            <ShellUser role={role} variant="sidebar" />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 bg-muted/80 pt-safe backdrop-blur-md lg:hidden print:hidden">
          <div className="flex h-14 items-center justify-between px-4">
            <KlidkaLogo className="text-2xl" />
            <ShellUser role={role} variant="bar" />
          </div>
        </header>

        <main className="flex-1 pb-safe">
          <div
            className={cn(
              "mx-auto w-full max-w-6xl px-4 py-6 md:px-8 lg:py-12",
              hasTabs && "pb-32 lg:pb-12",
            )}
          >
            {children}
          </div>
        </main>

        {hasTabs && (
          <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-10 pb-safe lg:hidden print:hidden">
            <div className="pointer-events-auto mx-3 mb-3 flex rounded-3xl bg-background/85 px-2 py-1 shadow-lg backdrop-blur-md">{links("tab")}</div>
          </nav>
        )}
      </div>
    </div>
  );
}
