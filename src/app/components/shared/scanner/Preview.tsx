"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Crop, Eraser, Loader2, Maximize, Plus, RefreshCw, RotateCw, SlidersHorizontal, Trash2, Undo2, X, type LucideIcon } from "lucide-react";
import { CornerEditor } from "@/app/components/shared/scanner/CornerEditor";
import { nextRotation, rotateCorners, unrotateCorners, type Page } from "@/lib/scanner/pages";
import { applyFilter, defaultCorners, downscale, estimatePaperColor, renderCanvas, rotateCanvas, toBlob } from "@/lib/scanner/scan";
import type { Corners, FilterId, Point, Rotation } from "@/lib/scanner/types";
import { cn } from "@/lib/utils";

type Tool = "crop" | "filter" | "clean";

export interface PreviewProps {
  pages: Page[];
  index: number;
  busy: boolean;
  /** Hlavní akce dole, např. tlačítko „Odeslat“. Dostane se pod nástroje přes celou šířku. */
  action: React.ReactNode;
  onIndexChange: (i: number) => void;
  onBack: () => void;
  onAdd: () => void;
  onRetake: (i: number) => void;
  onDelete: (i: number) => void;
  onUpdatePage: (i: number, patch: Partial<Pick<Page, "corners" | "rotation" | "filter" | "cleanLayer">>) => void;
}

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "color", label: "Barevně" },
  { id: "grayscale", label: "Šedě" },
  { id: "none", label: "Původní" },
];

const iconButton =
  "flex size-11 shrink-0 items-center justify-center rounded-full outline-none select-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring";

// Náhled pořízených stránek: stránka, pás náhledů s „+“, nástroje a hlavní akce dole.
export function Preview(props: PreviewProps) {
  const { pages, index, busy, action, onIndexChange, onBack, onAdd, onRetake, onDelete, onUpdatePage } = props;
  const [tool, setTool] = useState<Tool | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const page = pages[index];

  useEffect(() => {
    if (!confirmDelete) return;
    const t = window.setTimeout(() => setConfirmDelete(false), 3000);
    return () => window.clearTimeout(t);
  }, [confirmDelete]);

  if (!page) return null;

  if (tool === "crop") {
    return (
      <CropTool
        page={page}
        onCancel={() => setTool(null)}
        onApply={(patch) => {
          onUpdatePage(index, { ...patch, cleanLayer: null });
          setTool(null);
        }}
      />
    );
  }
  if (tool === "filter") {
    return <FilterTool page={page} onSelect={(filter) => onUpdatePage(index, { filter })} onClose={() => setTool(null)} />;
  }
  if (tool === "clean") {
    return (
      <CleanTool
        page={page}
        onCancel={() => setTool(null)}
        onApply={(cleanLayer) => {
          onUpdatePage(index, { cleanLayer });
          setTool(null);
        }}
      />
    );
  }

  return (
    <Screen>
      <TopBar
        left={
          <button type="button" className={iconButton} onClick={onBack} aria-label="Zpět ke kameře">
            <ArrowLeft className="size-5" />
          </button>
        }
        title={pages.length === 1 ? "Kontrola" : `Strana ${index + 1} z ${pages.length}`}
      />

      <Stage>
        {page.rendered ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="max-h-full max-w-full rounded-xl object-contain" src={page.rendered.previewUrl} alt={`Stránka ${index + 1}`} />
        ) : (
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        )}
        {pages.length > 1 && (
          <>
            <button
              type="button"
              className={cn(iconButton, "absolute top-1/2 left-2 -translate-y-1/2 bg-background/80")}
              onClick={() => onIndexChange((index + pages.length - 1) % pages.length)}
              aria-label="Předchozí stránka"
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              className={cn(iconButton, "absolute top-1/2 right-2 -translate-y-1/2 bg-background/80")}
              onClick={() => onIndexChange((index + 1) % pages.length)}
              aria-label="Další stránka"
            >
              <ChevronRight className="size-5" />
            </button>
          </>
        )}
      </Stage>

      <div role="list" aria-label="Stránky" className="flex shrink-0 gap-2 overflow-x-auto px-4 py-3">
        {pages.map((p, i) => (
          <button
            type="button"
            key={p.id}
            role="listitem"
            onClick={() => onIndexChange(i)}
            aria-label={`Stránka ${i + 1}`}
            aria-current={i === index}
            className={cn("relative h-16 w-12 shrink-0 overflow-hidden rounded-xl bg-background outline-none select-none focus-visible:ring-2 focus-visible:ring-ring", i === index && "ring-2 ring-primary")}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {p.rendered && <img src={p.rendered.previewUrl} alt="" className="size-full object-cover" />}
          </button>
        ))}
        <button
          type="button"
          onClick={onAdd}
          aria-label="Přidat stránku"
          className="flex h-16 w-12 shrink-0 items-center justify-center rounded-xl bg-background outline-none select-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-5" />
        </button>
      </div>

      <div className="pb-safe shrink-0">
        <div className="flex flex-col gap-3 px-4 pb-4">
          <nav aria-label="Úpravy stránky" className="grid grid-cols-5 rounded-2xl bg-background py-1">
            <ToolButton icon={Crop} label="Oříznout" onClick={() => setTool("crop")} disabled={busy} />
            <ToolButton icon={SlidersHorizontal} label="Filtr" onClick={() => setTool("filter")} disabled={busy} />
            <ToolButton icon={Eraser} label="Vyčistit" onClick={() => setTool("clean")} disabled={busy || !page.rendered} />
            <ToolButton icon={RefreshCw} label="Znovu" onClick={() => onRetake(index)} disabled={busy} />
            <ToolButton
              icon={Trash2}
              label={confirmDelete ? "Opravdu?" : "Smazat"}
              danger={confirmDelete}
              onClick={() => {
                if (!confirmDelete) return setConfirmDelete(true);
                setConfirmDelete(false);
                onDelete(index);
              }}
              disabled={busy}
            />
          </nav>
          {action}
        </div>
      </div>
    </Screen>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col bg-muted text-foreground">{children}</div>;
}

