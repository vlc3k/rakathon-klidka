// Čistá geometrie skeneru (bez OpenCV a DOM): řazení rohů, kontrola tvaru čtyřúhelníku, přímky
// a hodnocení, jak dobře čtyřúhelník sedí na skutečné hrany papíru. Běží ve workeru a dá se testovat v Node.
import type { Corners, Point } from "./types";

export const CORNER_KEYS = ["topLeftCorner", "topRightCorner", "bottomRightCorner", "bottomLeftCorner"] as const;

export function cornersToArray(c: Corners): Point[] {
  return CORNER_KEYS.map((k) => c[k]);
}

/**
 * Seřadí 4 body na levý horní, pravý horní, pravý dolní, levý dolní. Body se nejdřív seřadí podle úhlu kolem
 * těžiště (pořadí po obvodu), pak se za levý horní vezme ten s nejmenším x+y. Řazení jen podle součtu a rozdílu
 * souřadnic selhává u papíru natočeného kolem 45°, kde dva rohy můžou vyjít jako „levý horní“ zároveň.
 */
export function orderCorners(pts: Point[]): Corners {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  // v obrazových souřadnicích (y dolů) rostoucí atan2 = po směru hodinových ručiček
  const ring = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let start = 0;
  for (let i = 1; i < ring.length; i++) if (ring[i].x + ring[i].y < ring[start].x + ring[start].y) start = i;
  const o = [0, 1, 2, 3].map((i) => ring[(start + i) % 4]);
  return { topLeftCorner: o[0], topRightCorner: o[1], bottomRightCorner: o[2], bottomLeftCorner: o[3] };
}

/** Největší |cos| vnitřního úhlu čtyřúhelníku: 0 = pravé úhly, 1 = zdegenerovaný. */
export function maxAngleCos(p: Point[]): number {
  let worst = 0;
  for (let i = 0; i < 4; i++) {
    const a = p[(i + 3) % 4], b = p[i], c = p[(i + 1) % 4];
    const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
    const cos = Math.abs((v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) + 1e-6));
    worst = Math.max(worst, cos);
  }
  return worst;
}

