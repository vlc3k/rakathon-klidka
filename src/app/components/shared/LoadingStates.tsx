"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { PATIENT_FRAME } from "@/app/components/patient/frame";

// Načítání dat z API: místo textu „Načítám…“ kostra stránky (skeleton). Každá kostra kopíruje rozložení
// hotové stránky (stejné odstupy, karty, řádky a výšky), takže po načtení nic neposkočí, jen se kosti
// vymění za obsah. Kosti jsou průsvitně tmavé, takže fungují na šedém podkladu i v bílé kartě,
// a jemně pulzují (jen motion-safe). Čtečka uslyší jen „Načítám“.
//
// Kde co je:
// - PageSkeleton: vybere kostru podle adresy (fallback layoutu, než server ověří přihlášení; úvodní přesměrování).
// - Kostry celých stránek: pacient (přehled, podstránka), ambulance (přehled, detail zákroku, seznamy,
//   formuláře, tisk, data z nemocnice), administrace.
// - Kostry částí, které se načítají uvnitř hotové stránky: tabulky, karta pacienta, výběr pacienta, šablony.
// - SmoothImage: obrázek ze serveru, místo prázdného místa kost a po načtení rychlé zaostření.

// Šířky kostí se v řádcích střídají, ať seznam nevypadá jako mřížka stejných pruhů.
const WIDTHS = ["w-3/4", "w-1/2", "w-2/3", "w-4/5", "w-3/5", "w-2/5"];
const width = (index: number, offset = 0) => WIDTHS[(index + offset) % WIDTHS.length];