function TopBar({ left, title, right }: { left?: React.ReactNode; title: string; right?: React.ReactNode }) {
  return (
    <header className="pt-safe shrink-0">
      <div className="flex h-14 items-center justify-between px-2">
        {left ?? <span className="size-11" />}
        <h1 className="text-base font-semibold">{title}</h1>
        {right ?? <span className="size-11" />}
      </div>
    </header>
  );
}

function Stage({ children }: { children: React.ReactNode }) {
  return <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 py-2">{children}</div>;
}

function ToolButton({ icon: Icon, label, onClick, disabled, danger }: { icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "press flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
        danger && "text-destructive",
      )}
    >
      <Icon className="size-5" />
      <span className="text-xs">{label}</span>
    </button>
  );
}

function Chip({ on, onClick, children, disabled }: { on?: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={cn(
        "flex h-11 items-center gap-2 rounded-full px-4 text-base font-medium outline-none select-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
        on ? "bg-primary text-primary-foreground" : "bg-background",
      )}
    >
      {children}
    </button>
  );
}

function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <div className="pb-safe shrink-0">
      <div className="flex flex-wrap justify-center gap-2 px-4 pt-2 pb-4">{children}</div>
    </div>
  );
}

function ToolTopBar({ title, onCancel, onApply }: { title: string; onCancel?: () => void; onApply: () => void }) {
  return (
    <TopBar
      title={title}
      left={
        onCancel && (
          <button type="button" className={iconButton} onClick={onCancel} aria-label="Zrušit">
            <X className="size-5" />
          </button>
        )
      }
      right={
        <button type="button" className={cn(iconButton, "bg-primary text-primary-foreground hover:bg-primary/90")} onClick={onApply} aria-label="Použít">
          <Check className="size-5" />
        </button>
      }
    />
  );
}

// ---------------------------------------------------------------- Oříznout a otočit

