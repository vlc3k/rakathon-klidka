import { cn } from "@/lib/utils";

// Značka Klidka: místo všech pokynů jedna věta od člověka z ambulance, a pacient má klid.
// Korálová tečka je ta jedna věta, za kterou už nic nepřijde. Jediné místo s písmem Bricolage, text je všude v Lexendu.
export function KlidkaLogo({ className }: { className?: string }) {
  return (
    <span className={cn("font-brand text-4xl leading-none tracking-tight select-none", className)} aria-label="Klidka">
      <span aria-hidden>
        Klidka<span className="text-brand-dot">.</span>
      </span>
    </span>
  );
}
