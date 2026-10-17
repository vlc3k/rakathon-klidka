// ML detektor rohů dokumentu (DocCornerNet LEAN přes scanic, MIT). Stejný princip jako Google ML Kit:
// neuronová síť vrátí 4 rohy + pravděpodobnost, že v záběru je dokument. Model (1,8 MB) a odlehčený
// ONNX Runtime (0,5 MB gz) servírujeme sami z /scanner/ml/ (zkopírováno z balíčku scanic-ml).
// Model běží ve web workeru (ml.worker.ts), ať inference nesekala náhled kamery. Když worker nejde spustit
// (starý prohlížeč bez module workerů), běží jako dřív v hlavním vlákně.
import type { CornerPoints, Scanner } from "scanic";

// scanic si ML část dotahuje dynamickým importem relativně ke svému souboru. Po zabalení Next.js by ta cesta
// nevedla nikam, proto se celý scanic načítá z /public/scanner/scanic/ (zkopírováno z node_modules/scanic/dist).
const scanicUrl = () => new URL("/scanner/scanic/scanic.js", window.location.href).href;
async function loadScanic(): Promise<typeof import("scanic")> {
  return import(/* webpackIgnore: true */ /* turbopackIgnore: true */ scanicUrl());
}
import type { Corners } from "./types";

let assetBase = typeof window !== "undefined" ? new URL("/scanner/ml/", window.location.href).href : "/scanner/ml/";
let scanner: Scanner | null = null;
let ready: Promise<boolean> | null = null;
let available = false;

type Found = { corners: CornerPoints; score: number } | null;
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

// Worker s modelem; null = model běží v hlavním vlákně.
let worker: Worker | null = null;
const pending = new Map<number, Pending>();
let seq = 0;

function call<T>(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker!.postMessage({ id, ...msg }, transfer);
  });
}

function startWorker(): Promise<void> {
  worker = new Worker(new URL("./ml.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent) => {
    const { id, ok, result, error } = e.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) p.resolve(result);
    else p.reject(new Error(error));
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || "Chyba ve workeru ML"));
    pending.clear();
  };
  return call<boolean>({ type: "init", scanicUrl: scanicUrl(), assetBase }).then(() => undefined);
}

/** Odkud se stahuje model a wasm (výchozí /scanner/ml/ na vlastním originu). Volat před initMlDetector. */
export function configureMlAssets(baseUrl: string) {
  assetBase = baseUrl;
  ready = null;
  scanner = null;
  worker?.terminate();
  worker = null;
}

/** Zahřeje model (stažení + kompilace), ať první detekce nečeká. Vrací false, když ML není k dispozici. */
export function initMlDetector(): Promise<boolean> {
  return (ready ??= (async () => {
    try {
      await startWorker();
      available = true;
      return available;
    } catch (e) {
      console.warn("[doc-intake] ML ve workeru nejde, zkouším hlavní vlákno:", e);
      worker?.terminate();
      worker = null;
    }
    try {
      const { Scanner } = await loadScanic();
      scanner = new Scanner({ detector: "ml", ml: { assetBaseUrl: assetBase, minScore: 0.5 } });
      await scanner.initialize();
      available = true;
    } catch (e) {
      console.warn("[doc-intake] ML detektor není k dispozici, zůstává klasická detekce:", e);
      available = false;
    }
    return available;
  })());
}

export function mlAvailable() {
  return available;
}

function toCorners(c: CornerPoints): Corners {
  return { topLeftCorner: c.topLeft, topRightCorner: c.topRight, bottomRightCorner: c.bottomRight, bottomLeftCorner: c.bottomLeft };
}

/**
 * Najde dokument v obrázku (ImageBitmap/canvas/video). Rohy jsou v souřadnicích vstupu.
 * null = ML není k dispozici nebo si není jisté, že v záběru je dokument (score < minScore).
 * Předaná ImageBitmap zůstává volajícímu (do workeru jde kopie), může ji dál použít a pak zavřít.
 */
export async function detectMl(
  image: ImageBitmap | HTMLCanvasElement | HTMLVideoElement | ImageData,
  minScore = 0.5,
): Promise<{ corners: Corners; score: number } | null> {
  if (!(await initMlDetector())) return null;
  let r: Found;
  if (worker) {
    // Bitmapu volajícího jen zkopírujeme (malý snímek, levné), z ostatního uděláme novou a předáme bez kopie.
    // Chyba jednoho snímku = „nic nenalezeno“, ať volající nevypne celou cestu přes bitmapy.
    try {
      if (image instanceof ImageBitmap) r = await call<Found>({ type: "detect", bitmap: image, minScore });
      else {
        const bitmap = await createImageBitmap(image);
        r = await call<Found>({ type: "detect", bitmap, minScore }, [bitmap]);
      }
    } catch (e) {
      console.debug("[doc-intake] ML ve workeru selhalo na snímku:", e);
      return null;
    }
  } else {
    if (!scanner) return null;
    const res = await scanner.scan(image, { mode: "detect", detector: "ml", ml: { assetBaseUrl: assetBase, minScore } });
    r = res.success && res.corners ? { corners: res.corners, score: res.score ?? 1 } : null;
  }
  return r ? { corners: toCorners(r.corners), score: r.score } : null;
}