function CropTool({ page, onCancel, onApply }: { page: Page; onCancel: () => void; onApply: (patch: { corners: Corners | null; rotation: Rotation }) => void }) {
  const W = page.prep.canvas.width;
  const H = page.prep.canvas.height;
  const [rotation, setRotation] = useState<Rotation>(page.rotation);
  const [corners, setCorners] = useState<Corners | null>(page.corners);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // náhled otočený podle aktuální rotace (rohy zůstávají v souřadnicích originálu)
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    toBlob(rotateCanvas(page.prep.canvas, rotation), 0.8).then((b) => {
      if (!alive) return;
      url = URL.createObjectURL(b);
      setPreviewUrl(url);
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [page.prep.canvas, rotation]);

  const swap = rotation === 90 || rotation === 270;
  const dispW = swap ? H : W;
  const dispH = swap ? W : H;
  const shown = corners ? rotateCorners(corners, rotation, W, H) : null;

  return (
    <Screen>
      <ToolTopBar title="Oříznout" onCancel={onCancel} onApply={() => onApply({ corners, rotation })} />
      <Stage>
        {previewUrl &&
          (shown ? (
            <CornerEditor previewUrl={previewUrl} width={dispW} height={dispH} corners={shown} onChange={(c) => setCorners(unrotateCorners(c, rotation, W, H))} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="max-h-full max-w-full object-contain" src={previewUrl} alt="Bez ořezu" />
          ))}
      </Stage>
      <Sheet>
        <Chip on={!!corners} onClick={() => setCorners(page.prep.corners ?? defaultCorners(W, H))}>
          <Crop className="size-4" /> Oříznout
        </Chip>
        <Chip on={!corners} onClick={() => setCorners(null)}>
          <Maximize className="size-4" /> Celá fotka
        </Chip>
        <Chip onClick={() => setRotation(nextRotation(rotation))}>
          <RotateCw className="size-4" /> Otočit
        </Chip>
      </Sheet>
    </Screen>
  );
}

// ---------------------------------------------------------------- Filtr

function FilterTool({ page, onSelect, onClose }: { page: Page; onSelect: (f: FilterId) => void; onClose: () => void }) {
  const [thumbs, setThumbs] = useState<Partial<Record<FilterId, string>>>({});

  useEffect(() => {
    // malé náhledy každého filtru z aktuálního ořezu (na zmenšené kopii, ať jsou hned)
    let alive = true;
    renderCanvas(page.prep, { corners: page.corners, rotation: page.rotation, filter: "none", cleanLayer: page.cleanLayer }).then(async (full) => {
      if (!alive) return;
      const base = downscale(full, 320);
      const entries = await Promise.all(FILTERS.map(async (f) => [f.id, (await applyFilter(base, f.id)).toDataURL("image/jpeg", 0.75)] as const));
      if (!alive) return;
      setThumbs(Object.fromEntries(entries));
    });
    return () => {
      alive = false;
    };
  }, [page.prep, page.corners, page.rotation, page.cleanLayer]);

  return (
    <Screen>
      <ToolTopBar title="Filtr" onApply={onClose} />
      <Stage>
        {page.rendered ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="max-h-full max-w-full rounded-xl object-contain" src={page.rendered.previewUrl} alt="" />
        ) : (
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        )}
      </Stage>
      <div className="pb-safe shrink-0">
        <div role="radiogroup" aria-label="Filtr" className="flex justify-center gap-3 overflow-x-auto px-4 pt-2 pb-4">
          {FILTERS.map((f) => (
            <button
              type="button"
              key={f.id}
              role="radio"
              aria-checked={page.filter === f.id}
              onClick={() => onSelect(f.id)}
              className="flex w-18 shrink-0 flex-col items-center gap-1 rounded-xl outline-none select-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className={cn("size-16 overflow-hidden rounded-xl bg-background", page.filter === f.id && "ring-2 ring-primary")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {thumbs[f.id] && <img src={thumbs[f.id]} alt="" className="size-full object-cover" />}
              </span>
              <span className={cn("text-sm", page.filter === f.id ? "font-semibold" : "text-muted-foreground")}>{f.label}</span>
            </button>
          ))}
        </div>
      </div>
    </Screen>
  );
}

// ---------------------------------------------------------------- Vyčistit

type Stroke = { points: Point[]; width: number };

