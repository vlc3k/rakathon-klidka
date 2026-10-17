import { InfoTip } from "@/app/components/shared/InfoTip";
import { cn } from "@/lib/utils";

// Seznam jako v Nastavení na iPhonu: zaoblený bílý blok, nahoře název a vpravo stav nebo akce,
// pod tím řádky oddělené čarou. Bez řádků zůstane jen hlavička (třeba „Žádné“).
export function ListCard({
  title,
  count,
  badge,
  info,
  aside,
  outlined = false,
  className,
  children,
}: {
  title?: string;
  count?: React.ReactNode;
  // Štítek za nadpisem (AITag u karet s údaji od AI).
  badge?: React.ReactNode;
  info?: React.ReactNode;
  aside?: React.ReactNode;
  // Obrys jen na bílém podkladu (pacientská část), kde by bílá karta jinak splynula. Ambulance má šedý podklad
  // a karty i tabulky jsou bez obrysu (rules/design.md).
  outlined?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("overflow-hidden rounded-2xl bg-background", outlined && "ring-1 ring-border", className)}>
      {title && (
        <div className="flex min-h-14 items-center justify-between gap-4 py-1.5 pr-3 pl-5">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            {title}
            {count !== undefined && (
              <span className="font-normal text-muted-foreground tabular-nums">{count}</span>
            )}
            {badge}
            {info && <InfoTip>{info}</InfoTip>}
          </h3>
          {aside && <div className="flex shrink-0 items-center gap-2 pr-2 text-sm">{aside}</div>}
        </div>
      )}
      {children && (
        <ul className={cn("divide-y divide-border", title && "border-t border-border")}>
          {children}
        </ul>
      )}
    </div>
  );
}

// Řádek: vlevo ikona, název a pod ním drobnost, vpravo hodnota nebo akce.
export function ListRow({
  icon,
  label,
  sub,
  trailing,
  className,
}: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  sub?: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
}) {
  return (
    <li className={cn("flex min-h-12 items-center gap-3 py-2.5 pr-3 pl-5", className)}>
      {icon}
      <div className="min-w-0 flex-1">
        <div className="text-base wrap-anywhere">{label}</div>
        {sub && <div className="text-sm text-muted-foreground">{sub}</div>}
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-2 pr-2">{trailing}</div>}
    </li>
  );
}
