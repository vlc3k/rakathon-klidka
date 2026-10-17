import { getCv, loadOpenCV } from "./opencv";
import { detectMl, mlAvailable } from "./mlDetect";
import type { Corners, FilterId, Point, Rotation, ScannedPage } from "./types";

// Delší strana pracovní kopie fotky. Musí být s rezervou nad výstupními 2000 px: papír zabírá jen část záběru
// a z 2500 px snímku vycházela A4 často kolem 1300 px, takže se při narovnání zvětšovala a pak doostřovala.
const MAX_SIDE = 3200;

/** Fotka připravená k ořezu: zmenšený obrázek + automaticky nalezené rohy (nebo null). */
export interface PreparedPhoto {
  canvas: HTMLCanvasElement;
  corners: Corners | null;
  previewUrl: string;
}

async function fileToImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function sizeOf(src: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement) {
  if (src instanceof HTMLImageElement) return { w: src.naturalWidth, h: src.naturalHeight };
  if (src instanceof HTMLVideoElement) return { w: src.videoWidth, h: src.videoHeight };
  return { w: src.width, h: src.height };
}

/** Zmenší obrázek na max. maxSide, ať detekce i upload nejsou zbytečně pomalé. */
export function downscale(src: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement, maxSide = MAX_SIDE): HTMLCanvasElement {
  const { w, h } = sizeOf(src);
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext("2d")!.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const A4 = 1 / Math.SQRT2; // 0,707 – poměr stran A4 na výšku
const A4_SNAP = 0.08; // odhad poměru u skutečné A4 vychází do pár procent, víc už je jiný papír nebo uříznutá stránka
const LONG_SIDE = 2000; // ~120 dpi na A4 (2000×1414) – dost pro čtení textu, o třetinu rychlejší zpracování než 150 dpi
const MIN_LONG_SIDE = 1400; // pod tím by bylo písmo malé i pro čtečku, i za cenu mírného zvětšení

/**
 * Skutečný poměr stran (šířka/výška) papíru z jeho perspektivního obrazu – Zhang & He, „Whiteboard scanning
 * and image enhancement“ (2007). Ze 4 rohů se odhadne ohnisková vzdálenost kamery a z ní poměr stran obdélníku
 * ve skutečnosti, takže papír focený pod úhlem nevyjde „široký“. Když je odhad ohniska nespolehlivý
 * (čistý náklon bez natočení = matematicky nejednoznačné), použije se typické ohnisko telefonu ≈ 0,75 × delší strana.
 * Ověřeno numericky: A4 nakloněná o 60° → 0,692 (skutečnost 0,707), naivní výpočet z hran dával 1,67.
 */
export function trueAspectRatio(c: Corners, imgW: number, imgH: number): number | null {
  const u0 = imgW / 2, v0 = imgH / 2;
  const P = (p: Point) => [p.x - u0, p.y - v0, 1];
  const m1 = P(c.topLeftCorner), m2 = P(c.topRightCorner), m3 = P(c.bottomLeftCorner), m4 = P(c.bottomRightCorner);
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const k2 = dot(cross(m1, m4), m3) / dot(cross(m2, m4), m3);
  const k3 = dot(cross(m1, m4), m2) / dot(cross(m3, m4), m2);
  if (!isFinite(k2) || !isFinite(k3)) return null;
  const n2 = m2.map((v, i) => k2 * v - m1[i]);
  const n3 = m3.map((v, i) => k3 * v - m1[i]);
  const L = Math.max(imgW, imgH);
  let f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
  if (!isFinite(f2) || f2 < (0.4 * L) ** 2 || f2 > (2.5 * L) ** 2) f2 = (0.75 * L) ** 2;
  const q = (n: number[]) => (n[0] * n[0] + n[1] * n[1]) / f2 + n[2] * n[2];
  const r = Math.sqrt(q(n2) / q(n3));
  return isFinite(r) && r > 0.1 && r < 10 ? r : null;
}

/**
 * Rozměr výstupu po narovnání. Poměr stran se bere ze skutečného (perspektivně opraveného) odhadu; když je
 * do 8 % od A4 (na výšku i na šířku), přichytí se přesně na 1:√2 jako v Google Disku. Jinak (účtenka,
 * kartička, uříznutá stránka) zůstane změřený poměr: dřív se přichytávalo do 30 % a uříznutá A4 se
 * na A4 natáhla, takže byla zmáčknutá. Delší strana je LONG_SIDE, ale nikdy víc než ~1,25× toho, kolik pixelů papír
 * ve fotce skutečně má: zvětšený rozmazaný obraz nic nepřidá a doostření z něj dělá „přepálený“ sken.
 */
export function outputSize(c: Corners, imgW?: number, imgH?: number) {
  const w = Math.max(dist(c.topLeftCorner, c.topRightCorner), dist(c.bottomLeftCorner, c.bottomRightCorner));
  const h = Math.max(dist(c.topLeftCorner, c.bottomLeftCorner), dist(c.topRightCorner, c.bottomRightCorner));
  let ratio = (imgW && imgH ? trueAspectRatio(c, imgW, imgH) : null) ?? w / Math.max(1, h);
  const long = Math.round(Math.min(LONG_SIDE, Math.max(MIN_LONG_SIDE, Math.max(w, h) * 1.25)));
  if (Math.abs(ratio - A4) / A4 < A4_SNAP) ratio = A4;
  else if (Math.abs(ratio - 1 / A4) / (1 / A4) < A4_SNAP) ratio = 1 / A4;
  if (ratio <= 1) return { width: Math.round(long * ratio), height: long };
  return { width: long, height: Math.round(long / ratio) };
}

/**
 * Najde rohy papíru v obrázku (ve workeru). minAreaRatio chrání proti „nalezení“ malého obdélníku
 * uprostřed – papír má zabírat podstatnou část záběru.
 */
export function detectCorners(canvas: HTMLCanvasElement, minAreaRatio = 0.2): Promise<Corners | null> {
  return getCv().detect(canvas, minAreaRatio);
}

/** Výchozí rohy, když detekce selže: obdélník odsazený 8 % od okrajů, uživatel si ho dotáhne. */
export function defaultCorners(width: number, height: number): Corners {
  const dx = width * 0.08;
  const dy = height * 0.08;
  return {
    topLeftCorner: { x: dx, y: dy },
    topRightCorner: { x: width - dx, y: dy },
    bottomLeftCorner: { x: dx, y: height - dy },
    bottomRightCorner: { x: width - dx, y: height - dy },
  };
}

/**
 * JPEG z canvasu. `canvas.toBlob` je v Chromu u velkých pláten naplněných přes putImageData/drawImage
 * extrémně pomalý (sekundy – první čtení z GPU), `OffscreenCanvas.convertToBlob` totéž zvládne za desítky ms.
 */
export async function toBlob(canvas: HTMLCanvasElement, quality = 0.9): Promise<Blob> {
  if (typeof OffscreenCanvas !== "undefined" && "convertToBlob" in OffscreenCanvas.prototype) {
    const oc = new OffscreenCanvas(canvas.width, canvas.height);
    oc.getContext("2d")!.drawImage(canvas, 0, 0);
    return oc.convertToBlob({ type: "image/jpeg", quality });
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob selhal"))), "image/jpeg", quality),
  );
}

export function scaleCorners(c: Corners, k: number): Corners {
  const s = (p: Point): Point => ({ x: p.x * k, y: p.y * k });
  return { topLeftCorner: s(c.topLeftCorner), topRightCorner: s(c.topRightCorner), bottomRightCorner: s(c.bottomRightCorner), bottomLeftCorner: s(c.bottomLeftCorner) };
}

/**
 * Najde dokument ve statickém snímku. ML detektor (robustní na nepořádek, stíny, nízký kontrast) dá hrubé rohy,
 * klasická detekce ve workeru přidá kandidáty z hran a prahů a vybere ten, který nejlépe sedí na skutečné hrany
 * papíru (ML rohy jsou mezi kandidáty). Vítěz se pak dotáhne na hrany v plném rozlišení. Když nic neprojde,
 * zůstanou hrubé rohy z ML; bez ML i bez kandidáta null (uživatel ořízne ručně).
 */
export async function findDocument(canvas: HTMLCanvasElement): Promise<Corners | null> {
  const small = downscale(canvas, 800);
  const k = canvas.width / small.width;
  const ml = await detectMl(small, 0.4);
  const mlQuads: Corners[] = [];
  if (ml) {
    mlQuads.push(ml.corners);
    const zoomed = await zoomedMl(canvas, scaleCorners(ml.corners, k));
    if (zoomed) mlQuads.push(scaleCorners(zoomed, 1 / k));
  }
  const found = await getCv()
    .find(small, mlQuads, 0.06)
    .catch(() => null);
  const best = found?.corners ?? mlQuads[mlQuads.length - 1];
  if (!best) return null;
  const rough = scaleCorners(best, k);
  const refined = await getCv()
    .refine(canvas, rough)
    .catch(() => rough);
  return insetCorners(refined, 0.004);
}

/**
 * Posune rohy o kousek (podíl úhlopříčky) ke středu. Hrana papíru je v obraze rozmazaná na pár pixelů a ořez
 * přesně na ní nechával po stranách tenkou tmavou linku stolu; skenery proto řežou těsně uvnitř.
 */
export function insetCorners(c: Corners, ratio: number): Corners {
  const pts = [c.topLeftCorner, c.topRightCorner, c.bottomRightCorner, c.bottomLeftCorner];
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const d = ratio * Math.hypot(pts[0].x - pts[2].x, pts[0].y - pts[2].y);
  const move = (p: Point): Point => {
    const len = Math.hypot(cx - p.x, cy - p.y) || 1;
    return { x: p.x + ((cx - p.x) / len) * d, y: p.y + ((cy - p.y) / len) * d };
  };
  return { topLeftCorner: move(c.topLeftCorner), topRightCorner: move(c.topRightCorner), bottomRightCorner: move(c.bottomRightCorner), bottomLeftCorner: move(c.bottomLeftCorner) };
}

/**
 * Dokument daleko (malý v záběru): druhý průchod ML „se zoomem“ – výřez kolem nalezeného papíru s okrajem,
 * znovu ML na výřezu (papír ho vyplní, síť má 224 px jen pro něj), rohy přepočítané zpět do souřadnic canvasu.
 */
async function zoomedMl(canvas: HTMLCanvasElement, rough: Corners): Promise<Corners | null> {
  const keys: (keyof Corners)[] = ["topLeftCorner", "topRightCorner", "bottomRightCorner", "bottomLeftCorner"];
  const xs = keys.map((key) => rough[key].x);
  const ys = keys.map((key) => rough[key].y);
  const bw = Math.max(...xs) - Math.min(...xs);
  const bh = Math.max(...ys) - Math.min(...ys);
  if (bw * bh >= 0.35 * canvas.width * canvas.height) return null;
  const pad = 0.2;
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - bw * pad));
  const y0 = Math.max(0, Math.floor(Math.min(...ys) - bh * pad));
  const x1 = Math.min(canvas.width, Math.ceil(Math.max(...xs) + bw * pad));
  const y1 = Math.min(canvas.height, Math.ceil(Math.max(...ys) + bh * pad));
  if (x1 - x0 <= 40 || y1 - y0 <= 40) return null;
  const crop = document.createElement("canvas");
  const cs = Math.min(1, 800 / Math.max(x1 - x0, y1 - y0));
  crop.width = Math.round((x1 - x0) * cs);
  crop.height = Math.round((y1 - y0) * cs);
  crop.getContext("2d")!.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, crop.width, crop.height);
  const ml2 = await detectMl(crop, 0.4);
  if (!ml2) return null;
  const back = (p: Point): Point => ({ x: x0 + p.x / cs, y: y0 + p.y / cs });
  const c = ml2.corners;
  return { topLeftCorner: back(c.topLeftCorner), topRightCorner: back(c.topRightCorner), bottomRightCorner: back(c.bottomRightCorner), bottomLeftCorner: back(c.bottomLeftCorner) };
}

