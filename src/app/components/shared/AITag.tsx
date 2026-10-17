import { Popover } from "@base-ui/react/popover";
import { SparkleIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { cn } from "@/lib/utils";

const DISCLAIMER = "Vytěžila AI z nahraných zpráv. Může se mýlit, ověřte v originálu.";

// Štítek „AI“ u všeho, co vytvořila AI (karty s vytěženými údaji, přepis dokumentu). Vždy stejný: sytě fialová
// pilulka s jiskrou, ať je na první pohled jasné, co je od AI. Na hover i na tap ukáže upozornění (jako InfoTip).
export function AITag({ children = DISCLAIMER, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={100}
        aria-label="Vytěžila AI, co to znamená"
        className={cn(
          "relative inline-flex h-5 shrink-0 cursor-help items-center gap-0.5 rounded-full bg-ai px-1.5 align-middle text-xs font-semibold tracking-normal text-ai-foreground outline-none select-none",
          // Malý štítek, ale klepnutí na telefonu chytí plocha kolem (44 px).
          "after:absolute after:-inset-3 focus-visible:ring-2 focus-visible:ring-ai focus-visible:ring-offset-2",
          className,
        )}
      >
        <SparkleIcon className="size-3" />
        AI
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} className="z-50">
          <Popover.Popup className="flex max-w-64 items-start gap-2 rounded-2xl bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg outline-none motion-safe:transition motion-safe:duration-200 motion-safe:ease-smooth data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <SparkleIcon className="mt-0.5 size-4 shrink-0 text-ai" />
            <span>{children}</span>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
