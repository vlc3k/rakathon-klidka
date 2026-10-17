import Link from "next/link";
import { CameraIcon, ClipboardIcon, DropIcon, EyeIcon, HeartIcon, ReportIcon, UploadIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { cn } from "@/lib/utils";

type VisitIcon = (props: { className?: string }) => React.ReactNode;

// Ikona podle typu dokumentu (db/catalog.ts), ostatní zprávy mají obecnou.
const ICONS: Partial<Record<string, VisitIcon>> = {
  preop_exam: ClipboardIcon,
  outpatient_report: ClipboardIcon,
  lab_report: DropIcon,
  ecg: HeartIcon,
};

// Ikona zprávy podle typu dokumentu (sdílí i přehled požadavků v detailu zákroku).
export const visitIcon = (documentType: string | null): VisitIcon => (documentType && ICONS[documentType]) || ReportIcon;

export type Visit = {
  id: string;
  title: string;
  documentType: string | null;
  // Zpráva je u nás (nahraná, nebo úkol uzavřela ambulance).
  done: boolean;
  // Datum nahrání (4. 11.), když ho známe.
  uploadedAt?: string;
  // Chybějící zpráva: kam vede „Vyfotit“ (skener). Nahraná: originál.
  uploadHref?: string;
  viewHref?: string;
  /** nahraný dokument (pro prohlížení v aplikaci) */
  documentId?: string;
};

// Zprávy od lékařů jako barevné karty. Vždy pod sebou, hotové se samy řadí na konec.
// Pacient (uploadHref): chybí zpráva → vyfotit / nahrát (skener). Nahraná zpráva → zobrazit.
export function VisitList({ visits }: { visits: Visit[] }) {
  const sorted = [...visits].sort((a, b) => Number(a.done) - Number(b.done));

  return (
    <ul className="flex flex-col gap-3">
      {sorted.map((visit) => {
        const Icon = visitIcon(visit.documentType);

        return (
          <li
            key={visit.id}
            className={cn(
              "flex min-h-20 items-center gap-4 rounded-2xl py-3 pr-3 pl-5",
              visit.done ? "bg-status-done text-status-done-foreground" : "bg-status-todo text-status-todo-foreground",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-base font-semibold">
                <Icon className="size-5 shrink-0" />
                <span>{visit.title}</span>
              </div>
              {visit.done && <div className="mt-1 text-base">{visit.uploadedAt ? `Nahráno ${visit.uploadedAt}` : "Hotovo"}</div>}
            </div>

            {visit.done ? (
              visit.viewHref && (
                <a
                  href={visit.viewHref}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Zobrazit zprávu: ${visit.title}`}
                  className="press flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-background/70 px-4 text-sm font-medium text-status-done-foreground outline-none select-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <EyeIcon className="size-4" />
                  Zobrazit
                </a>
              )
            ) : (
              visit.uploadHref && (
                <Link
                  href={visit.uploadHref}
                  aria-label={`Nahrát zprávu: ${visit.title}`}
                  className="press flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-status-todo-foreground px-4 text-sm font-medium text-status-todo outline-none select-none hover:bg-status-todo-foreground/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <CameraIcon className="size-4 lg:hidden" />
                  <UploadIcon className="hidden size-4 lg:block" />
                  <span className="lg:hidden">Vyfotit</span>
                  <span className="hidden lg:inline">Nahrát</span>
                </Link>
              )
            )}
          </li>
        );
      })}
    </ul>
  );
}
