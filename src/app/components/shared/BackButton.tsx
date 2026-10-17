"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

// Formuláře se otevírají z víc míst (detail, správa pacientů, správa zákroků, úprava pacienta),
// proto se po uložení i zrušení vrací, odkud přišly. Otevřené napřímo (nová karta) nemají
// kam, jdou na `fallbackHref`.
export function useGoBack(fallbackHref: string) {
  const router = useRouter();
  return () => {
    if (window.history.length > 1) router.back();
    else router.push(fallbackHref);
  };
}

export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press -ml-2 inline-flex h-11 w-fit items-center gap-1 rounded-full pr-3 pl-1 text-base text-muted-foreground outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronLeft className="size-5" />
      Zpět
    </button>
  );
}
