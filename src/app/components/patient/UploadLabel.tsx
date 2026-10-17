import { CameraIcon, UploadIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { cn } from "@/lib/utils";

// Popisek tlačítka, které vede na nahrání papíru: na telefonu se fotí („Vyfotit“), na počítači nahrává
// ze souboru nebo přes QR telefonem („Nahrát“). Mění se jen text a ikona, cíl je stejný (rules/design.md).
export function UploadLabel({ phone, computer, iconClassName = "size-5" }: { phone: string; computer: string; iconClassName?: string }) {
  return (
    <>
      <CameraIcon className={cn("shrink-0 lg:hidden", iconClassName)} />
      <UploadIcon className={cn("hidden shrink-0 lg:block", iconClassName)} />
      <span className="lg:hidden">{phone}</span>
      <span className="hidden lg:inline">{computer}</span>
    </>
  );
}
