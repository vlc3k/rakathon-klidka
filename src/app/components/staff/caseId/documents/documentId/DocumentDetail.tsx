"use client";

import { CaseLock, useCaseLocked } from "@/app/components/shared/CaseLock";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Popover } from "@base-ui/react/popover";
import { ArrowDown, ArrowUp, Check, ChevronLeft, ExternalLink, Loader, Minus, Plus } from "lucide-react";
import { AlertIcon, EditIcon, QuestionIcon, ReportIcon, SearchIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { AITag } from "@/app/components/shared/AITag";
import { EditValueDialog } from "@/app/components/staff/caseId/documents/documentId/EditValueDialog";
import { clampZoom, Loupe, ZOOM_MAX, ZOOM_MIN } from "@/app/components/staff/caseId/documents/documentId/Loupe";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { ListCard } from "@/app/components/shared/ListCard";
import { DocumentSkeleton, SmoothImage } from "@/app/components/shared/LoadingStates";
import { unverifyInformation, VerifyButton, verifyInformation } from "@/app/components/shared/VerifyButton";
import { AREAS } from "@/db/catalog";
import { api, documentUrl, errorMessage } from "@/lib/api/client";
import { revalidate, useApi } from "@/lib/api/useApi";
import type { CaseDetail, Information } from "@/lib/api/types";
import { boxOf, documentGroups, informationLabel, informationText, pagesLabel, type DocView, type Verification } from "@/lib/caseView";
import { helperUploadNote } from "@/lib/helpers";
import type { Box } from "@/lib/reading/ground";
import { cn } from "@/lib/utils";

// Jedna zpráva očima ambulance: vlevo co z ní vytěžila AI (po oblastech, nejisté údaje s vykřičníkem),
// vpravo originál. Klik na údaj ho na originálu zvýrazní a přejede k němu.
// Každý údaj jde tady i potvrdit proti originálu. ?value=<id> otevře stránku rovnou se zvýrazněným údajem
// (klik na hodnotu v detailu zákroku).

type ValueRow = {
  id: string;
  area: string;
  label: string;
  value: string;
  // Laboratoř: norma z dokumentu a příznak mimo normu (L/H).
  range: string | null;
  flag: "L" | "H" | null;
  confidence: number | null;
  verified: Verification | null;
  pageId: string;
  box: Box | null;
  info: Information;
};

// Pod touhle jistotou AI (0–1 v databázi) dostane hodnota vykřičník. Nad ní jistotu neukazujeme vůbec.
const LOW_CONFIDENCE = 0.8;
const isDoubtful = (row: ValueRow) => row.confidence !== null && row.confidence < LOW_CONFIDENCE;

const AREA_ORDER = Object.keys(AREAS) as (keyof typeof AREAS)[];

export function DocumentDetail({ caseId, documentId }: { caseId: string; documentId: string }) {
  const detail = useApi<CaseDetail>(`/api/v1/cases/${caseId}`);
  const preselected = useSearchParams().get("value");
  const [selected, setSelected] = useState<string | null>(preselected);
  const [error, setError] = useState<string | null>(null);
  const run = (call: (caseId: string, ids: string[]) => Promise<void>) => async (ids: string[]) => {
    setError(null);
    try {
      await call(caseId, ids);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const confirm = run(verifyInformation);
  const revoke = run(unverifyInformation);

  // Vybraný údaj přejede na originálu doprostřed obrazovky.
  useEffect(() => {
    if (!selected) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(`box-${selected}`)?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [selected, detail.data]);

  // Zaměstnanec dokument viděl: zapíše se u všech stránek zprávy (krok „Viděno“ u vyžádaných dokumentů).
  const pageKey = detail.data ? (documentGroups(detail.data).find((g) => g.pages.some((page) => page.id === documentId))?.pages.map((page) => page.id).join(",") ?? "") : "";
  useEffect(() => {
    if (!pageKey) return;
    const unseen = pageKey.split(",");
    Promise.all(unseen.map((id) => api.post(`/api/v1/cases/${caseId}/documents/${id}/seen`)))
      .then(() => revalidate(`/api/v1/cases/${caseId}`))
      .catch((e) => console.warn("Nepodařilo se zapsat, že dokument viděl zaměstnanec:", e));
  }, [caseId, pageKey]);

  if (detail.error?.status === 404) return <NotFound caseId={caseId} />;
  if (!detail.data) return <DocumentSkeleton />;

  const group = documentGroups(detail.data).find((g) => g.pages.some((page) => page.id === documentId));
  if (!group) return <NotFound caseId={caseId} />;

  const pageIds = new Set(group.pages.map((page) => page.id));
  const rows = detail.data.information.filter((info) => info.documentId && pageIds.has(info.documentId) && info.status !== "rejected").map(toRow);
  const areas = AREA_ORDER.map((area) => ({ area, rows: rows.filter((row) => row.area === area) })).filter((block) => block.rows.length > 0);
  const other = rows.filter((row) => !AREA_ORDER.includes(row.area as keyof typeof AREAS));
  const unsure = group.pages.some((page) => !page.identityOk);
  const issues = [...new Set(group.pages.flatMap((page) => page.issues.filter((issue) => issue.important && !(page.identityOk && issue.label === "Nejasná identita")).map((issue) => issue.label)))];
  const reading = group.pages.some((page) => page.status === "uploaded" || page.status === "processing");
  const failed = group.pages.some((page) => page.status === "failed");
  // Nahrál-li zprávu pomocník z rodiny, ambulance to vidí („Nahrál(a) Petra (dcera) za pacienta“).
  const people = detail.data.people;
  const uploader = group.pages.map((page) => helperUploadNote(people, detail.data?.documents.find((doc) => doc.id === page.id)?.uploadedBy)).find(Boolean);

  return (
    <CaseLock locked={detail.data?.case.status === "closed"}>
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <Link
            href={`/staff/${caseId}`}
            className="press -ml-2 inline-flex h-11 w-fit items-center gap-1 rounded-full pr-3 pl-1 text-base text-muted-foreground outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="size-5" />
            {detail.data.patient.displayName}
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight lg:text-4xl">{group.typeLabel}</h1>
          <p className="text-base text-muted-foreground">
            {group.date ? `Vystaveno ${group.date}` : "Bez data"} · {pagesLabel(group.pages.length)}
            {uploader && ` · ${uploader}`}
          </p>
          {(unsure || issues.length > 0) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-amber-700">
              {unsure && (
                <span className="flex items-center gap-1.5 font-medium">
                  <QuestionIcon className="size-4" /> Nelze přiřadit pacientovi, údaje se nepoužijí
                </span>
              )}
              {issues.map((label) => (
                <span key={label} className="flex items-center gap-1.5">
                  <AlertIcon className="size-4" /> {label}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-10 lg:grid lg:grid-cols-12 lg:items-start lg:gap-10">
          <section className="flex flex-col gap-3 lg:sticky lg:top-6 lg:col-span-5">
            <div className="flex min-h-8 items-center justify-between gap-4">
              <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
                Vytěženo z dokumentu
                <AITag />
              </h2>
              {rows.length > 0 &&
                (rows.every((row) => row.verified) ? (
                  <span className="flex items-center gap-1.5 text-sm font-medium text-green-700">
                    <Check className="size-4" strokeWidth={2.5} />
                    Vše potvrzeno
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground tabular-nums">
                    Potvrzeno {rows.filter((row) => row.verified).length} z {rows.length}
                  </span>
                ))}
            </div>

            {rows.length === 0 ? (
              <p className="flex items-start gap-3 rounded-2xl bg-background p-5 text-base text-muted-foreground">
                {reading ? <Loader className="mt-0.5 size-5 shrink-0 motion-safe:animate-spin" /> : <ReportIcon className="mt-0.5 size-5 shrink-0" />}
                {reading ? "AI dokument ještě čte." : failed ? "AI dokument nepřečetla. Údaje zadejte ručně." : "AI z dokumentu nic nevytěžila."}
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {error && (
                  <p role="alert" className="text-sm font-medium text-destructive">
                    {error}
                  </p>
                )}
                {areas.map(({ area, rows: areaRows }) => (
                  <ValueCard key={area} caseId={caseId} title={AREAS[area].name} rows={areaRows} selected={selected} onSelect={setSelected} onConfirm={unsure ? undefined : confirm} onRevoke={revoke} />
                ))}
                {other.length > 0 && <ValueCard caseId={caseId} title="Ostatní" rows={other} selected={selected} onSelect={setSelected} onConfirm={unsure ? undefined : confirm} onRevoke={revoke} />}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3 lg:col-span-7">
            <h2 className="sr-only">Originál</h2>
            {group.pages.map((page, index) => (
              <Page
                key={page.id}
                caseId={caseId}
                page={page}
                label={group.pages.length > 1 ? `Strana ${index + 1}` : null}
                rows={rows.filter((row) => row.pageId === page.id)}
                selected={selected}
              />
            ))}
          </section>
        </div>
      </div>
    </CaseLock>
  );
}

function toRow(info: Information): ValueRow {
  const value = info.value as { refLow?: unknown; refHigh?: unknown; flag?: unknown };
  const low = typeof value.refLow === "number" ? value.refLow : null;
  const high = typeof value.refHigh === "number" ? value.refHigh : null;
  const range = low !== null && high !== null ? `${low}–${high}` : low !== null ? `od ${low}` : high !== null ? `do ${high}` : null;
  return {
    id: info.id,
    area: info.area ?? "other",
    label: informationLabel(info),
    value: informationText(info),
    range: range && `norma ${range.replace(/\./g, ",")}`,
    flag: value.flag === "L" || value.flag === "H" ? value.flag : null,
    confidence: info.confidence,
    verified: info.status === "verified" ? { verifiedAt: info.verifiedAt, verifiedBy: info.verifiedBy } : null,
    pageId: info.documentId!,
    box: boxOf(info.bbox),
    info,
  };
}

// Údaje jedné oblasti (Laboratoř, Medikace…): v řádku nahoře malý šedý název (u laboratoře s normou), pod ním hodnota
// zarovnaná vlevo, takže se dlouhá diagnóza zalomí přirozeně a název se neořízne. Mimo normu červeně se šipkou.
// Vpravo u nejisté hodnoty vykřičník, nenápadná tužka (ruční oprava) a zaškrtávací kolečko potvrzení (klik na zelené
// odvolá). Má-li karta aspoň jeden vykřičník, ostatní řádky mají na jeho místě mezeru, ať akce lícují.
// Klik na řádek ho ukáže na originálu, vybraný má fialový proužek vlevo. Štítek AI je jednou u nadpisu sekce, ne u každé
// karty. V hlavičce „Potvrdit vše“. U dokumentu, který nejde přiřadit pacientovi, se nepotvrzuje.
function ValueCard({
  caseId,
  title,
  rows,
  selected,
  onSelect,
  onConfirm,
  onRevoke,
}: {
  caseId: string;
  title: string;
  rows: ValueRow[];
  selected: string | null;
  onSelect: (id: string) => void;
  onConfirm?: (ids: string[]) => Promise<void>;
  onRevoke: (ids: string[]) => Promise<void>;
}) {
  const locked = useCaseLocked();
  // Uzavřený zákrok: hodnoty jen ke čtení (bez opravy a „Potvrdit vše“).
  const canEdit = Boolean(onConfirm) && !locked;
  const [confirmAll, setConfirmAll] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  // Údaj, který lékař zrovna ručně opravuje (dialog s poli podle druhu údaje).
  const [editing, setEditing] = useState<ValueRow | null>(null);
  const pending = rows.filter((row) => !row.verified);
  const doubtful = rows.some(isDoubtful);
  return (
    <ListCard
      title={title}
      count={rows.length}
      aside={
        canEdit &&
        pending.length > 1 && (
          <button
            type="button"
            disabled={savingAll}
            onClick={() => setConfirmAll(true)}
            className="press -mr-2 flex h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-primary outline-none select-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:text-muted-foreground"
          >
            {savingAll && <Loader className="size-4 motion-safe:animate-spin" />}
            {savingAll ? "Potvrzuji…" : "Potvrdit vše"}
          </button>
        )
      }
    >
      {rows.map((row) => {
        const on = selected === row.id;
        const Arrow = row.flag === "L" ? ArrowDown : ArrowUp;
        const body = (
          <>
            <span className="flex min-w-0 items-baseline gap-2 text-sm text-muted-foreground">
              <span className="min-w-0">{row.label}</span>
              {row.range && <span className="shrink-0 text-xs tabular-nums">{row.range}</span>}
            </span>
            <span className={cn("flex items-center gap-1 text-base font-semibold tracking-tight text-pretty wrap-anywhere tabular-nums", row.flag && "text-red-700")}>
              {row.value}
              {row.flag && (
                <>
                  <Arrow className="size-4 shrink-0" aria-hidden />
                  <span className="sr-only">{row.flag === "L" ? "pod normou" : "nad normou"}</span>
                </>
              )}
            </span>
          </>
        );
        const area = "flex min-w-0 flex-1 flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left";
        return (
          // Najetí i výběr podbarví celý řádek až k potvrzení, ne jen text (žádný blok v bloku).
          <li
            key={row.id}
            className={cn(
              "relative py-1.5 pr-2 pl-2 transition-colors duration-200 motion-safe:ease-smooth",
              on ? "bg-ai/8" : row.box && "hover:bg-muted/60",
            )}
          >
            {/* Vybraný údaj (svítí na originálu): fialový proužek vlevo. */}
            {on && <span aria-hidden className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-ai" />}
            <div className="flex items-center gap-1">
              {row.box ? (
                <button
                  type="button"
                  onClick={() => onSelect(row.id)}
                  aria-pressed={on}
                  aria-label={`${row.label} ${row.value}, ukázat na originálu`}
                  className={cn(area, "press outline-none select-none focus-visible:ring-2 focus-visible:ring-ring")}
                >
                  {body}
                </button>
              ) : (
                <div className={area}>{body}</div>
              )}
              {doubtful && (isDoubtful(row) ? <LowConfidence value={row.confidence!} /> : <span aria-hidden className="size-9 shrink-0" />)}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setEditing(row)}
                  aria-label={`Opravit ${row.label.toLowerCase()} ${row.value}`}
                  title="Opravit ručně podle originálu"
                  className="press relative flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 outline-none select-none after:absolute after:-inset-1 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <EditIcon className="size-4.5" />
                </button>
              )}
              {onConfirm && (
                <VerifyButton
                  variant="check"
                  what={`${row.label.toLowerCase()} ${row.value}`}
                  verified={row.verified}
                  onConfirm={() => onConfirm([row.id])}
                  onRevoke={() => onRevoke([row.id])}
                  saving={savingAll && !row.verified}
                />
              )}
            </div>
          </li>
        );
      })}
      {editing && (
        <EditValueDialog caseId={caseId} info={editing.info} label={editing.label} open onOpenChange={(open) => !open && setEditing(null)} />
      )}
      {onConfirm && (
        <ConfirmDialog
          open={confirmAll}
          onOpenChange={setConfirmAll}
          title={`Potvrdit ${pending.length} hodnot?`}
          description={`Porovnali jste všechny hodnoty z karty ${title} s originálem? Potvrzení ponese vaše jméno.`}
          confirmLabel="Potvrdit vše"
          onConfirm={async () => {
            setSavingAll(true);
            try {
              await onConfirm(pending.map((row) => row.id));
            } finally {
              setSavingAll(false);
            }
          }}
        />
      )}
    </ListCard>
  );
}

// Hodnota, kterou AI přečetla s jistotou pod 80 %: jen vykřičník, na hover i na tap kolik a co to znamená
// (jako InfoTip). Lékař ji tak ověří v originálu jako první. Plocha pro prst je 44 px, kresba menší.
function LowConfidence({ value }: { value: number }) {
  const percent = Math.round(value * 100);
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={100}
        aria-label={`Nejistá hodnota, jistota AI ${percent} %`}
        className="relative flex size-9 shrink-0 cursor-help items-center justify-center rounded-full text-amber-600 outline-none select-none after:absolute after:-inset-1 hover:text-amber-700 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <AlertIcon className="size-5 [--icon-accent:currentColor]" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={4} className="z-50">
          <Popover.Popup className="flex max-w-64 flex-col gap-1 rounded-2xl bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg outline-none motion-safe:transition motion-safe:duration-200 motion-safe:ease-smooth data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <span className="font-semibold tabular-nums">Jistota AI {percent} %</span>
            <span>Jak moc si je AI jistá, že hodnotu přečetla správně. U téhle je jistota nízká, porovnejte ji s originálem obzvlášť pečlivě.</span>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

// Stránka originálu. Vybraný údaj na ní svítí a zbytek stránky ztmavne, stejně tak v lupě.
function Page({ caseId, page, label, rows, selected }: { caseId: string; page: DocView; label: string | null; rows: ValueRow[]; selected: string | null }) {
  const src = documentUrl(caseId, page.id);
  // Svítí jen vybraný údaj, víc rámečků naráz se na fotce překrývalo.
  const focused = rows.find((row) => row.id === selected);
  // Lupa se zapíná a vypíná ikonkou vpravo nahoře na fotce, přiblížení se mění kolečkem nebo tlačítky − a +.
  const [loupe, setLoupe] = useState(false);
  const [zoom, setZoom] = useState(2);
  // Bez ukazatele na fotce stojí lupa na vybraném údaji.
  const anchor = focused?.box ? { x: focused.box.x + focused.box.w / 2, y: focused.box.y + focused.box.h / 2 } : null;
  // Poměr stran fotky (výška / šířka): okraj rámečku se počítá ve skutečných rozměrech, ne v 0–1 zvlášť pro osy.
  const photo = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(1.414);
  useEffect(() => {
    const el = photo.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => entry.contentRect.width > 0 && setAspect(entry.contentRect.height / entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <figure className="overflow-hidden rounded-2xl bg-background">
      {page.mimeType === "application/pdf" ? (
        <a href={src} target="_blank" rel="noreferrer" className="press m-3 flex min-h-24 items-center justify-center gap-2 rounded-xl bg-muted text-base font-medium hover:bg-muted/70">
          <ReportIcon className="size-5" /> PDF · otevřít
        </a>
      ) : (
        <div ref={photo} className="relative">
          <Loupe
            src={src}
            active={loupe}
            zoom={zoom}
            onZoom={setZoom}
            anchor={anchor}
            overlay={focused?.box && <Highlight id={focused.id} box={focused.box} aspect={aspect} title={`${focused.label}: ${focused.value}`} lens />}
          >
            <SmoothImage src={src} alt={label ?? page.typeLabel} className="w-full" imgClassName="w-full" placeholderClassName="aspect-3/4" />
            {focused?.box && <Highlight id={focused.id} box={focused.box} aspect={aspect} title={`${focused.label}: ${focused.value}`} />}
          </Loupe>
          <div className="absolute top-3 right-3 z-30 flex items-center gap-2">
            {loupe && (
              <div role="group" aria-label="Přiblížení lupy" className="flex h-11 items-center rounded-full bg-background/95 shadow-sm">
                <ZoomButton label="Oddálit" disabled={zoom <= ZOOM_MIN} onClick={() => setZoom(clampZoom(zoom - 0.5))}>
                  <Minus className="size-4" />
                </ZoomButton>
                <span aria-live="polite" className="w-10 text-center text-sm font-medium tabular-nums">
                  {String(zoom).replace(".", ",")}×
                </span>
                <ZoomButton label="Přiblížit" disabled={zoom >= ZOOM_MAX} onClick={() => setZoom(clampZoom(zoom + 0.5))}>
                  <Plus className="size-4" />
                </ZoomButton>
              </div>
            )}
            <button
              type="button"
              aria-pressed={loupe}
              aria-label={loupe ? "Vypnout lupu" : "Zapnout lupu"}
              title={loupe ? "Vypnout lupu" : "Lupa: zvětší místo pod ukazatelem"}
              onClick={() => setLoupe((on) => !on)}
              className={cn(
                "press flex size-11 items-center justify-center rounded-full shadow-sm outline-none select-none focus-visible:ring-2 focus-visible:ring-ring",
                loupe ? "bg-foreground text-background hover:bg-foreground/85" : "bg-background/90 text-foreground hover:bg-background",
              )}
            >
              <SearchIcon className="size-5" />
            </button>
          </div>
        </div>
      )}
      <figcaption className="flex items-center justify-between gap-4 px-5 py-3 text-sm text-muted-foreground">
        <span>{label ?? "Originál"}</span>
        <a href={src} target="_blank" rel="noreferrer" className="press -mr-2 flex h-11 items-center gap-1.5 rounded-full px-3 font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
          <ExternalLink className="size-4" /> Otevřít
        </a>
      </figcaption>
    </figure>
  );
}

// Okraj mezi textem a rámečkem podle výšky textu: nahoře a dole 45 %, po stranách 70 %. Stejný u drobného i velkého
// písma a v lupě se zvětší s ním.
const PAD_Y = 0.45;
const PAD_X = 0.7;

// Obdélník s okrajem (0–1). Svisle se počítá z výšky boxu, vodorovně přes poměr stran fotky, ať je okraj stejně široký.
function padRect(box: Box, aspect: number) {
  const dy = box.h * PAD_Y;
  const dx = box.h * aspect * PAD_X;
  return { x: box.x - dx, y: box.y - dy, w: box.w + 2 * dx, h: box.h + 2 * dy };
}

// Čtyřúhelník s okrajem: každý roh se posune ven podél řádku textu a kolmo na něj, takže rámeček zůstane rovnoběžný
// s natočeným textem. Počítá se ve skutečných rozměrech (y krát poměr stran), pořadí rohů nehraje roli.
function padQuad(quad: [number, number][], aspect: number): [number, number][] {
  const pts = quad.map(([x, y]) => [x, y * aspect]);
  const c = [pts.reduce((sum, p) => sum + p[0], 0) / 4, pts.reduce((sum, p) => sum + p[1], 0) / 4];
  const edge = (a: number[], b: number[]) => [b[0] - a[0], b[1] - a[1]];
  const len = (v: number[]) => Math.hypot(v[0], v[1]) || 1;
  const e0 = edge(pts[0], pts[1]);
  const e1 = edge(pts[1], pts[2]);
  // Delší hrana je směr řádku, kratší výška textu.
  const [along, across] = len(e0) >= len(e1) ? [e0, e1] : [e1, e0];
  const u = [along[0] / len(along), along[1] / len(along)];
  const v = [across[0] / len(across), across[1] / len(across)];
  const height = len(across);
  return pts.map((p) => {
    const d = [p[0] - c[0], p[1] - c[1]];
    const su = Math.sign(d[0] * u[0] + d[1] * u[1]);
    const sv = Math.sign(d[0] * v[0] + d[1] * v[1]);
    const x = p[0] + su * u[0] * height * PAD_X + sv * v[0] * height * PAD_Y;
    const y = p[1] + su * u[1] * height * PAD_X + sv * v[1] * height * PAD_Y;
    return [x, y / aspect];
  });
}

// Rámeček kolem vybraného údaje (poměrově 0–1) s okrajem od textu, okolí se ztmaví. U narovnané stránky (quad) je to
// čtyřúhelník, který kopíruje natočení a zkosení textu na fotce; obdélník kolem je jen cíl pro posun a popisek.
// `lens`: kopie do zvětšeného obrazu v lupě, bez id pro posun (ten je jen jeden, na fotce) a s vlastní maskou.
function Highlight({ id, box, aspect, title, lens = false }: { id: string; box: Box; aspect: number; title: string; lens?: boolean }) {
  const position = { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` };
  if (!box.quad) {
    const padded = padRect(box, aspect);
    return (
      <span
        id={lens ? undefined : `box-${id}`}
        title={lens ? undefined : title}
        className="spotlight pointer-events-none absolute z-10 scroll-mt-24 rounded-md ring-4 ring-ai"
        style={{ left: `${padded.x * 100}%`, top: `${padded.y * 100}%`, width: `${padded.w * 100}%`, height: `${padded.h * 100}%` }}
      />
    );
  }
  const points = padQuad(box.quad, aspect)
    .map(([x, y]) => `${x},${y}`)
    .join(" ");
  const mask = lens ? `hole-lens-${id}` : `hole-${id}`;
  return (
    <>
      {!lens && <span id={`box-${id}`} title={title} className="pointer-events-none absolute scroll-mt-24" style={position} />}
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 z-10 size-full" aria-hidden>
        <mask id={mask}>
          <rect width="1" height="1" fill="white" />
          <polygon points={points} fill="black" />
        </mask>
        <rect width="1" height="1" fill="rgb(0 0 0 / 0.35)" mask={`url(#${mask})`} />
        <polygon points={points} fill="none" vectorEffect="non-scaling-stroke" strokeLinejoin="round" className="stroke-ai stroke-4" />
      </svg>
    </>
  );
}

// Tlačítko − / + u lupy: plocha 44 px, kresba je malá.
function ZoomButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="press flex size-11 items-center justify-center rounded-full outline-none select-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function NotFound({ caseId }: { caseId: string }) {
  return (
    <div className="flex flex-col items-start gap-4">
      <Link href={`/staff/${caseId}`} className="press -ml-2 inline-flex h-11 items-center gap-1 rounded-full pr-3 pl-1 text-base text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-5" />
        Zákrok
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight">Dokument nenalezen</h1>
      <p className="text-base text-muted-foreground">Možná byl odebrán. Vraťte se na zákrok.</p>
    </div>
  );
}
