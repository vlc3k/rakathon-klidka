import { InfoTip } from "@/app/components/shared/InfoTip";
import { cn } from "@/lib/utils";

// Sekce detailu: nadpis nad skupinou karet, vpravo stručný stav (kolik hotovo, kolik potvrzeno).
export function DetailSection({
  title,
  badge,
  info,
  aside,
  className,
  children,
}: {
  title: string;
  // Štítek hned za nadpisem (AITag u sekce s údaji od AI).
  badge?: React.ReactNode;
  info?: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex min-h-8 items-center justify-between gap-4">
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          {title}
          {badge}
          {info && <InfoTip>{info}</InfoTip>}
        </h2>
        {aside && <div className="text-sm text-muted-foreground">{aside}</div>}
      </div>
      {children}
    </section>
  );
}
