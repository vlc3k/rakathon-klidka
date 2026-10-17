"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export const ZOOM_MIN = 1.5;
export const ZOOM_MAX = 6;
export const clampZoom = (zoom: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom * 10) / 10));
const SIZE = 192; // průměr lupy v px (12 rem), stejný na myš i na prst

type Point = { x: number; y: number; touch: boolean };

// Lupa na fotce dokumentu: kruh, který zvětšuje okolí ukazatele, ať jde přečíst drobné písmo bez otevírání originálu.
// Funguje jen zapnutá (ikonka na fotce), myší i prstem. U prstu je lupa nad ním, aby ji nezakrýval,
// a stránka se pod prstem neposouvá. Přiblížení mění kolečko myši nad fotkou (`onZoom`) a tlačítka u ikonky.
// V lupě je vidět i vybraný údaj (`overlay`, stejný rámeček jako na fotce). Když ukazatel na fotce není, lupa stojí
// na vybraném údaji (`anchor`), takže klik na hodnotu v seznamu ji ukáže rovnou zvětšenou. Vypnutá fotku nijak neovlivní.
export function Loupe({
  src,
  active,
  zoom,
  onZoom,
  anchor,
  overlay,
  className,
  children,
}: {
  src: string;
  active: boolean;
  zoom: number;
  onZoom: (zoom: number) => void;
  /** střed vybraného údaje (0–1), kde lupa stojí, když na fotce není ukazatel */
  anchor?: { x: number; y: number } | null;
  /** co se má v lupě kreslit přes fotku (rámeček vybraného údaje), v souřadnicích 0–1 jako na fotce */
  overlay?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const area = useRef<HTMLDivElement>(null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Velikost fotky na obrazovce: z ní se počítá zvětšený obraz v lupě.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Kolečko myši nad zapnutou lupou přibližuje a oddaluje místo posouvání stránky (proto ne pasivní posluchač).
  useEffect(() => {
    const el = area.current;
    if (!el || !active) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      onZoom(clampZoom(zoom * Math.exp(-event.deltaY * 0.002)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [active, onZoom, zoom]);

  function move(event: React.PointerEvent<HTMLDivElement>) {
    if (!active) return;
    const rect = area.current!.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const y = Math.min(Math.max(event.clientY - rect.top, 0), rect.height);
    setPointer({ x, y, touch: event.pointerType !== "mouse" });
  }

  const lens = pointer ?? (anchor && size.width ? { x: anchor.x * size.width, y: anchor.y * size.height, touch: false } : null);
  const r = SIZE / 2;
  return (
    <div
      ref={area}
      // kurzor by zakrýval střed lupy, ten ukazuje přesně místo pod ním
      className={cn("relative", active && pointer && !pointer.touch && "cursor-none", active && "touch-none", className)}
      onPointerMove={move}
      onPointerDown={move}
      onPointerLeave={() => setPointer(null)}
      onPointerUp={(event) => event.pointerType !== "mouse" && setPointer(null)}
      onPointerCancel={() => setPointer(null)}
    >
      {children}
      {active && lens && size.width > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-20 overflow-hidden rounded-full bg-background shadow-lg ring-2 ring-background"
          style={{ width: SIZE, height: SIZE, left: lens.x - r, top: lens.touch ? lens.y - SIZE - 24 : lens.y - r }}
        >
          {/* Zvětšená kopie fotky i s rámečkem vybraného údaje, posunutá tak, aby místo pod ukazatelem bylo uprostřed. */}
          <div
            className="absolute top-0 left-0"
            style={{ width: size.width * zoom, height: size.height * zoom, transform: `translate(${r - lens.x * zoom}px, ${r - lens.y * zoom}px)` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- tentýž soubor jako fotka pod lupou, už je v cache */}
            <img src={src} alt="" className="size-full max-w-none" draggable={false} />
            {overlay}
          </div>
        </div>
      )}
    </div>
  );
}