function CleanTool({ page, onCancel, onApply }: { page: Page; onCancel: () => void; onApply: (layer: HTMLCanvasElement | null) => void }) {
  const [base, setBase] = useState<HTMLCanvasElement | null>(null);
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [brush, setBrush] = useState<"small" | "large">("small");
  const svgRef = useRef<SVGSVGElement>(null);
  const drawing = useRef(false);

  // podklad = oříznutá a otočená stránka bez filtru (ve workeru), k ní náhled pro SVG
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    renderCanvas(page.prep, { corners: page.corners, rotation: page.rotation, filter: "none" }).then(async (c) => {
      if (!alive) return;
      setBase(c);
      const b = await toBlob(c, 0.85);
      if (!alive) return;
      url = URL.createObjectURL(b);
      setBaseUrl(url);
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [page.prep, page.corners, page.rotation]);

  const W = base?.width ?? 1;
  const H = base?.height ?? 1;
  const paper = useMemo(() => (base ? estimatePaperColor(base) : "#ffffff"), [base]);

  const brushWidth = (brush === "small" ? 0.03 : 0.07) * Math.max(W, H);
  const existingLayer = page.cleanLayer && page.cleanLayer.width === W && page.cleanLayer.height === H ? page.cleanLayer : null;
  const existingLayerUrl = useMemo(() => existingLayer?.toDataURL() ?? null, [existingLayer]);

  function toCoords(e: React.PointerEvent): Point | null {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  function down(e: React.PointerEvent) {
    const p = toCoords(e);
    if (!p) return;
    drawing.current = true;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setStrokes((s) => [...s, { points: [p], width: brushWidth }]);
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    const p = toCoords(e);
    if (!p) return;
    setStrokes((s) => {
      const last = s[s.length - 1];
      return [...s.slice(0, -1), { ...last, points: [...last.points, p] }];
    });
  }
  function up() {
    drawing.current = false;
  }

  function apply() {
    if (!strokes.length || !base) return onApply(page.cleanLayer);
    const layer = document.createElement("canvas");
    layer.width = W;
    layer.height = H;
    const ctx = layer.getContext("2d")!;
    if (existingLayer) ctx.drawImage(existingLayer, 0, 0);
    ctx.strokeStyle = paper;
    ctx.fillStyle = paper;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of strokes) {
      ctx.lineWidth = s.width;
      if (s.points.length === 1) {
        ctx.beginPath();
        ctx.arc(s.points[0].x, s.points[0].y, s.width / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (const p of s.points.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    onApply(layer);
  }

  return (
    <Screen>
      <ToolTopBar title="Vyčistit" onCancel={onCancel} onApply={apply} />
      <p className="px-4 text-center text-sm text-muted-foreground">Přejeďte prstem přes skvrny nebo prsty na fotce.</p>
      <Stage>
        {!baseUrl && <Loader2 className="size-6 animate-spin text-muted-foreground" />}
        {baseUrl && (
          <svg
            ref={svgRef}
            className="block max-h-full max-w-full touch-none select-none"
            viewBox={`0 0 ${W} ${H}`}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            role="img"
            aria-label="Plátno pro vyčištění"
          >
            <image href={baseUrl} width={W} height={H} />
            {existingLayerUrl && <image href={existingLayerUrl} width={W} height={H} />}
            {strokes.map((s, i) =>
              s.points.length === 1 ? (
                <circle key={i} cx={s.points[0].x} cy={s.points[0].y} r={s.width / 2} fill={paper} />
              ) : (
                <polyline
                  key={i}
                  points={s.points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke={paper}
                  strokeWidth={s.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ),
            )}
          </svg>
        )}
      </Stage>
      <Sheet>
        <Chip on={brush === "small"} onClick={() => setBrush("small")}>
          Tenký
        </Chip>
        <Chip on={brush === "large"} onClick={() => setBrush("large")}>
          Silný
        </Chip>
        <Chip onClick={() => setStrokes((s) => s.slice(0, -1))} disabled={!strokes.length}>
          <Undo2 className="size-4" /> Zpět
        </Chip>
      </Sheet>
    </Screen>
  );
}