/** Krok 1: připravit obrázek (z fotky, galerie nebo snímku kamery) – zmenšit a najít rohy. */
// fitToFrame: obrázek z počítače / galerie může být hotový sken nebo screenshot, rohy se proto ověří proti
// okrajům (fitCornersToFrame). Fotka z kamery je vždycky fotka papíru: ořízne se podle nalezených rohů i na
// světlém stole, kde by ověření „pozadí“ nenašlo.
export async function prepareCanvas(src: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement, { fitToFrame = false } = {}): Promise<PreparedPhoto> {
  const t0 = performance.now();
  await loadOpenCV();
  const canvas = downscale(src);
  const found = await findDocument(canvas);
  const corners = found && (fitToFrame ? fitCornersToFrame(canvas, found) : found);
  const previewUrl = URL.createObjectURL(await toBlob(canvas, 0.8));
  console.debug(`[doc-intake] prepare ${canvas.width}×${canvas.height}: ${(performance.now() - t0).toFixed(0)} ms, rohy ${corners ? "ano" : "ne"}, ML ${mlAvailable() ? "ano" : "ne"}`);
  return { canvas, corners, previewUrl };
}

export async function preparePhoto(file: Blob, { fitToFrame = true } = {}): Promise<PreparedPhoto> {
  const t0 = performance.now();
  const img = await fileToImage(file);
  console.debug(`[doc-intake] decode ${img.naturalWidth}×${img.naturalHeight}: ${(performance.now() - t0).toFixed(0)} ms`);
  return prepareCanvas(img, { fitToFrame });
}

