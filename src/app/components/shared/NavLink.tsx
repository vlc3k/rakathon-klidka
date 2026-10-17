"use client";

import Link from "next/link";
import { Tooltip } from "@base-ui/react/tooltip";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type Props = {
  href: string;
  hrefs: string[];
  label: string;
  icon: React.ReactNode;
  variant: "sidebar" | "tab";
};

// Aktivní je nejdelší odkaz, pod který adresa patří: /staff/cases/… svítí u Správy zákroků,
// ne zároveň u Přehledu (/staff). Proto NavLink zná odkazy celé navigace (`hrefs`).
export function NavLink(props: Props) {
  const pathname = usePathname();
  const matches = (link: string) => pathname === link || pathname.startsWith(link + "/");
  const active = matches(props.href) && !props.hrefs.some((link) => link.length > props.href.length && matches(link));
  return <NavLinkView {...props} active={active} />;
}

// Bez aktivní položky: náhrada, než je známá adresa (dynamické routy ji znají až za běhu, viz AppShell).
export function NavLinkView({ href, label, icon, variant, active = false }: Omit<Props, "hrefs"> & { active?: boolean }) {
  const link = (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "press outline-none select-none focus-visible:ring-2 focus-visible:ring-ring transition-colors motion-safe:ease-smooth",
        variant === "sidebar"
          ? "flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium whitespace-nowrap collapsed:justify-center collapsed:px-0"
          : "flex min-h-12 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium",
        // Aktivní položka má podklad hned, bez přejezdu: posuvný podklad v přilepeném panelu cestoval
        // při scrollu stránky (třeba když stránka dokumentu přejede k vybranému údaji).
        variant === "sidebar" && (active ? "bg-muted" : "hover:bg-muted"),
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {variant === "sidebar" ? <span className="collapsed:sr-only">{label}</span> : label}
    </Link>
  );
  if (variant !== "sidebar") return link;
  // Ve sbaleném panelu je vidět jen ikona: název vyjede vpravo hned při najetí (i při fokusu z klávesnice).
  // V rozbaleném panelu je název vidět, bublina se neukazuje (CSS varianta collapsed:).
  return (
    <Tooltip.Root>
      <Tooltip.Trigger delay={0} closeDelay={0} render={link} />
      <Tooltip.Portal>
        <Tooltip.Positioner side="right" sideOffset={14} className="z-50">
          <Tooltip.Popup className="hidden rounded-lg bg-foreground px-2.5 py-1.5 text-sm font-medium whitespace-nowrap text-background collapsed:block">{label}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