/** Plocha mnohoúhelníku (shoelace), body po obvodu. */
export function polygonArea(p: Point[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** Konvexní čtyřúhelník bez překřížení: všechny vektorové součiny sousedních hran mají stejné znaménko. */
export function isConvexQuad(p: Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = p[i], b = p[(i + 1) % 4], c = p[(i + 2) % 4];
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-9) return false;
    const s = Math.sign(z);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

/** Věrohodný tvar papíru v perspektivě: konvexní, úhly zhruba 45–135°, rozumný poměr protilehlých stran. */
export function plausibleQuad(p: Point[], maxCos = 0.7): boolean {
  if (!isConvexQuad(p) || maxAngleCos(p) > maxCos) return false;
  const len = (i: number) => Math.hypot(p[(i + 1) % 4].x - p[i].x, p[(i + 1) % 4].y - p[i].y);
  const r1 = Math.min(len(0), len(2)) / Math.max(len(0), len(2), 1e-6);
  const r2 = Math.min(len(1), len(3)) / Math.max(len(1), len(3), 1e-6);
  return r1 > 0.3 && r2 > 0.3;
}

// ---------------------------------------------------------------- přímky

export type Line = { vx: number; vy: number; x0: number; y0: number };

export function intersect(l1: Line, l2: Line): Point | null {
  const det = l1.vx * l2.vy - l1.vy * l2.vx;
  if (Math.abs(det) < 1e-6) return null;
  const t = ((l2.x0 - l1.x0) * l2.vy - (l2.y0 - l1.y0) * l2.vx) / det;
  return { x: l1.x0 + t * l1.vx, y: l1.y0 + t * l1.vy };
}

/** Přímka metodou nejmenších čtverců (PCA) body [x0,y0,x1,y1,…]. */
export function lsqLine(sel: number[]): Line {
  const n = sel.length / 2;
  let mx = 0, my = 0;
  for (let k = 0; k < n; k++) { mx += sel[k * 2]; my += sel[k * 2 + 1]; }
  mx /= n; my /= n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let k = 0; k < n; k++) {
    const dx = sel[k * 2] - mx, dy = sel[k * 2 + 1] - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  // hlavní vlastní vektor kovarianční matice
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { vx: Math.cos(theta), vy: Math.sin(theta), x0: mx, y0: my };
}

/** RANSAC: přímka podporovaná největším počtem bodů (inlier = do `tol` px), dotažená nejmenšími čtverci. */
export function ransacLine(pts: number[], tol: number, fallback: Line): Line {
  const n = pts.length / 2;
  if (n < 8) return fallback;
  let best = -1;
  let bestLine = fallback;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let it = 0; it < 70; it++) {
    const i = Math.floor(rnd() * n), j = Math.floor(rnd() * n);
    if (i === j) continue;
    const ax = pts[i * 2], ay = pts[i * 2 + 1], bx = pts[j * 2], by = pts[j * 2 + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < tol * 4) continue;
    const nx = -(by - ay) / len, ny = (bx - ax) / len;
    let count = 0;
    for (let k = 0; k < n; k++) if (Math.abs((pts[k * 2] - ax) * nx + (pts[k * 2 + 1] - ay) * ny) <= tol) count++;
    if (count > best) {
      best = count;
      bestLine = { vx: (bx - ax) / len, vy: (by - ay) / len, x0: ax, y0: ay };
    }
  }
  if (best < 8) return fallback;
  // dotažení: nejmenší čtverce přes inliery nejlepší přímky
  const nx = -bestLine.vy, ny = bestLine.vx;
  const inl: number[] = [];
  for (let k = 0; k < n; k++) {
    if (Math.abs((pts[k * 2] - bestLine.x0) * nx + (pts[k * 2 + 1] - bestLine.y0) * ny) <= tol) inl.push(pts[k * 2], pts[k * 2 + 1]);
  }
  return inl.length >= 8 ? lsqLine(inl) : bestLine;
}

// ---------------------------------------------------------------- hodnocení čtyřúhelníku

/** Šedý obrázek jako plochý buffer (0–255), řádek po řádku. */
export interface GrayImage {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

function sample(g: GrayImage, x: number, y: number): number {
  const xi = Math.min(g.width - 1, Math.max(0, Math.round(x)));
  const yi = Math.min(g.height - 1, Math.max(0, Math.round(y)));
  return g.data[yi * g.width + xi];
}

/**
 * Jak dobře čtyřúhelník sedí na hranu papíru (0–1). Na každé straně se vezme ~32 bodů a porovná se jas kousek
 * uvnitř a kousek vně. Na skutečné hraně je rozdíl zřetelný a na celé straně stejného znaménka (papír světlejší
 * než stůl, nebo naopak). Čára vedená přes blok textu, vzor ubrusu nebo léta dřeva dává rozdíly náhodných
 * znamének, které se navzájem odečtou, takže skóre je nízké. Palec přes kus hrany ubere jen část bodů jedné strany.
 * Výsledek kombinuje průměr stran s nejslabší stranou, aby trojice dobrých stran nevytáhla jednu vymyšlenou.
 */
export function edgeSupport(g: GrayImage, pts: Point[], minDiff = 3): number {
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
  const d = Math.max(2, 0.008 * Math.hypot(g.width, g.height));
  const N = 32;
  const sides: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 4) return 0;
    let nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    // normála ven z čtyřúhelníku
    if (((a.x + b.x) / 2 - cx) * nx + ((a.y + b.y) / 2 - cy) * ny < 0) {
      nx = -nx; ny = -ny;
    }
    let pos = 0, neg = 0, valid = 0;
    for (let k = 0; k < N; k++) {
      const t = 0.06 + (0.88 * k) / (N - 1);
      const px = a.x + t * (b.x - a.x), py = a.y + t * (b.y - a.y);
      const ox = px + d * nx, oy = py + d * ny;
      // body vně snímku nic neříkají (papír přes okraj záběru)
      if (ox < 0 || oy < 0 || ox > g.width - 1 || oy > g.height - 1) continue;
      valid++;
      const diff = sample(g, px - d * nx, py - d * ny) - sample(g, ox, oy);
      if (diff > minDiff) pos++;
      else if (diff < -minDiff) neg++;
    }
    sides.push(valid ? Math.abs(pos - neg) / N : 0);
  }
  const mean = sides.reduce((s, v) => s + v, 0) / 4;
  return 0.6 * mean + 0.4 * Math.min(...sides);
}

/** Kandidát na papír: rohy po obvodu a jestli pochází z ML detektoru (ten má při podobném skóre přednost). */
export interface QuadCandidate {
  pts: Point[];
  fromMl?: boolean;
}

/**
 * Vybere nejlepší čtyřúhelník: věrohodný tvar, plocha aspoň minArea, nejvyšší podpora hran. Při podobném skóre
 * vyhraje větší (papír, ne blok textu na něm) a kandidát od ML detektoru. Pod `minScore` vrací null.
 */
export function pickBestQuad(g: GrayImage, cands: QuadCandidate[], minArea: number, minScore = 0.5): { pts: Point[]; score: number } | null {
  const total = g.width * g.height;
  let best: { pts: Point[]; score: number; rank: number } | null = null;
  for (const c of cands) {
    if (!plausibleQuad(c.pts)) continue;
    const area = polygonArea(c.pts);
    if (area < minArea || area > total * 0.99) continue;
    const score = edgeSupport(g, c.pts);
    if (score < minScore) continue;
    const rank = score + 0.25 * (area / total) + (c.fromMl ? 0.1 : 0);
    if (!best || rank > best.rank) best = { pts: c.pts, score, rank };
  }
  return best && { pts: best.pts, score: best.score };
}
