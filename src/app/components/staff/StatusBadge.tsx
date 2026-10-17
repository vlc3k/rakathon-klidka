import { AlertIcon, ClockIcon, DoneIcon, QuestionIcon, WarningIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { cn } from "@/lib/utils";

export type Status = "ok" | "missing" | "alert" | "running" | "uncertain";

// Barvy stavů jsou dočasné, dokud nemáme paletu.
const config = {
  ok: { label: "V pořádku", icon: DoneIcon, className: "text-green-600 [--icon-accent:currentColor]" },
  missing: { label: "Doplnit", icon: AlertIcon, className: "text-amber-600 [--icon-accent:currentColor]" },
  alert: { label: "Pozor", icon: WarningIcon, className: "text-red-600 [--icon-accent:currentColor]" },
  running: { label: "Probíhá", icon: ClockIcon, className: "text-blue-600" },
  uncertain: { label: "Nejisté", icon: QuestionIcon, className: "text-amber-600" },
};

// unverified: hodnota v pořádku, ale AA ji zatím nepotvrdila proti dokumentu.
export function StatusBadge({ status, unverified = false }: { status: Status; unverified?: boolean }) {
  const { label, icon: Icon, className } = config[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap">
      <Icon className={cn("size-4", className)} />
      {label}
      {unverified && status === "ok" && <span className="font-normal text-muted-foreground">· neověřeno</span>}
    </span>
  );
}