export function Bone({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block rounded-md bg-foreground/8 motion-safe:animate-pulse", className)} />;
}

// Obrázek ze serveru (dokument, fotka, podpis). Dokud se načítá, je místo něj pulzující kost. Po načtení se
// obrázek zvolna prolne přes kost a zaostří (`unblur`, 0,6 s) a kost pod ním se rozplyne, nic neskočí.
// Co už je v mezipaměti, ukáže se hned bez efektu.
// `className`: rámeček (velikost, zaoblení, podklad), `imgClassName`: obrázek uvnitř (třeba object-cover).
// `placeholderClassName`: rozměr jen na dobu načítání, když obrázek sám výšku nemá (dokument: aspect-3/4).
type ImageState = "loading" | "loaded" | "cached" | "failed";

export function SmoothImage({
  className,
  imgClassName,
  placeholderClassName,
  onLoad,
  onError,
  ref,
  alt,
  ...props
}: React.ComponentProps<"img"> & { imgClassName?: string; placeholderClassName?: string }) {
  const [state, setState] = useState<ImageState>("loading");
  const node = useRef<HTMLImageElement | null>(null);

  // Načtený dřív, než se stránka oživila (mezipaměť, návrat zpět): onLoad už nepřijde.
  useEffect(() => {
    const img = node.current;
    if (img?.complete) setState(img.naturalWidth ? "cached" : "failed");
  }, []);

  return (
    <span className={cn("relative block overflow-hidden", className, state === "loading" && placeholderClassName)}>
      <span
        aria-hidden
        className={cn(
          "absolute inset-0 bg-foreground/8 transition-opacity duration-700 ease-smooth",
          state === "loading" ? "motion-safe:animate-pulse" : "opacity-0",
        )}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        {...props}
        alt={alt}
        ref={(element) => {
          node.current = element;
          if (typeof ref === "function") ref(element);
          else if (ref) ref.current = element;
        }}
        onLoad={(event) => {
          setState((current) => (current === "loading" ? "loaded" : current));
          onLoad?.(event);
        }}
        onError={(event) => {
          setState("failed");
          onError?.(event);
        }}
        className={cn("relative block", imgClassName, state === "loading" && "opacity-0", state === "loaded" && "motion-safe:animate-unblur")}
      />
    </span>
  );
}

// Obal každé kostry: jednou oznámí načítání čtečce. Bez vlastní animace vstupu: po sobě jdou dvě stejné kostry
// (fallback layoutu a pak stránka, která čeká na data) a výměna musí být neviditelná.
function Skeleton({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy className={className}>
      <span className="sr-only">Načítám</span>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Výběr podle adresy
// ---------------------------------------------------------------------------

// Kostra stránky podle adresy. `framed`: pacientská stránka ještě bez rámu (PatientShell se vykreslí až po ověření přihlášení).
export function PageSkeleton({ framed = false }: { framed?: boolean }) {
  const path = usePathname();

  if (path === "/patient" || path.startsWith("/patient/")) {
    const page = path === "/patient" ? <PatientHomeSkeleton /> : <PatientPageSkeleton />;
    if (!framed) return page;
    return (
      <>
        <div className={cn(PATIENT_FRAME, "hidden h-20 items-center justify-between lg:flex")}>
          <Bone className="h-8 w-28 rounded-lg" />
          <Bone className="h-9 w-44 rounded-full" />
        </div>
        <div className={cn(PATIENT_FRAME, "pt-6 pb-32 lg:pt-8 lg:pb-0")}>{page}</div>
        {/* Spodní bublina (PatientShell) na telefonu a tabletu. */}
        <div className="pointer-events-none fixed inset-x-0 bottom-0 flex justify-center bg-linear-to-t from-background from-40% to-transparent px-4 pt-12 pb-safe lg:hidden">
          <Bone className="mb-4 h-18 w-full max-w-md rounded-full" />
        </div>
      </>
    );
  }
  if (path === "/staff") return <QueueSkeleton />;
  if (path === "/staff/patients") return <ManagerSkeleton columns={PATIENT_COLUMNS} />;
  if (path === "/staff/cases") return <ManagerSkeleton columns={CASE_COLUMNS} filters="range" />;
  if (/^\/staff\/(patients|cases)\/(create|[^/]+\/edit)$/.test(path)) return <FormSkeleton />;
  if (path.endsWith("/export")) return <PrintSkeleton />;
  if (path.endsWith("/fhir")) return <FhirSkeleton />;
  if (/^\/staff\/[^/]+\/documents\/[^/]+$/.test(path)) return <DocumentSkeleton />;
  if (path.startsWith("/staff/")) return <CaseDetailSkeleton />;
  if (path === "/admin") return <AdminSkeleton />;
  return <GenericSkeleton />;
}

// ---------------------------------------------------------------------------
// Společné kousky
// ---------------------------------------------------------------------------

// Nadpis stránky (text-3xl, na desktopu text-4xl).
function TitleBone({ className }: { className?: string }) {
  return <Bone className={cn("h-9 w-56 rounded-lg lg:h-10", className)} />;
}

// Odkaz zpět (BackButton, „Přehled“).
function BackBone() {
  return <Bone className="h-11 w-28 rounded-full" />;
}

// Nadpis sekce (DetailSection: text-xl, vpravo drobnost).
function SectionHeadBone({ aside = true, className }: { aside?: boolean; className?: string }) {
  return (
    <div className={cn("flex min-h-8 items-center justify-between gap-4", className)}>
      <Bone className="h-6 w-40" />
      {aside && <Bone className="h-4 w-20" />}
    </div>
  );
}

// Seznam jako v Nastavení (ListCard): řádky s kolečkem stavu, dvěma řádky textu a případně tlačítkem.
function ListRows({ rows, dot = true, action = false, minHeight = "min-h-16" }: { rows: number; dot?: boolean; action?: boolean; minHeight?: string }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-background">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className={cn("flex items-center gap-4 px-4 py-3", minHeight)}>
          {dot && <Bone className="size-6 shrink-0 rounded-full" />}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Bone className={cn("h-4", width(i))} />
            <Bone className={cn("h-3 bg-foreground/5", width(i, 2))} />
          </div>
          {action && i % 2 === 0 && <Bone className="h-11 w-24 shrink-0 rounded-full" />}
        </li>
      ))}
    </ul>
  );
}

