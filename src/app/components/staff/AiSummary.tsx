import { SparkleIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { InfoTip } from "@/app/components/shared/InfoTip";

// Text od AI musí jít poznat na první pohled: vlastní blok, jiskra a štítek.
// Nikdy ho nemíchej s ověřenými údaji.
export function AiSummary({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl bg-muted p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <SparkleIcon className="size-3.5" />
        AI shrnutí
        <InfoTip>Vygenerovala AI z nahraných zpráv. Může se mýlit, ověřte v originálu.</InfoTip>
      </div>
      <p className="text-sm">{children}</p>
    </section>
  );
}
