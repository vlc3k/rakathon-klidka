/* eslint-disable @typescript-eslint/no-explicit-any -- OpenCV.js (cv) nemá typy */
/// <reference lib="webworker" />
// Web worker s OpenCV.js. Všechna těžká práce (načtení 11 MB knihovny, detekce okrajů, perspektivní
// narovnání, „skenerové“ vylepšení obrazu) běží tady, aby hlavní vlákno a UI na telefonu nezamrzaly.
// Detekce rohů původně vycházela z jscanify (MIT, ColonelParrot), teď sbírá kandidáty z více masek a hodnotí je.

import { cornersToArray, intersect, maxAngleCos, orderCorners, pickBestQuad, ransacLine, type GrayImage, type QuadCandidate } from "./geometry";
import type { Corners, FilterId, Point } from "./types";

declare function importScripts(...urls: string[]): void;

type InitReq = { id: number; type: "init"; urls: string[] };
type DetectReq = { id: number; type: "detect"; image?: ImageData; bitmap?: ImageBitmap; minAreaRatio: number };
type WarpReq = { id: number; type: "warp"; image: ImageData; corners: Corners; width: number; height: number };
type EnhanceReq = { id: number; type: "enhance"; image: ImageData; filter: FilterId };
type RefineReq = { id: number; type: "refine"; image: ImageData; corners: Corners };
type FindReq = { id: number; type: "find"; image: ImageData; mlQuads: Corners[]; minAreaRatio: number };
type Req = InitReq | DetectReq | WarpReq | EnhanceReq | RefineReq | FindReq;

let CV: any = null;

