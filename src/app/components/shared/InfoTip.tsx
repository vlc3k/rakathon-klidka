import { Popover } from "@base-ui/react/popover";
import { InfoIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { cn } from "@/lib/utils";

// Drobný text pod ikonou (i). Otevře se na hover i na tap. `icon` jinou ikonu (otazník u „jak se to počítá“),
// `wide` dá širší bublinu pro legendu o víc řádcích a dvou sloupcích.
export function InfoTip({
  children,
  label = "Více informací",
  icon,
  wide = false,
}: {
  children: React.ReactNode;
  label?: string;
  icon?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={100}
        aria-label={label}
        className="-m-3.5 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {icon ?? <InfoIcon className="size-4" />}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={4} className="z-50">
          <Popover.Popup className={cn(wide ? "max-w-96" : "max-w-64", "rounded-2xl bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg outline-none motion-safe:transition motion-safe:duration-200 motion-safe:ease-smooth data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0")}>
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
