/* eslint-disable @typescript-eslint/no-explicit-any -- OpenCV.js nemá typy, odpovědi workeru jsou netypované */
// OpenCV.js (~11 MB) běží ve web workeru – načtení, detekce i narovnání jdou mimo hlavní vlákno,
// takže UI na telefonu nezamrzá. Výchozí zdroj je vlastní kopie (/opencv.js), záloha oficiální CDN.
import type { Corners, FilterId } from "./types";

const DEFAULT_URLS = ["/scanner/opencv.js", "https://docs.opencv.org/4.x/opencv.js"];

function toCanvas(image: ImageData | ImageBitmap): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = image.width;
  c.height = image.height;
  const ctx = c.getContext("2d")!;
  if (image instanceof ImageBitmap) {
    ctx.drawImage(image, 0, 0);
    image.close();
  } else {
    ctx.putImageData(image, 0, 0);
  }
  return c;
}

let urls = [...DEFAULT_URLS];
let client: CvClient | null = null;

/** Nastaví, odkud se OpenCV.js stáhne (např. z vlastního CDN). Volat před prvním otevřením skeneru. */
export function configureOpenCV(...sources: string[]) {
  urls = sources.length ? sources : [...DEFAULT_URLS];
  client?.terminate();
  client = null;
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

class CvClient {
  private worker: Worker;
  private pending = new Map<number, Pending>();
  private seq = 0;
  readonly ready: Promise<void>;

  constructor(sources: string[]) {
    this.worker = new Worker(new URL("./cv.worker.ts", import.meta.url));
    this.worker.onmessage = (e: MessageEvent) => {
      const { id, ok, result, error } = e.data;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (ok) p.resolve(result);
      else p.reject(new Error(error));
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || "Chyba ve workeru OpenCV"));
      this.pending.clear();
    };
    // absolutní URL, ať importScripts ve workeru míří na stejný origin
    const abs = sources.map((u) => new URL(u, window.location.href).href);
    this.ready = this.call({ type: "init", urls: abs });
  }

  private call(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<any> {
    const id = ++this.seq;
    const t0 = performance.now();
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => {
          console.debug(`[doc-intake] worker ${msg.type}: ${(performance.now() - t0).toFixed(0)} ms`);
          resolve(v);
        },
        reject,
      });
      this.worker.postMessage({ id, ...msg }, transfer);
    });
  }

  async detect(canvas: HTMLCanvasElement, minAreaRatio: number): Promise<Corners | null> {
    await this.ready;
    const image = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    return this.call({ type: "detect", image, minAreaRatio }, [image.data.buffer]);
  }

  /** Nejlepší čtyřúhelník papíru z klasických kandidátů a hrubých rohů z ML (ohodnocených podle hran). */
  async find(canvas: HTMLCanvasElement, mlQuads: Corners[], minAreaRatio: number): Promise<{ corners: Corners; score: number } | null> {
    await this.ready;
    const image = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    return this.call({ type: "find", image, mlQuads, minAreaRatio }, [image.data.buffer]);
  }

  /** Dotažení rohů (např. z ML detektoru) na skutečné hrany v obraze. */
  async refine(canvas: HTMLCanvasElement, corners: Corners): Promise<Corners> {
    await this.ready;
    const image = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    return this.call({ type: "refine", image, corners }, [image.data.buffer]);
  }

  /** Detekce z ImageBitmap (zmenšený snímek videa) – bitmapa se předá workeru bez kopie. */
  async detectBitmap(bitmap: ImageBitmap, minAreaRatio: number): Promise<Corners | null> {
    await this.ready;
    return this.call({ type: "detect", bitmap, minAreaRatio }, [bitmap]);
  }

  async warp(canvas: HTMLCanvasElement, corners: Corners, width: number, height: number): Promise<HTMLCanvasElement> {
    await this.ready;
    const image = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    const out: ImageData | ImageBitmap = await this.call({ type: "warp", image, corners, width, height }, [image.data.buffer]);
    return toCanvas(out);
  }

  /** „Skenerové“ vylepšení: vyrovnání osvětlení, kontrast, doostření, varianta podle filtru. */
  async enhance(canvas: HTMLCanvasElement, filter: FilterId): Promise<HTMLCanvasElement> {
    if (filter === "none") return canvas;
    await this.ready;
    const image = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    const out: ImageData | ImageBitmap = await this.call({ type: "enhance", image, filter }, [image.data.buffer]);
    return toCanvas(out);
  }

  terminate() {
    this.worker.terminate();
  }
}

export function getCv(): CvClient {
  return (client ??= new CvClient(urls));
}

/** Spustí worker a počká, až je OpenCV připravené. Lze volat opakovaně, inicializace proběhne jednou. */
export function loadOpenCV(): Promise<void> {
  return getCv().ready.catch((e) => {
    client?.terminate();
    client = null; // další pokus může zkusit znovu
    throw e;
  });
}