/**
 * Sedí nalezené rohy na papír, nebo si je detekce domyslela? Každá strana obrázku se posoudí zvlášť:
 * je za ní pozadí (pás u okraje výrazně tmavší než papír), nebo papír pokračuje přes okraj fotky?
 * - pozadí nikde: hotový sken nebo screenshot (papír přes celý obrázek), detekce by našla jen vnitřní
 *   obdélník s textem, ořízla ho a zkosila → bez ořezu (null), oříznout jde ručně,
 * - pozadí jen někde: papír je u ostatních stran uříznutý (třeba chybí dolejšek), tam ořez zůstane na hraně
 *   fotky místo domyšleného rohu,
 * - pozadí všude: ořez podle nalezených rohů.
 */
export function fitCornersToFrame(canvas: HTMLCanvasElement, corners: Corners): Corners | null {
  const pts = [corners.topLeftCorner, corners.topRightCorner, corners.bottomRightCorner, corners.bottomLeftCorner];
  const area = Math.abs(pts.reduce((sum, p, i) => sum + p.x * pts[(i + 1) % 4].y - pts[(i + 1) % 4].x * p.y, 0)) / 2;
  if (area < 0.2 * canvas.width * canvas.height) return null;

  const small = downscale(canvas, 200);
  const { width: w, height: h } = small;
  const data = small.getContext("2d")!.getImageData(0, 0, w, h).data;
  const luma = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };
  const mean = (x0: number, y0: number, x1: number, y1: number) => {
    let sum = 0, n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        sum += luma(x, y);
        n++;
      }
    }
    return n ? sum / n : 0;
  };

  // papír: prostřední 40 % čtyřúhelníku, 75. percentil jasu (text je tmavý, papír mezi ním světlý)
  const k = w / canvas.width;
  const xs = pts.map((p) => p.x * k);
  const ys = pts.map((p) => p.y * k);
  const [qx0, qx1, qy0, qy1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const values: number[] = [];
  for (let y = Math.round(qy0 + (qy1 - qy0) * 0.3); y < Math.round(qy1 - (qy1 - qy0) * 0.3); y++) {
    for (let x = Math.round(qx0 + (qx1 - qx0) * 0.3); x < Math.round(qx1 - (qx1 - qx0) * 0.3); x++) values.push(luma(x, y));
  }
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const paper = values[Math.floor(values.length * 0.75)];

  // pás 4 % u každé strany obrázku: tmavší než papír = pozadí, jinak papír pokračuje přes okraj
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  const background = (luminance: number) => luminance < paper - 40;
  const side = {
    top: background(mean(0, 0, w, band)),
    bottom: background(mean(0, h - band, w, h)),
    left: background(mean(0, 0, band, h)),
    right: background(mean(w - band, 0, w, h)),
  };
  if (!side.top && !side.bottom && !side.left && !side.right) return null;

  // kde papír pokračuje, posunout tu stranu ořezu na hranu fotky
  const W = canvas.width, H = canvas.height;
  const fit = { ...corners, topLeftCorner: { ...corners.topLeftCorner }, topRightCorner: { ...corners.topRightCorner }, bottomLeftCorner: { ...corners.bottomLeftCorner }, bottomRightCorner: { ...corners.bottomRightCorner } };
  if (!side.top) fit.topLeftCorner.y = fit.topRightCorner.y = 0;
  if (!side.bottom) fit.bottomLeftCorner.y = fit.bottomRightCorner.y = H;
  if (!side.left) fit.topLeftCorner.x = fit.bottomLeftCorner.x = 0;
  if (!side.right) fit.topRightCorner.x = fit.bottomRightCorner.x = W;

  // Pojistka proti uříznutému textu: kde je za stranou pozadí, ale hned za čarou řezu je ještě papír
  // (detekce řízla dovnitř stránky), posune se ta strana ven, dokud nezačne pozadí nebo okraj fotky.
  // Raději kousek stolu navíc než uříznutý řádek.
  const toSmall = (p: Point): Point => ({ x: p.x * k, y: p.y * k });
  // Pás souběžně s hranou ve vzdálenosti d: 40. percentil jasu. Papír (i s řádkem textu, písmo zabere menšinu
  // pásu) vyjde světlý; stůl, rozmazaný přechod na hraně papíru i pás, který papír jen zčásti protíná
  // (natočená stránka), vyjdou tmavší.
  const stripLuma = (a: Point, b: Point, nx: number, ny: number, d: number) => {
    const values: number[] = [];
    for (let t = 0.1; t <= 0.9; t += 0.02) {
      const x = Math.round(a.x + (b.x - a.x) * t + nx * d);
      const y = Math.round(a.y + (b.y - a.y) * t + ny * d);
      if (x < 0 || y < 0 || x >= w || y >= h) return null;
      values.push(luma(x, y));
    }
    values.sort((p, q) => p - q);
    return values[Math.floor(values.length * 0.4)];
  };
  const clearlyPaper = (luminance: number) => luminance >= paper - 25;
  const step = Math.max(1, Math.min(w, h) * 0.01);
  const center = { x: pts.reduce((sum, p) => sum + p.x, 0) / 4, y: pts.reduce((sum, p) => sum + p.y, 0) / 4 };
  const grow = (from: keyof Corners, to: keyof Corners) => {
    const a = toSmall(fit[from]), b = toSmall(fit[to]);
    // kolmice na hranu směrem ven (od středu papíru), ať to sedí i na natočený papír
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    const mid = { x: (a.x + b.x) / 2 - center.x * k, y: (a.y + b.y) / 2 - center.y * k };
    if (nx * mid.x + ny * mid.y < 0) {
      nx = -nx;
      ny = -ny;
    }
    let d = 0;
    for (let next = step; next <= Math.min(w, h) * 0.3; next += step) {
      const l = stripLuma(a, b, nx, ny, next);
      if (l === null || !clearlyPaper(l)) break; // okraj fotky, pozadí nebo hrana papíru
      d = next;
    }
    if (!d) return;
    const D = d / k;
    fit[from] = { x: fit[from].x + nx * D, y: fit[from].y + ny * D };
    fit[to] = { x: fit[to].x + nx * D, y: fit[to].y + ny * D };
  };
  if (side.top) grow("topLeftCorner", "topRightCorner");
  if (side.bottom) grow("bottomLeftCorner", "bottomRightCorner");
  if (side.left) grow("topLeftCorner", "bottomLeftCorner");
  if (side.right) grow("topRightCorner", "bottomRightCorner");

  // nikdy ven z obrázku
  const clamp = (p: Point): Point => ({ x: Math.min(W, Math.max(0, p.x)), y: Math.min(H, Math.max(0, p.y)) });
  return { topLeftCorner: clamp(fit.topLeftCorner), topRightCorner: clamp(fit.topRightCorner), bottomRightCorner: clamp(fit.bottomRightCorner), bottomLeftCorner: clamp(fit.bottomLeftCorner) };
}