function Section({ rows, dot, action, aside }: { rows: number; dot?: boolean; action?: boolean; aside?: boolean }) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeadBone aside={aside} />
      <ListRows rows={rows} dot={dot} action={action} />
    </section>
  );
}

// Pole formuláře (TextField): popisek a šedé pole.
function FieldBone({ index }: { index: number }) {
  return (
    <div className="flex flex-col gap-2">
      <Bone className={cn("h-3.5", index % 2 ? "w-20" : "w-28")} />
      <Bone className="h-12 w-full rounded-xl bg-foreground/5" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pacient
// ---------------------------------------------------------------------------

// Přehled pacienta (PatientDashboard, jednoduchá úroveň): zpráva z ambulance s tlačítky, pod ní (na desktopu vpravo) karty.
export function PatientHomeSkeleton() {
  return (
    <Skeleton className="flex flex-col gap-12 pb-16 lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-16">
      <div className="flex flex-col gap-8 lg:col-span-5">
        <Bone className="h-5 w-56" />
        <div className="flex flex-col gap-4">
          <Bone className="h-6 w-28" />
          <div className="flex flex-col gap-3">
            <Bone className="h-8 w-full max-w-xs rounded-lg sm:h-9" />
            <Bone className="h-8 w-64 rounded-lg sm:h-9" />
            <Bone className="h-8 w-52 rounded-lg sm:h-9" />
          </div>
          <Bone className="h-5 w-64" />
        </div>
        <Bone className="h-16 w-full max-w-sm rounded-full" />
        <div className="flex flex-col gap-3">
          <Bone className="h-14 w-full max-w-sm rounded-2xl" />
          <Bone className="h-14 w-full max-w-sm rounded-2xl" />
        </div>
      </div>
      <div className="flex flex-col gap-4 lg:col-span-7">
        <div className="flex items-center justify-between gap-4">
          <Bone className="h-7 w-64 rounded-lg" />
          <Bone className="h-5 w-24" />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <Bone key={i} className={cn("w-full rounded-2xl", i < 2 ? "h-36 sm:h-28" : "h-24 sm:h-20")} />
        ))}
      </div>
    </Skeleton>
  );
}

// Podstránka pacienta (souhlas, fotky úst, nahrání, článek): zpět, nadpis, věta a velký blok.
export function PatientPageSkeleton() {
  return (
    <Skeleton className="flex flex-col gap-6 pb-12">
      <BackBone />
      <div className="flex flex-col gap-3">
        <TitleBone className="w-64" />
        <Bone className="h-4 w-full max-w-sm" />
      </div>
      <Bone className="h-80 w-full rounded-2xl bg-background" />
      <Bone className="h-12 w-full rounded-full" />
    </Skeleton>
  );
}

// ---------------------------------------------------------------------------
// Ambulance
// ---------------------------------------------------------------------------

// Sloupce tabulek (součet 12) jako v hotových tabulkách.
const QUEUE_COLUMNS = [5, 2, 2, 3];
const PATIENT_COLUMNS = [4, 4, 2, 2];
const CASE_COLUMNS = [2, 3, 4, 3];

const SPAN: Record<number, string> = {
  2: "md:col-span-2",
  3: "md:col-span-3",
  4: "md:col-span-4",
  5: "md:col-span-5",
};

