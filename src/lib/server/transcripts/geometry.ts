import "server-only";
import sharp from "sharp";
import { pageToPhoto, type Point, type Quad } from "@/lib/server/transcripts/homography";

// Natočená nebo šikmo vyfocená stránka. Na fotce najde papír (světlý čtyřúhelník na tmavším podkladu),
// narovná ho perspektivní korekcí a AI pak čte rovnou stránku: řádky jsou vodorovné a obdélník kolem
// řádku má výšku jednoho řádku. Obdélníky se pak přepočítají zpět na čtyřúhelníky v původní fotce,
// takže zvýraznění kopíruje natočení i zkosení textu. Lékař dál vidí fotku tak, jak ji pacient nahrál.
//
// Když papír najít nejde (fotka je už oříznutý sken, rušivé pozadí), čte se fotka beze změny.

const DETECT_SIDE = 512; // na hledání papíru stačí malý náhled
const MAX_OUTPUT_SIDE = 2000; // narovnaná stránka pro AI

export async function findPage(image: Uint8Array): Promise<Quad | null> {
  const { data, info } = await sharp(image).rotate().resize(DETECT_SIDE, DETECT_SIDE, { fit: "inside" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const threshold = otsu(data);

  // Největší souvislá světlá oblast = papír.
  const label = new Int32Array(w * h).fill(-1);
  let best: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (label[start] !== -1 || data[start] < threshold) continue;
    const region: number[] = [];
    label[start] = start;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      region.push(i);
      const x = i % w;
      for (const n of [i - w, i + w, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1]) {
        if (n >= 0 && n < w * h && label[n] === -1 && data[n] >= threshold) {
          label[n] = start;
          stack.push(n);
        }
      }
    }
    if (region.length > best.length) best = region;
  }
  if (best.length < w * h * 0.2) return null;

  // Rohy jako krajní body oblasti ve směrech úhlopříček.
  let tl = best[0], tr = best[0], br = best[0], bl = best[0];
  const sum = (i: number) => (i % w) + Math.floor(i / w);
  const diff = (i: number) => (i % w) - Math.floor(i / w);
  for (const i of best) {
    if (sum(i) < sum(tl)) tl = i;
    if (sum(i) > sum(br)) br = i;
    if (diff(i) > diff(tr)) tr = i;
    if (diff(i) < diff(bl)) bl = i;
  }
  const quad = [tl, tr, br, bl].map((i) => [(i % w + 0.5) / w, (Math.floor(i / w) + 0.5) / h] as Point) as Quad;
  return plausible(quad, best.length / (w * h)) ? quad : null;
}

// Papír musí být opravdu čtyřúhelník: konvexní, rozumné úhly, zabírá většinu oblasti
// a není to celá fotka (to je už oříznutý sken, není co rovnat).
function plausible(quad: Quad, fill: number) {
  const area = Math.abs(quad.reduce((s, [x, y], i) => s + x * quad[(i + 1) % 4][1] - quad[(i + 1) % 4][0] * y, 0)) / 2;
  if (area < 0.2 || area > 0.92) return false;
  if (fill / area < 0.85) return false; // oblast ve čtyřúhelníku musí být skoro celá papír
  for (let i = 0; i < 4; i++) {
    const [a, b, c] = [quad[(i + 3) % 4], quad[i], quad[(i + 1) % 4]];
    const u = [a[0] - b[0], a[1] - b[1]], v = [c[0] - b[0], c[1] - b[1]];
    const cos = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v));
    if (Math.abs(cos) > 0.5) return false; // úhel mimo 60–120°
  }
  return true;
}

// Práh mezi papírem a podkladem (Otsuova metoda).
function otsu(data: Uint8Array) {
  const hist = new Array(256).fill(0);
  for (const v of data) hist[v]++;
  const total = data.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0, wB = 0, best = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sumAll - sumB) / wF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold + 1;
}

/** Narovná stránku: perspektivní korekce čtyřúhelníku na obdélník (JPEG). */
export async function rectify(image: Uint8Array, quad: Quad): Promise<Uint8Array> {
  const { data, info } = await sharp(image).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const px = quad.map(([x, y]) => [x * W, y * H] as Point);
  const side = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let outW = Math.max(side(px[0], px[1]), side(px[3], px[2]));
  let outH = Math.max(side(px[0], px[3]), side(px[1], px[2]));
  const scale = Math.min(1, MAX_OUTPUT_SIDE / Math.max(outW, outH));
  outW = Math.round(outW * scale);
  outH = Math.round(outH * scale);

  const toSource = pageToPhoto(quad);
  const out = Buffer.alloc(outW * outH * C);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const [u, v] = toSource([(x + 0.5) / outW, (y + 0.5) / outH]);
      const sx = Math.min(W - 1.001, Math.max(0, u * W - 0.5));
      const sy = Math.min(H - 1.001, Math.max(0, v * H - 0.5));
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      for (let c = 0; c < C; c++) {
        const p = (yy: number, xx: number) => data[(yy * W + xx) * C + c];
        const top = p(y0, x0) * (1 - fx) + p(y0, x0 + 1) * fx;
        const bottom = p(y0 + 1, x0) * (1 - fx) + p(y0 + 1, x0 + 1) * fx;
        out[(y * outW + x) * C + c] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }
  return new Uint8Array(await sharp(out, { raw: { width: outW, height: outH, channels: C } }).jpeg({ quality: 90 }).toBuffer());
}