export function rotateCanvas(src: HTMLCanvasElement, rotation: Rotation): HTMLCanvasElement {
  if (rotation === 0) return src;
  const out = document.createElement("canvas");
  const swap = rotation === 90 || rotation === 270;
  out.width = swap ? src.height : src.width;
  out.height = swap ? src.width : src.height;
  const ctx = out.getContext("2d")!;
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
}

/**
 * „Skenerové“ vylepšení ve workeru (jako Enhance v Disku): vyrovnání osvětlení papíru, odstranění stínů,
 * kontrast a doostření textu; `color` přidá sytost, `grayscale` dá čistý černobílý dokument.
 */
export function applyFilter(src: HTMLCanvasElement, filter: FilterId): Promise<HTMLCanvasElement> {
  return getCv().enhance(src, filter);
}

export interface RenderOptions {
  /** null = bez ořezu */
  corners: Corners | null;
  rotation: Rotation;
  filter: FilterId;
  /** vrstva „Vyčistit“ v prostoru oříznuté a otočené stránky (stejné rozměry) */
  cleanLayer?: HTMLCanvasElement | null;
}

/** Ořez → otočení → vyčištění → filtr. Vrací hotový canvas stránky. */
export async function renderCanvas(prep: PreparedPhoto, opts: RenderOptions): Promise<HTMLCanvasElement> {
  const t0 = performance.now();
  let c: HTMLCanvasElement = prep.canvas;
  if (opts.corners) {
    const { width, height } = outputSize(opts.corners, prep.canvas.width, prep.canvas.height);
    c = await getCv().warp(prep.canvas, opts.corners, width, height);
  }
  const t1 = performance.now();
  c = rotateCanvas(c, opts.rotation);
  if (opts.cleanLayer && opts.cleanLayer.width === c.width && opts.cleanLayer.height === c.height) {
    const out = document.createElement("canvas");
    out.width = c.width;
    out.height = c.height;
    const ctx = out.getContext("2d")!;
    ctx.drawImage(c, 0, 0);
    ctx.drawImage(opts.cleanLayer, 0, 0);
    c = out;
  }
  const result = await applyFilter(c, opts.filter);
  console.debug(`[doc-intake] render ${c.width}×${c.height}: warp ${(t1 - t0).toFixed(0)} ms, filtr ${opts.filter} ${(performance.now() - t1).toFixed(0)} ms`);
  return result;
}

