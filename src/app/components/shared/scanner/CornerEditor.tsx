"use client";

import { useRef, useState } from "react";
import type { Corners, Point } from "@/lib/scanner/types";

type CornerKey = keyof Corners;
const ORDER: CornerKey[] = ["topLeftCorner", "topRightCorner", "bottomRightCorner", "bottomLeftCorner"];
/** hrany jako dvojice rohů; tažením středu hrany se posouvají oba její rohy */
const EDGES: [CornerKey, CornerKey][] = [
  ["topLeftCorner", "topRightCorner"],
  ["topRightCorner", "bottomRightCorner"],
  ["bottomRightCorner", "bottomLeftCorner"],
  ["bottomLeftCorner", "topLeftCorner"],
];

export interface CornerEditorProps {
  previewUrl: string;
  width: number;
  height: number;
  corners: Corners;
  onChange: (corners: Corners) => void;
}

type Drag = { kind: "corner"; key: CornerKey } | { kind: "edge"; index: number; last: Point };

/**
 * Ořez jako v Google Disku: čtyři rohy a čtyři středy hran k přetažení, při tažení rohu lupa.
 * Vše je v SVG s viewBoxem v pixelech obrázku, takže souřadnice rohů jsou rovnou souřadnice pro ořez.
 */
export function CornerEditor({ previewUrl, width, height, corners, onChange }: CornerEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [loupeAt, setLoupeAt] = useState<Point | null>(null);

  const unit = Math.max(width, height) / 100;
  const handleR = unit * 2.2;
  const loupeR = unit * 11;
  const zoom = 2.5;

  function toImageCoords(e: React.PointerEvent): Point | null {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: Math.min(width, Math.max(0, pt.x)), y: Math.min(height, Math.max(0, pt.y)) };
  }

  function startCorner(key: CornerKey) {
    return (e: React.PointerEvent) => {
      drag.current = { kind: "corner", key };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      setLoupeAt(corners[key]);
      e.preventDefault();
    };
  }

  function startEdge(index: number) {
    return (e: React.PointerEvent) => {
      const p = toImageCoords(e);
      if (!p) return;
      drag.current = { kind: "edge", index, last: p };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      e.preventDefault();
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const p = toImageCoords(e);
    if (!p) return;
    if (d.kind === "corner") {
      onChange({ ...corners, [d.key]: p });
      setLoupeAt(p);
    } else {
      const dx = p.x - d.last.x;
      const dy = p.y - d.last.y;
      const [a, b] = EDGES[d.index];
      const clamp = (q: Point): Point => ({ x: Math.min(width, Math.max(0, q.x)), y: Math.min(height, Math.max(0, q.y)) });
      onChange({
        ...corners,
        [a]: clamp({ x: corners[a].x + dx, y: corners[a].y + dy }),
        [b]: clamp({ x: corners[b].x + dx, y: corners[b].y + dy }),
      });
      d.last = p;
    }
  }

  function endDrag() {
    drag.current = null;
    setLoupeAt(null);
  }

  const pts = ORDER.map((k) => corners[k]);
  const points = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const mids = EDGES.map(([a, b]) => ({ x: (corners[a].x + corners[b].x) / 2, y: (corners[a].y + corners[b].y) / 2 }));

  // lupa: kroužek nad prstem, uvnitř 2,5× zvětšený výřez kolem taženého rohu
  const loupe = loupeAt
    ? (() => {
        const cx = Math.min(width - loupeR, Math.max(loupeR, loupeAt.x));
        const above = loupeAt.y - loupeR * 2.6;
        const cy = above > loupeR ? above : Math.min(height - loupeR, loupeAt.y + loupeR * 2.6);
        return { cx, cy, tx: cx - loupeAt.x * zoom, ty: cy - loupeAt.y * zoom };
      })()
    : null;

  return (
    <svg
      ref={svgRef}
      className="block max-h-full max-w-full touch-none select-none"
      viewBox={`0 0 ${width} ${height}`}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      role="img"
      aria-label="Úprava ořezu dokumentu"
    >
      <defs>
        <clipPath id="dsc-loupe-clip">{loupe && <circle cx={loupe.cx} cy={loupe.cy} r={loupeR} />}</clipPath>
      </defs>
      <image href={previewUrl} width={width} height={height} />
      {/* ztmavení mimo vybranou plochu */}
      <path
        d={`M0,0 H${width} V${height} H0 Z M${points.split(" ").join(" L")} Z`}
        fill="rgba(0,0,0,0.5)"
        fillRule="evenodd"
        pointerEvents="none"
      />
      <polygon points={points} fill="none" stroke="#000" strokeWidth={unit * 0.9} pointerEvents="none" />
      <polygon points={points} fill="none" stroke="#fff" strokeWidth={unit * 0.45} pointerEvents="none" />

      {mids.map((m, i) => (
        <g key={i} onPointerDown={startEdge(i)} style={{ cursor: "move", touchAction: "none" }}>
          <circle cx={m.x} cy={m.y} r={handleR * 2} fill="transparent" />
          <rect
            x={m.x - handleR * 0.9}
            y={m.y - handleR * 0.45}
            width={handleR * 1.8}
            height={handleR * 0.9}
            rx={handleR * 0.45}
            fill="#fff"
            stroke="#000"
            strokeWidth={unit * 0.35}
          />
        </g>
      ))}

      {ORDER.map((k) => (
        <g key={k} onPointerDown={startCorner(k)} style={{ cursor: "grab", touchAction: "none" }}>
          <circle cx={corners[k].x} cy={corners[k].y} r={handleR * 2.4} fill="transparent" />
          <circle cx={corners[k].x} cy={corners[k].y} r={handleR} fill="#fff" stroke="#000" strokeWidth={unit * 0.45} />
        </g>
      ))}

      {loupe && loupeAt && (
        <g pointerEvents="none">
          <g clipPath="url(#dsc-loupe-clip)">
            <image href={previewUrl} width={width} height={height} transform={`translate(${loupe.tx} ${loupe.ty}) scale(${zoom})`} />
            <polygon points={points} fill="none" stroke="#000" strokeWidth={unit * 0.3} transform={`translate(${loupe.tx} ${loupe.ty}) scale(${zoom})`} />
          </g>
          <circle cx={loupe.cx} cy={loupe.cy} r={loupeR} fill="none" stroke="#fff" strokeWidth={unit * 0.6} />
          <line x1={loupe.cx - unit * 2} y1={loupe.cy} x2={loupe.cx + unit * 2} y2={loupe.cy} stroke="#fff" strokeWidth={unit * 0.3} />
          <line x1={loupe.cx} y1={loupe.cy - unit * 2} x2={loupe.cx} y2={loupe.cy + unit * 2} stroke="#fff" strokeWidth={unit * 0.3} />
        </g>
      )}
    </svg>
  );
}