async function init(urls: string[]) {
  let lastErr: unknown;
  for (const url of urls) {
    try {
      importScripts(url);
      const mod = (self as any).cv;
      if (!mod) throw new Error(`OpenCV z ${url} nevytvořilo objekt cv`);
      // POZOR: `cv` je thenable, který se resolvuje sám na sebe – `await cv` by se zacyklil navždy.
      // Proto čekáme jen na signál a hodnotu ignorujeme.
      if (typeof mod.Mat !== "function") {
        await new Promise<void>((res, rej) => {
          if (typeof mod.then === "function") mod.then(() => res(), rej);
          else mod.onRuntimeInitialized = () => res();
          setTimeout(() => (typeof mod.Mat === "function" ? res() : rej(new Error("OpenCV se neinicializovalo do 60 s"))), 60000);
        });
      }
      if (typeof mod.Mat !== "function") throw new Error(`OpenCV z ${url} se neinicializovalo`);
      CV = mod;
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("OpenCV.js se nepodařilo načíst");
}

/** Uvolní všechny Maty, i když něco selže. */
function withMats<T>(fn: (track: <M>(m: M) => M) => T): T {
  const mats: any[] = [];
  const track = <M,>(m: M): M => {
    mats.push(m);
    return m;
  };
  try {
    return fn(track);
  } finally {
    for (const m of mats) m?.delete?.();
  }
}

// ---------------------------------------------------------------- detekce

/** Čtyřúhelník z masky: rohy po obvodu + body obrysu, ze kterých se pak dotahují přímky stran. */
type Quad = { pts: Point[]; contour: Int32Array };

function matPoints(m: any): Point[] {
  const d = m.data32S as Int32Array;
  return Array.from({ length: d.length / 2 }, (_, k) => ({ x: d[k * 2], y: d[k * 2 + 1] }));
}

/** Zjednoduší obrys na 4 body (zkouší několik přesností), nebo null. */
function approxQuad(c: any, epsilons: number[]): Point[] | null {
  const peri = CV.arcLength(c, true);
  for (const eps of epsilons) {
    const approx = new CV.Mat();
    try {
      CV.approxPolyDP(c, approx, eps * peri, true);
      if (approx.rows === 4 && CV.isContourConvex(approx)) return matPoints(approx);
    } finally {
      approx.delete();
    }
  }
  return null;
}

/**
 * Kandidáti z binární masky (hrany nebo práh): několik největších obrysů, každý zjednodušený na čtyřúhelník.
 * Když obrys čtyřúhelník nedá (palec přes hranu udělá zářez, hrnek se slije s rohem), zkusí se jeho konvexní
 * obal – zářezy zmizí a zbude obdélník papíru. Přesné rohy pak dotáhne refineQuad z bodů obrysu.
 */
function quadsFromMask(mask: any, minArea: number, maxArea: number, track: <M>(m: M) => M): Quad[] {
  const contours = track(new CV.MatVector());
  const hierarchy = track(new CV.Mat());
  CV.findContours(mask, contours, hierarchy, CV.RETR_LIST, CV.CHAIN_APPROX_NONE);
  const big: { i: number; area: number }[] = [];
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    const area = CV.contourArea(c);
    c.delete();
    if (area >= minArea * 0.6 && area <= maxArea) big.push({ i, area });
  }
  big.sort((a, b) => b.area - a.area);
  const out: Quad[] = [];
  for (const { i } of big.slice(0, 6)) {
    const c = contours.get(i);
    const hull = new CV.Mat();
    try {
      const contour = Int32Array.from(c.data32S as Int32Array);
      const direct = approxQuad(c, [0.015, 0.025, 0.04]);
      if (direct) out.push({ pts: direct, contour });
      CV.convexHull(c, hull, false, true);
      const viaHull = approxQuad(hull, [0.02, 0.04, 0.06, 0.08]);
      if (viaHull) out.push({ pts: viaHull, contour });
    } finally {
      hull.delete();
      c.delete();
    }
  }
  return out;
}

/**
 * Zpřesnění rohů jako ve skenerech: body obrysu se rozdělí k nejbližší straně hrubého čtyřúhelníku a pro každou
 * stranu se RANSACem najde přímka, kterou podporuje nejvíc bodů; rohy jsou průsečíky sousedních přímek.
 * Předmět přes okraj (prst, tužka) má proti stovkám bodů rovné hrany jen hrstku bodů, takže rohy neodtáhne.
 */
function refineQuad(q: Quad, W: number, H: number): Point[] {
  const data = q.contour;
  const n = data.length / 2;
  const pts = q.pts;
  const sides = [0, 1, 2, 3].map((i) => {
    const a = pts[i], b = pts[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return { a, b, len, sel: [] as number[] };
  });
  if (sides.some((s) => s.len < 2)) return pts;

  // každý bod k nejbližší straně (podle vzdálenosti k úsečce), max 12 % délky strany daleko
  for (let k = 0; k < n; k++) {
    const px = data[k * 2], py = data[k * 2 + 1];
    let bi = -1, bd = Infinity;
    for (let i = 0; i < 4; i++) {
      const s = sides[i];
      const t = Math.max(0, Math.min(1, ((px - s.a.x) * (s.b.x - s.a.x) + (py - s.a.y) * (s.b.y - s.a.y)) / (s.len * s.len)));
      const d = Math.hypot(px - (s.a.x + t * (s.b.x - s.a.x)), py - (s.a.y + t * (s.b.y - s.a.y)));
      if (d < bd) { bd = d; bi = i; }
    }
    if (bi >= 0 && bd < sides[bi].len * 0.12) sides[bi].sel.push(px, py);
  }

  const lines = sides.map((s) =>
    ransacLine(s.sel, Math.max(1.5, s.len * 0.006), { vx: (s.b.x - s.a.x) / s.len, vy: (s.b.y - s.a.y) / s.len, x0: s.a.x, y0: s.a.y }),
  );
  const refined: Point[] = [];
  for (let i = 0; i < 4; i++) {
    const p = intersect(lines[(i + 3) % 4], lines[i]);
    if (!p || p.x < -0.05 * W || p.x > 1.05 * W || p.y < -0.05 * H || p.y > 1.05 * H) return pts;
    refined.push(p);
  }
  return maxAngleCos(refined) > 0.7 ? pts : refined;
}

/**
 * Souřadnice nenulových pixelů masky jako [x0,y0,x1,y1,…]. Naše sestavení OpenCV.js nemá findNonZero
 * (dřívější dotažení rohů z ML na něm vždy spadlo a tiše se vracely hrubé rohy), proto ruční průchod.
 */
function nonZeroPoints(mask: any): Int32Array {
  const d = mask.data as Uint8Array;
  const w = mask.cols;
  let n = 0;
  for (let i = 0; i < d.length; i++) if (d[i]) n++;
  const out = new Int32Array(n * 2);
  for (let i = 0, k = 0; i < d.length; i++) {
    if (!d[i]) continue;
    out[k++] = i % w;
    out[k++] = (i / w) | 0;
  }
  return out;
}

/** Canny s prahy podle průměrného jasu (jako dřív) – hrany pro dotahování rohů. */
function cannyByMean(blur: any, track: <M>(m: M) => M): any {
  const mean = CV.mean(blur)[0];
  const edges = track(new CV.Mat());
  CV.Canny(blur, edges, Math.max(10, 0.5 * mean), Math.min(255, 1.3 * mean + 20), 3, false);
  return edges;
}

/**
 * Dotažení hrubých rohů (z ML detektoru) na skutečné hrany: body hran v pásu kolem každé strany → RANSAC přímka →
 * průsečíky. Roh se přijme jen tehdy, když zůstane blízko původního (`limit` × délka strany) – hrubé rohy určují,
 * kde dokument je, hrany jen zpřesňují.
 */
function refineOnEdges(edgePts: Int32Array, corners: Corners, band = 0.04, limit = 0.03): Corners {
  const n = edgePts.length / 2;
  const pts = cornersToArray(corners);
  const sides = [0, 1, 2, 3].map((i) => {
    const a = pts[i], b = pts[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return { a, b, len, nx: -(b.y - a.y) / len, ny: (b.x - a.x) / len, sel: [] as number[] };
  });
  if (sides.some((s) => s.len < 10)) return corners;

  for (let k = 0; k < n; k++) {
    const px = edgePts[k * 2], py = edgePts[k * 2 + 1];
    for (let i = 0; i < 4; i++) {
      const s = sides[i];
      const dist = Math.abs((px - s.a.x) * s.nx + (py - s.a.y) * s.ny);
      if (dist > s.len * band) continue;
      const t = ((px - s.a.x) * (s.b.x - s.a.x) + (py - s.a.y) * (s.b.y - s.a.y)) / (s.len * s.len);
      if (t > 0.03 && t < 0.97) s.sel.push(px, py); // bez samotných rohů, kde se hrany kříží
    }
  }

  const lines = sides.map((s) =>
    ransacLine(s.sel, Math.max(1.5, s.len * 0.004), { vx: (s.b.x - s.a.x) / s.len, vy: (s.b.y - s.a.y) / s.len, x0: s.a.x, y0: s.a.y }),
  );
  const refined = [...pts];
  for (let i = 0; i < 4; i++) {
    const p = intersect(lines[(i + 3) % 4], lines[i]);
    if (!p) continue;
    const lim = Math.min(sides[i].len, sides[(i + 3) % 4].len) * limit;
    if (Math.hypot(p.x - pts[i].x, p.y - pts[i].y) <= lim) refined[i] = p;
  }
  if (maxAngleCos(refined) > 0.7) return corners;
  return { topLeftCorner: refined[0], topRightCorner: refined[1], bottomRightCorner: refined[2], bottomLeftCorner: refined[3] };
}

/**
 * Najde papír v obraze. Kandidáti se sbírají z několika pohledů na snímek, protože žádný sám nestačí:
 * - hrany (Canny) při třech citlivostech – nejnižší chytí bílý papír na světlém stole,
 * - Otsu práh jasu (světlý papír na tmavším stole),
 * - Otsu práh sytosti (šedobílý papír na barevném stole nebo vzorovaném ubrusu),
 * - hrubé rohy z ML detektoru (pokud jsou), samotné i dotažené na hrany.
 * Každý kandidát se zpřesní přímkami stran a ohodnotí podporou hran (edgeSupport): vyhraje ten, jehož strany
 * po celé délce leží na skutečném přechodu papír/stůl. Tím vypadnou čtyřúhelníky kolem bloku textu, vzoru
 * ubrusu nebo papíru slitého s hrnkem. Vrací rohy v souřadnicích obrazu, nebo null.
 */
function find(image: ImageData, mlQuads: Corners[], minAreaRatio: number): { corners: Corners; score: number } | null {
  return withMats((track) => {
    const src = track(CV.matFromImageData(image));
    const W = image.width, H = image.height;
    const minArea = W * H * minAreaRatio;
    const maxArea = W * H * 0.98; // celý snímek není dokument

    const gray = track(new CV.Mat());
    CV.cvtColor(src, gray, CV.COLOR_RGBA2GRAY);
    const blur = track(new CV.Mat());
    CV.GaussianBlur(gray, blur, new CV.Size(5, 5), 0, 0, CV.BORDER_DEFAULT);
    const g: GrayImage = { data: blur.data as Uint8Array, width: W, height: H };

    const quads: Quad[] = [];
    const kernel = track(CV.getStructuringElement(CV.MORPH_RECT, new CV.Size(3, 3)));
    const meanEdges = cannyByMean(blur, track);
    for (const [lo, hi] of [[-1, -1], [30, 90], [8, 24]]) {
      let edges = meanEdges;
      if (lo >= 0) {
        edges = track(new CV.Mat());
        CV.Canny(blur, edges, lo, hi, 3, false);
      }
      const joined = track(new CV.Mat());
      CV.dilate(edges, joined, kernel, new CV.Point(-1, -1), 2, CV.BORDER_CONSTANT, CV.morphologyDefaultBorderValue());
      quads.push(...quadsFromMask(joined, minArea, maxArea, track));
    }

    const thresh = track(new CV.Mat());
    CV.threshold(blur, thresh, 0, 255, CV.THRESH_BINARY + CV.THRESH_OTSU);
    quads.push(...quadsFromMask(thresh, minArea, maxArea, track));

    const rgb = track(new CV.Mat());
    const hsv = track(new CV.Mat());
    CV.cvtColor(src, rgb, CV.COLOR_RGBA2RGB);
    CV.cvtColor(rgb, hsv, CV.COLOR_RGB2HSV);
    const ch = track(new CV.MatVector());
    CV.split(hsv, ch);
    const sat = track(ch.get(1));
    CV.GaussianBlur(sat, sat, new CV.Size(5, 5), 0, 0, CV.BORDER_DEFAULT);
    const satMask = track(new CV.Mat());
    CV.threshold(sat, satMask, 0, 255, CV.THRESH_BINARY_INV + CV.THRESH_OTSU);
    quads.push(...quadsFromMask(satMask, minArea, maxArea, track));

    const cands: QuadCandidate[] = [];
    for (const q of quads) {
      cands.push({ pts: q.pts });
      cands.push({ pts: refineQuad(q, W, H) });
    }
    if (mlQuads.length) {
      const edgePts = nonZeroPoints(meanEdges);
      for (const m of mlQuads) {
        cands.push({ pts: cornersToArray(m), fromMl: true });
        cands.push({ pts: cornersToArray(refineOnEdges(edgePts, m, 0.06, 0.05)), fromMl: true });
      }
    }
    // každý kandidát po obvodu ve stejném pořadí (TL, TR, BR, BL), ať strany v edgeSupport sedí
    const ordered = cands.map((c) => ({ ...c, pts: cornersToArray(orderCorners(c.pts)) }));
    const best = pickBestQuad(g, ordered, minArea);
    return best && { corners: orderCorners(best.pts), score: best.score };
  });
}

/** Zpětně kompatibilní detekce bez ML (záložní cesta hledáčku a detectCorners). */
function detect(image: ImageData, minAreaRatio: number): Corners | null {
  return find(image, [], minAreaRatio)?.corners ?? null;
}

/** Dotažení rohů (z ML nebo z menšího náhledu) na skutečné hrany ve plném rozlišení. */
function refineWithEdges(image: ImageData, corners: Corners): Corners {
  return withMats((track) => {
    const src = track(CV.matFromImageData(image));
    const gray = track(new CV.Mat());
    CV.cvtColor(src, gray, CV.COLOR_RGBA2GRAY);
    const blur = track(new CV.Mat());
    CV.GaussianBlur(gray, blur, new CV.Size(5, 5), 0, 0, CV.BORDER_DEFAULT);
    return refineOnEdges(nonZeroPoints(cannyByMean(blur, track)), corners);
  });
}

// ---------------------------------------------------------------- narovnání

function warpMat(src: any, c: Corners, width: number, height: number, track: <M>(m: M) => M): any {
  const dst = track(new CV.Mat());
  const srcTri = track(
    CV.matFromArray(4, 1, CV.CV_32FC2, [
      c.topLeftCorner.x, c.topLeftCorner.y,
      c.topRightCorner.x, c.topRightCorner.y,
      c.bottomLeftCorner.x, c.bottomLeftCorner.y,
      c.bottomRightCorner.x, c.bottomRightCorner.y,
    ]),
  );
  const dstTri = track(CV.matFromArray(4, 1, CV.CV_32FC2, [0, 0, width, 0, 0, height, width, height]));
  const M = track(CV.getPerspectiveTransform(srcTri, dstTri));
  CV.warpPerspective(src, dst, M, new CV.Size(width, height), CV.INTER_LINEAR, CV.BORDER_REPLICATE, new CV.Scalar());
  return dst;
}

function toImageData(rgba: any): ImageData {
  return new ImageData(new Uint8ClampedArray(rgba.data), rgba.cols, rgba.rows);
}

function warp(image: ImageData, c: Corners, width: number, height: number): ImageData {
  return withMats((track) => {
    const src = track(CV.matFromImageData(image));
    return toImageData(warpMat(src, c, width, height, track));
  });
}

// ---------------------------------------------------------------- „skenerové“ vylepšení

/**
 * Odhad osvětlení papíru v malém rozlišení (delší strana ~256 px): maximum v okolí (dilatace) smaže tmavý text
 * a tenké čáry, medián zbytky. Velké tmavé nebo barevné plochy (fotka, logo, razítko) by se ale za „pozadí“
 * vzaly taky a po vydělení by vybledly do bíla. Proto se pozadí bere jen tam, kde je světlé a skoro bez barvy
 * jako papír; jinde se dopočítá z okolního papíru (normalizovaná konvoluce).
 */
function estimateBackground(rgb: any, track: <M>(m: M) => M): any {
  const w = rgb.cols, h = rgb.rows;
  const k = 256 / Math.max(w, h);
  const sw = Math.max(16, Math.round(w * k)), sh = Math.max(16, Math.round(h * k));
  const small = track(new CV.Mat());
  CV.resize(rgb, small, new CV.Size(sw, sh), 0, 0, CV.INTER_AREA);
  const kernel = track(CV.getStructuringElement(CV.MORPH_ELLIPSE, new CV.Size(7, 7)));
  CV.dilate(small, small, kernel);
  CV.medianBlur(small, small, 5);

  const d = small.data as Uint8Array;
  const n = sw * sh;
  // barva papíru = medián nejsvětlejší třetiny (papír tvoří většinu stránky)
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = 0.299 * d[i * 3] + 0.587 * d[i * 3 + 1] + 0.114 * d[i * 3 + 2];
  const sorted = Float32Array.from(lum).sort();
  const cut = sorted[Math.floor(n * 0.66)];
  const paper = [0, 1, 2].map((c) => {
    const vals: number[] = [];
    for (let i = 0; i < n; i++) if (lum[i] >= cut) vals.push(d[i * 3 + c]);
    vals.sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)] ?? 255;
  });
  const paperLum = 0.299 * paper[0] + 0.587 * paper[1] + 0.114 * paper[2];
  const paperChroma = Math.max(...paper) - Math.min(...paper);

  // maska papíru: ne o moc tmavší (stín ano, fotka ne) a bez výrazné barvy navíc
  const masked = new Float32Array(n * 3);
  const weight = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = d[i * 3], g = d[i * 3 + 1], b = d[i * 3 + 2];
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    if (lum[i] >= 0.45 * paperLum && chroma <= paperChroma + 28) {
      weight[i] = 1;
      masked[i * 3] = r; masked[i * 3 + 1] = g; masked[i * 3 + 2] = b;
    }
  }
  const mMat = track(CV.matFromArray(sh, sw, CV.CV_32FC3, Array.from(masked)));
  const wMat = track(CV.matFromArray(sh, sw, CV.CV_32FC1, Array.from(weight)));
  const sigma = 0.08 * Math.max(sw, sh);
  CV.GaussianBlur(mMat, mMat, new CV.Size(0, 0), sigma);
  CV.GaussianBlur(wMat, wMat, new CV.Size(0, 0), sigma);
  const md = mMat.data32F as Float32Array, wd = wMat.data32F as Float32Array;
  const bgArr = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const v = weight[i] ? d[i * 3 + c] : wd[i] > 0.02 ? md[i * 3 + c] / wd[i] : paper[c];
      bgArr[i * 3 + c] = Math.max(1, Math.min(255, Math.round(v)));
    }
  }
  const bgSmall = track(CV.matFromArray(sh, sw, CV.CV_8UC3, Array.from(bgArr)));
  CV.GaussianBlur(bgSmall, bgSmall, new CV.Size(0, 0), 1.5);
  const bg = track(new CV.Mat());
  CV.resize(bgSmall, bg, new CV.Size(w, h), 0, 0, CV.INTER_LINEAR);
  return bg;
}

