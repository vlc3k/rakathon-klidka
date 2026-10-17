import { cn } from "@/lib/utils";

// Kolik dokumentů z úkolů pacient nahrál. Zelená = nahráno, žlutá = chybí,
// červená = v nahraném je nález (např. nízký Hb, podle fronty z API).
export function UploadDots({ done, total, findings = [], className }: { done: number; total: number; findings?: string[]; className?: string }) {
  if (total === 0) return null;
  return (
    <span className={cn("inline-flex items-center gap-2", className)} title={findings.length ? `Nález: ${findings.join(", ")}` : undefined}>
      <span className="flex gap-1" aria-hidden>
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className={cn("size-2 rounded-full", index >= done ? "bg-status-todo-accent" : index < findings.length ? "bg-red-600" : "bg-status-done-accent")}
          />
        ))}
      </span>
      <span className="text-sm font-medium tabular-nums">
        {done}/{total}
        <span className="sr-only"> dokumentů nahráno{findings.length ? `, nález: ${findings.join(", ")}` : ""}</span>
      </span>
    </span>
  );
}
