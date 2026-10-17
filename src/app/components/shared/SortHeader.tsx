"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

// Záhlaví sloupce tabulky. Kliknutím se podle sloupce řadí, šipka ukazuje směr.
export function SortHeader<Key extends string>({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: Key;
  sort: { key: Key; dir: "asc" | "desc" };
  onSort: (key: Key) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  const Arrow = sort.dir === "asc" ? ArrowUp : ArrowDown;

  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      aria-label={`Seřadit podle: ${label}`}
      className={cn(
        "-mx-2 flex items-center gap-1 justify-self-start rounded-lg px-2 py-2 outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        active && "text-foreground",
        className,
      )}
    >
      {label}
      {active && <Arrow className="size-3.5" />}
    </button>
  );
}