// Tabulka: na telefonu řádky se dvěma řádky textu a hodnotou vpravo, od md: sloupce s hlavičkou.
export function TableSkeleton({ columns, rows = 6 }: { columns: number[]; rows?: number }) {
  return (
    <Skeleton className="overflow-hidden rounded-2xl bg-background">
      <div className="hidden items-center gap-4 border-b border-border px-6 py-4 md:flex">
        <div className="grid flex-1 grid-cols-12 gap-4">
          {columns.map((span, i) => (
            <div key={i} className={SPAN[span]}>
              <Bone className="h-3.5 w-16 bg-foreground/5" />
            </div>
          ))}
        </div>
        <span className="size-5 shrink-0" />
      </div>
      <ul className="divide-y divide-border">
        {Array.from({ length: rows }, (_, row) => (
          <li key={row} className="flex min-h-16 items-center gap-4 px-4 py-3 md:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-4 md:grid md:grid-cols-12">
              {columns.map((span, i) => {
                const first = i === 0;
                const last = i === columns.length - 1;
                return (
                  <div key={i} className={cn(SPAN[span], first ? "flex min-w-0 flex-1 flex-col gap-2" : last ? "shrink-0" : "hidden md:block")}>
                    {first ? (
                      <>
                        <Bone className={cn("h-4", width(row))} />
                        <Bone className={cn("h-3 bg-foreground/5", width(row, 3))} />
                      </>
                    ) : (
                      <Bone className={cn("h-4", last ? "w-16 md:w-3/4" : width(row, i))} />
                    )}
                  </div>
                );
              })}
            </div>
            <Bone className="size-5 shrink-0 rounded-full bg-foreground/5" />
          </li>
        ))}
      </ul>
    </Skeleton>
  );
}

export const QueueTableSkeleton = () => <TableSkeleton columns={QUEUE_COLUMNS} />;
export const PatientTableSkeleton = () => <TableSkeleton columns={PATIENT_COLUMNS} />;
export const CaseTableSkeleton = () => <TableSkeleton columns={CASE_COLUMNS} />;

// Přehled ambulance: nadpis, tři čísla a fronta.
export function QueueSkeleton() {
  return (
    <Skeleton className="flex flex-col gap-10">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <TitleBone className="w-40" />
        <QueueStatsSkeleton />
      </div>
      <QueueTableSkeleton />
    </Skeleton>
  );
}

// Tři velká čísla vpravo nahoře v přehledu.
export function QueueStatsSkeleton() {
  return (
    <div aria-hidden className="grid grid-cols-3 gap-4 lg:flex lg:gap-12">
      {["w-12", "w-10", "w-14"].map((w) => (
        <div key={w} className="flex flex-col gap-2">
          <Bone className={cn("h-10 rounded-lg", w)} />
          <Bone className="h-3.5 w-16 bg-foreground/5" />
        </div>
      ))}
    </div>
  );
}

// Záložka Aktivita v detailu zákroku: karta s kalendářem (nadpis, filtry, mřížka a legenda) a seznam vybraného dne.
export function ActivitySkeleton() {
  return (
    <Skeleton className="flex flex-col gap-8">
      <div className="flex flex-col gap-5 rounded-2xl bg-background p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <Bone className="h-7 w-40" />
          <Bone className="h-11 w-44 rounded-full" />
        </div>
        <Bone className="h-80 w-full rounded-xl" />
        <Bone className="ml-auto h-3 w-56 bg-foreground/5" />
      </div>
      <Section rows={3} dot={false} aside={false} />
    </Skeleton>
  );
}

// Správa pacientů a zákroků: nadpis s počtem, tlačítko, hledání a tabulka.
function ManagerSkeleton({ columns, filters = "chips" }: { columns: number[]; filters?: "chips" | "range" }) {
  return (
    <Skeleton className="flex flex-col gap-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3">
          <TitleBone className="w-64" />
          <Bone className="h-4 w-24" />
        </div>
        <Bone className="h-12 w-full rounded-full sm:w-48" />
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Bone className="h-12 flex-1 rounded-xl bg-background" />
          {filters === "chips" && <Bone className="h-12 w-full rounded-xl bg-background sm:w-48" />}
        </div>
        <div className="flex gap-2">
          <Bone className="h-11 w-32 rounded-full bg-background" />
          <Bone className="h-11 w-32 rounded-full bg-background" />
        </div>
        <TableSkeleton columns={columns} />
      </div>
    </Skeleton>
  );
}