/**
 * Jako „Enhance“ v Google Disku, ale šetrně, aby sken nevypadal přepáleně a čtečka (OCR) měla čisté písmo:
 * 1. odhad osvětlení papíru (estimateBackground),
 * 2. vydělení každého kanálu osvětlením: stíny i nažloutlé světlo zmizí, papír je bílý, barvy zůstanou,
 * 3. úrovně: papír kousek pod maximem → čistě bílá, černý bod ze 70 % nejtmavších 0,5 %: běžný tisk se skoro
 *    nezmění, bledý (přesvícená fotka, vybledlá páska) se roztáhne, aby ho čtečka přečetla,
 * 4. jemné doostření jen jasu (bez barevných lemů), varianta podle filtru.
 * Dřív tu byl kontrast 1,25–1,45× kolem středu a silná maska ostrosti (1,6×) na už vyděleném obrázku:
 * šum a JPEG artefakty z fotky se zesílily, kolem písmen vznikly světlé lemy a tmavé plochy se slily do černé.
 */
function enhanceMat(rgba: any, filter: FilterId, track: <M>(m: M) => M): any {
  const w = rgba.cols;
  const h = rgba.rows;
  const rgb = track(new CV.Mat());
  CV.cvtColor(rgba, rgb, CV.COLOR_RGBA2RGB);
  const bg = estimateBackground(rgb, track);

  const s = rgb.data as Uint8Array;
  const b = bg.data as Uint8Array;
  const n = w * h;

  // černý bod z histogramu jasu po normalizaci (vzorkujeme každý 7. pixel, stačí)
  const hist = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i < n; i += 7) {
    const l = (0.299 * s[i * 3]) / b[i * 3] + (0.587 * s[i * 3 + 1]) / b[i * 3 + 1] + (0.114 * s[i * 3 + 2]) / b[i * 3 + 2];
    hist[Math.min(255, Math.round(l * 255))]++;
    count++;
  }
  let acc = 0, p05 = 0;
  for (; p05 < 255; p05++) if ((acc += hist[p05]) >= count * 0.005) break;
  const black = Math.min(0.5, (p05 / 255) * 0.7);
  const white = filter === "grayscale" ? 0.94 : 0.96;
  const scale = 255 / (white - black);

  const out = track(new CV.Mat(h, w, CV.CV_8UC3));
  const o = out.data as Uint8Array;
  for (let i = 0; i < n * 3; i++) {
    const v = (s[i] / b[i] - black) * scale;
    o[i] = v <= 0 ? 0 : v >= 255 ? 255 : v;
  }

  // jemné doostření (0,35×, sigma 1): písmo je ostřejší, lemy kolem něj nejsou vidět
  const blurred = track(new CV.Mat());
  CV.GaussianBlur(out, blurred, new CV.Size(0, 0), 1.0);
  CV.addWeighted(out, 1.35, blurred, -0.35, 0, out);

  const result = track(new CV.Mat());
  if (filter === "grayscale") {
    const gray = track(new CV.Mat());
    CV.cvtColor(out, gray, CV.COLOR_RGB2GRAY);
    CV.cvtColor(gray, result, CV.COLOR_GRAY2RGBA);
  } else if (filter === "color") {
    // barevný: o 15 % sytější (razítka, zvýraznění), ne víc
    const hsv = track(new CV.Mat());
    CV.cvtColor(out, hsv, CV.COLOR_RGB2HSV);
    const ch = track(new CV.MatVector());
    CV.split(hsv, ch);
    const sat = ch.get(1);
    sat.convertTo(sat, -1, 1.15, 0);
    ch.set(1, sat);
    sat.delete();
    CV.merge(ch, hsv);
    const rgb2 = track(new CV.Mat());
    CV.cvtColor(hsv, rgb2, CV.COLOR_HSV2RGB);
    CV.cvtColor(rgb2, result, CV.COLOR_RGB2RGBA);
  } else {
    CV.cvtColor(out, result, CV.COLOR_RGB2RGBA);
  }
  return result;
}

