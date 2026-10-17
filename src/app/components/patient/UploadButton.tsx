import Link from "next/link";
import { CameraIcon, UploadIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { cn } from "@/lib/utils";

// Hlavní akce pacienta: vyfotit (telefon) nebo nahrát (desktop) zprávu od lékaře. Vede na skener.
export function UploadButton({ className }: { className?: string }) {
  return (
    <Link
      href="/patient/upload"
      className={cn(
        "press flex h-14 items-center justify-center gap-3 rounded-full bg-primary px-6 text-base font-semibold text-primary-foreground outline-none select-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
    >
      <CameraIcon className="size-5 lg:hidden" />
      <UploadIcon className="hidden size-5 lg:block" />
      <span className="lg:hidden">Vyfotit zprávu od lékaře</span>
      <span className="hidden lg:inline">Nahrát zprávu od lékaře</span>
    </Link>
  );
}