// Detail zákroku v jednom sloupci: zpět a úpravy, hlavička, další krok, připravenost, vyžádané dokumenty, vytěžené údaje, od pacienta.
export function CaseDetailSkeleton() {
  return (
    <Skeleton className="flex flex-col gap-8">
      <div className="-mb-4 flex items-center justify-between gap-2">
        <BackBone />
        <div className="flex gap-2">
          <Bone className="h-11 w-28 rounded-full bg-background sm:w-40" />
          <Bone className="h-11 w-28 rounded-full bg-background sm:w-36" />
        </div>
      </div>

      <div className="flex flex-col gap-3 py-4 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
        <div className="flex min-w-0 flex-col gap-2">
          <Bone className="h-7 w-56 rounded-lg lg:h-8" />
          <Bone className="h-4 w-72 max-w-full" />
        </div>
        <div className="flex items-center gap-6">
          <div className="flex flex-col gap-1.5">
            <Bone className="h-6 w-16" />
            <Bone className="h-3 w-24 bg-foreground/5" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Bone className="h-6 w-20" />
            <Bone className="h-3 w-16 bg-foreground/5" />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-12">
        <div className="flex flex-col gap-4 rounded-2xl bg-background p-6 lg:p-8">
          <Bone className="h-6 w-48" />
          <Bone className="h-4 w-full" />
          <Bone className="h-4 w-2/3" />
          <div className="flex flex-wrap gap-2 pt-2">
            <Bone className="h-11 w-40 rounded-full" />
            <Bone className="h-11 w-32 rounded-full bg-foreground/5" />
          </div>
        </div>

        <div className="flex flex-col gap-5 rounded-2xl bg-background p-6 lg:p-8">
          <div className="flex items-center justify-between gap-4">
            <Bone className="h-6 w-40" />
            <Bone className="h-8 w-24 rounded-full" />
          </div>
          <Bone className="h-3 w-full rounded-full bg-foreground/5" />
          <Bone className="h-4 w-1/2" />
        </div>

        <Section rows={3} />

        <section className="flex flex-col gap-3">
          <SectionHeadBone />
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <ListRows rows={2} dot={false} />
            <ListRows rows={4} dot={false} />
          </div>
        </section>
        <Section rows={2} aside={false} />
      </div>
    </Skeleton>
  );
}

// Stránka jednoho dokumentu: zpět, nadpis, vlevo karty vytěžených údajů, vpravo originál.
export function DocumentSkeleton() {
  return (
    <Skeleton className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <BackBone />
        <TitleBone className="w-72" />
        <Bone className="h-4 w-48" />
      </div>
      <div className="flex flex-col gap-10 lg:grid lg:grid-cols-12 lg:items-start lg:gap-10">
        <div className="flex flex-col gap-4 lg:col-span-5">
          <SectionHeadBone />
          <ListRows rows={4} dot={false} />
          <ListRows rows={2} dot={false} />
        </div>
        <Bone className="aspect-3/4 w-full rounded-2xl bg-background lg:col-span-7" />
      </div>
    </Skeleton>
  );
}

// Formulář pacienta nebo zákroku: nadpis, karta s poli a karta souvisejícího záznamu.
// `back`: i s odkazem zpět (celá stránka); bez něj, když ho formulář už ukazuje sám.
export function FormSkeleton({ back = true }: { back?: boolean }) {
  return (
    <Skeleton className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-4">
        {back && <BackBone />}
        <TitleBone className="w-64" />
      </div>
      <section className="flex flex-col gap-3">
        <Bone className="h-6 w-28" />
        <div className="flex flex-col gap-4 rounded-2xl bg-background p-5 md:p-6">
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <FieldBone key={i} index={i} />
            ))}
          </div>
          <FieldBone index={1} />
        </div>
      </section>
      <section className="flex flex-col gap-3">
        <Bone className="h-6 w-28" />
        <EditCardSkeleton />
      </section>
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Bone className="h-12 w-full rounded-full sm:w-40" />
      </div>
    </Skeleton>
  );
}

