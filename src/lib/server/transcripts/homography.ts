// Perspektiva stránky: bod na narovnané stránce ↔ bod v původní fotce. Bez závislostí, ať jde použít i v testech.

export type Point = [number, number];
/** Rohy stránky v původní fotce, poměrově 0–1: levý horní, pravý horní, pravý dolní, levý dolní. */
export type Quad = [Point, Point, Point, Point];

/** Bod na narovnané stránce (0–1) → bod v původní fotce (0–1). */
export function pageToPhoto(quad: Quad) {
  const m = solve([[0, 0], [1, 0], [1, 1], [0, 1]], quad);
  return ([x, y]: Point): Point => {
    const d = m[6] * x + m[7] * y + 1;
    return [(m[0] * x + m[1] * y + m[2]) / d, (m[3] * x + m[4] * y + m[5]) / d];
  };
}

/** Obdélník na narovnané stránce (0–1000, jako box řádku) → čtyřúhelník v původní fotce (0–1). */
export function boxToQuad([x0, y0, x1, y1]: [number, number, number, number], quad: Quad): Quad {
  const map = pageToPhoto(quad);
  return ([[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as Point[]).map(([x, y]) => map([x / 1000, y / 1000])) as Quad;
}

// Projektivní zobrazení ze 4 bodů na 4 body (8 neznámých, Gaussova eliminace).
function solve(from: Point[], to: Point[]) {
  const a: number[][] = [];
  from.forEach(([x, y], i) => {
    const [u, v] = to[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  });
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      for (let c = col; c < 9; c++) a[r][c] -= f * a[col][c];
    }
  }
  return a.map((row, i) => row[8] / row[i]);
}