export async function renderPage(prep: PreparedPhoto, opts: RenderOptions): Promise<ScannedPage> {
  const canvas = await renderCanvas(prep, opts);
  const blob = await toBlob(canvas);
  return { blob, width: canvas.width, height: canvas.height, corrected: !!opts.corners, previewUrl: URL.createObjectURL(blob) };
}

export interface CropOptions {
  /** false = ponechat barvy (filtr auto) místo stupňů šedi */
  enhance?: boolean;
}

/** Zpětně kompatibilní zkratka: oříznout podle rohů a vrátit stránku. */
export function cropPhoto(prep: PreparedPhoto, corners: Corners | null, opts: CropOptions = {}): Promise<ScannedPage> {
  return renderPage(prep, { corners, rotation: 0, filter: opts.enhance === false ? "auto" : "grayscale" });
}

/** Zkratka bez ručního zásahu: fotka → sken podle automaticky nalezených rohů. */
export async function processPhoto(file: Blob, opts: CropOptions = {}): Promise<ScannedPage> {
  const prep = await preparePhoto(file);
  try {
    return await cropPhoto(prep, prep.corners, opts);
  } finally {
    URL.revokeObjectURL(prep.previewUrl);
  }
}

/** Odhad barvy papíru (pro gumu „Vyčistit“): medián světlých pixelů ze zmenšeného náhledu. */
export function estimatePaperColor(canvas: HTMLCanvasElement): string {
  const small = downscale(canvas, 64);
  const data = small.getContext("2d")!.getImageData(0, 0, small.width, small.height).data;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (lum > 150) {
      rs.push(data[i]);
      gs.push(data[i + 1]);
      bs.push(data[i + 2]);
    }
  }
  if (!rs.length) return "#ffffff";
  const med = (a: number[]) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
  return `rgb(${med(rs)},${med(gs)},${med(bs)})`;
}
