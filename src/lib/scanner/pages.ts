import { renderPage, type PreparedPhoto } from "./scan";
import type { Corners, FilterId, Point, Rotation, ScannedPage } from "./types";

/** Stránka ve skeneru: originál + úpravy (ořez, otočení, filtr, vyčištění) + vykreslený výsledek. */
export interface Page {
  id: string;
  prep: PreparedPhoto;
  /** aktuální ořez; null = bez ořezu */
  corners: Corners | null;
  rotation: Rotation;
  filter: FilterId;
  /** tahy gumy „Vyčistit“ v prostoru oříznuté a otočené stránky */
  cleanLayer: HTMLCanvasElement | null;
  rendered: ScannedPage | null;
}

let seq = 0;

export function newPage(prep: PreparedPhoto): Page {
  return { id: `p${Date.now()}-${seq++}`, prep, corners: prep.corners, rotation: 0, filter: "auto", cleanLayer: null, rendered: null };
}

/** Přepočítá výsledek stránky po změně úprav (uvolní starý náhled). */
export async function rerender(page: Page): Promise<Page> {
  if (page.rendered) URL.revokeObjectURL(page.rendered.previewUrl);
  const t0 = performance.now();
  const rendered = await renderPage(page.prep, {
    corners: page.corners,
    rotation: page.rotation,
    filter: page.filter,
    cleanLayer: page.cleanLayer,
  });
  console.debug(`[doc-intake] rerender celkem: ${(performance.now() - t0).toFixed(0)} ms`);
  return { ...page, rendered };
}

export function disposePage(page: Page) {
  URL.revokeObjectURL(page.prep.previewUrl);
  if (page.rendered) URL.revokeObjectURL(page.rendered.previewUrl);
}

export function nextRotation(r: Rotation): Rotation {
  return ((r + 90) % 360) as Rotation;
}

/** Bod z originálu do otočeného zobrazení (W, H = rozměry originálu). */
export function rotatePoint(p: Point, rot: Rotation, W: number, H: number): Point {
  switch (rot) {
    case 90:
      return { x: H - p.y, y: p.x };
    case 180:
      return { x: W - p.x, y: H - p.y };
    case 270:
      return { x: p.y, y: W - p.x };
    default:
      return p;
  }
}

/** Bod z otočeného zobrazení zpět do originálu. */
export function unrotatePoint(p: Point, rot: Rotation, W: number, H: number): Point {
  switch (rot) {
    case 90:
      return { x: p.y, y: H - p.x };
    case 180:
      return { x: W - p.x, y: H - p.y };
    case 270:
      return { x: W - p.y, y: p.x };
    default:
      return p;
  }
}

export function rotateCorners(c: Corners, rot: Rotation, W: number, H: number): Corners {
  const r = (p: Point) => rotatePoint(p, rot, W, H);
  // po otočení o 90° se role rohů posunou: levý horní je bývalý levý dolní atd.
  switch (rot) {
    case 90:
      return { topLeftCorner: r(c.bottomLeftCorner), topRightCorner: r(c.topLeftCorner), bottomRightCorner: r(c.topRightCorner), bottomLeftCorner: r(c.bottomRightCorner) };
    case 180:
      return { topLeftCorner: r(c.bottomRightCorner), topRightCorner: r(c.bottomLeftCorner), bottomRightCorner: r(c.topLeftCorner), bottomLeftCorner: r(c.topRightCorner) };
    case 270:
      return { topLeftCorner: r(c.topRightCorner), topRightCorner: r(c.bottomRightCorner), bottomRightCorner: r(c.bottomLeftCorner), bottomLeftCorner: r(c.topLeftCorner) };
    default:
      return c;
  }
}

export function unrotateCorners(c: Corners, rot: Rotation, W: number, H: number): Corners {
  const u = (p: Point) => unrotatePoint(p, rot, W, H);
  switch (rot) {
    case 90:
      return { bottomLeftCorner: u(c.topLeftCorner), topLeftCorner: u(c.topRightCorner), topRightCorner: u(c.bottomRightCorner), bottomRightCorner: u(c.bottomLeftCorner) };
    case 180:
      return { bottomRightCorner: u(c.topLeftCorner), bottomLeftCorner: u(c.topRightCorner), topLeftCorner: u(c.bottomRightCorner), topRightCorner: u(c.bottomLeftCorner) };
    case 270:
      return { topRightCorner: u(c.topLeftCorner), bottomRightCorner: u(c.topRightCorner), bottomLeftCorner: u(c.bottomRightCorner), topLeftCorner: u(c.bottomLeftCorner) };
    default:
      return c;
  }
}