function enhance(image: ImageData, filter: FilterId): ImageData {
  if (filter === "none") return image;
  return withMats((track) => {
    const src = track(CV.matFromImageData(image));
    return toImageData(enhanceMat(src, filter, track));
  });
}

// ---------------------------------------------------------------- zprávy

let scratch: OffscreenCanvas | null = null;

/** ImageBitmap (zmenšený snímek z videa) → pixely, přes OffscreenCanvas ve workeru. */
function bitmapToImageData(bmp: ImageBitmap): ImageData {
  if (typeof OffscreenCanvas === "undefined") throw new Error("OffscreenCanvas není ve workeru k dispozici");
  if (!scratch || scratch.width !== bmp.width || scratch.height !== bmp.height) scratch = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = scratch.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, scratch.width, scratch.height);
}

/**
 * Výsledný obrázek posíláme jako ImageBitmap (přenos bez kopie, hlavní vlákno ho jen nakreslí přes drawImage –
 * putImageData 17 MB by na telefonu trvalo stovky ms). Kde createImageBitmap není, padá to na ImageData.
 */
async function sendImage(id: number, image: ImageData) {
  if (typeof createImageBitmap === "function") {
    const bmp = await createImageBitmap(image);
    (self as any).postMessage({ id, ok: true, result: bmp }, [bmp]);
  } else {
    (self as any).postMessage({ id, ok: true, result: image }, [image.data.buffer]);
  }
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const msg = e.data;
  try {
    if (msg.type === "init") {
      await init(msg.urls);
      self.postMessage({ id: msg.id, ok: true });
    } else if (msg.type === "detect") {
      const image = msg.image ?? bitmapToImageData(msg.bitmap!);
      self.postMessage({ id: msg.id, ok: true, result: detect(image, msg.minAreaRatio) });
    } else if (msg.type === "warp") {
      await sendImage(msg.id, warp(msg.image, msg.corners, msg.width, msg.height));
    } else if (msg.type === "enhance") {
      await sendImage(msg.id, enhance(msg.image, msg.filter));
    } else if (msg.type === "find") {
      self.postMessage({ id: msg.id, ok: true, result: find(msg.image, msg.mlQuads, msg.minAreaRatio) });
    } else if (msg.type === "refine") {
      self.postMessage({ id: msg.id, ok: true, result: refineWithEdges(msg.image, msg.corners) });
    }
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