// Karta pacienta v novém zákroku (EditCard): jméno, drobnost a vpravo tlačítko.
export function EditCardSkeleton() {
  return (
    <Skeleton className="flex items-center justify-between gap-4 rounded-2xl bg-background p-5 md:p-6">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Bone className="h-4 w-48" />
        <Bone className="h-3.5 w-64 max-w-full bg-foreground/5" />
      </div>
      <Bone className="h-11 w-28 shrink-0 rounded-full bg-foreground/5" />
    </Skeleton>
  );
}

// Výběr pacienta pro nový zákrok: řádky s kolečkem volby, jménem a identifikátorem.
export function PatientPickerSkeleton() {
  return (
    <Skeleton className="flex flex-col gap-1">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex min-h-14 items-center gap-3 rounded-xl px-3 py-2">
          <Bone className="size-5 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Bone className={cn("h-4", width(i))} />
            <Bone className={cn("h-3 bg-foreground/5", width(i, 3))} />
          </div>
        </div>
      ))}
    </Skeleton>
  );
}

// Tiskové shrnutí: bílý list s lištou, hlavičkou pacienta a tabulkami.
export function PrintSkeleton() {
  return (
    <Skeleton className="mx-auto flex max-w-3xl flex-col gap-6 rounded-2xl bg-background p-8">
      <div className="flex items-center justify-between">
        <Bone className="h-4 w-32" />
        <Bone className="h-11 w-36 rounded-full" />
      </div>
      <div className="flex flex-col gap-2 border-b border-border pb-4">
        <Bone className="h-3.5 w-72 max-w-full bg-foreground/5" />
        <Bone className="h-7 w-56 rounded-lg" />
        <Bone className="h-3.5 w-80 max-w-full bg-foreground/5" />
      </div>
      {[5, 4, 3].map((rows, block) => (
        <div key={block} className="flex flex-col gap-3">
          <Bone className="h-5 w-36" />
          <div className="flex flex-col divide-y divide-border">
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className="flex items-center justify-between gap-4 py-2">
                <Bone className={cn("h-3.5", width(i + block))} />
                <Bone className="h-3.5 w-16 bg-foreground/5" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </Skeleton>
  );
}

// Data z nemocničního systému (FHIR): zpět, nadpis, karta serveru a dva sloupce seznamů.
export function FhirSkeleton() {
  return (
    <Skeleton className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <BackBone />
        <TitleBone className="w-72" />
      </div>
      <div className="flex flex-col gap-3 rounded-2xl bg-background p-5">
        <Bone className="h-5 w-48" />
        <Bone className="h-3.5 w-full max-w-lg bg-foreground/5" />
        <Bone className="h-11 w-40 rounded-full bg-foreground/5" />
      </div>
      <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-8">
          <Section rows={4} dot={false} />
          <Section rows={3} dot={false} />
        </div>
        <div className="flex flex-col gap-8">
          <Section rows={3} dot={false} />
          <Section rows={4} dot={false} />
        </div>
      </div>
    </Skeleton>
  );
}

// ---------------------------------------------------------------------------
// Administrace a ostatní
// ---------------------------------------------------------------------------

// Seznam šablon: řádky s názvem a počtem úkolů.
export function TemplateListSkeleton() {
  return (
    <Skeleton>
      <ListRows rows={4} dot={false} minHeight="min-h-14" />
    </Skeleton>
  );
}

// Administrace: nadpis a dva sloupce (šablony, pravidlo PBM).
export function AdminSkeleton() {
  return (
    <Skeleton className="flex flex-col gap-10">
      <TitleBone />
      <div className="grid gap-10 xl:grid-cols-2 xl:items-start">
        <Section rows={4} dot={false} aside={false} />
        <Section rows={3} dot={false} aside={false} />
      </div>
    </Skeleton>
  );
}

// Stránka, kterou neznáme (úvod před přesměrováním): nadpis a jeden seznam.
export function GenericSkeleton() {
  return (
    <Skeleton className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12">
      <TitleBone />
      <ListRows rows={4} dot={false} />
    </Skeleton>
  );
}
