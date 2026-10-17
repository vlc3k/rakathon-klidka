/// <reference lib="webworker" />
// ML detektor rohů (scanic) ve web workeru: inference modelu trvá na telefonu desítky až stovky ms a v hlavním
// vlákně by sekala náhled kamery. scanic umí OffscreenCanvas, takže ve workeru běží beze změn.
import type { Scanner } from "scanic";

type InitReq = { id: number; type: "init"; scanicUrl: string; assetBase: string };
type DetectReq = { id: number; type: "detect"; bitmap: ImageBitmap; minScore: number };

let scanner: Scanner | null = null;
let assetBase = "";

self.onmessage = async (e: MessageEvent<InitReq | DetectReq>) => {
  const msg = e.data;
  try {
    if (msg.type === "init") {
      const { Scanner } = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ msg.scanicUrl)) as typeof import("scanic");
      assetBase = msg.assetBase;
      scanner = new Scanner({ detector: "ml", ml: { assetBaseUrl: assetBase, minScore: 0.5 } });
      await scanner.initialize();
      self.postMessage({ id: msg.id, ok: true, result: true });
      return;
    }
    if (!scanner) throw new Error("ML detektor není načtený");
    const r = await scanner.scan(msg.bitmap, { mode: "detect", detector: "ml", ml: { assetBaseUrl: assetBase, minScore: msg.minScore } });
    msg.bitmap.close();
    self.postMessage({ id: msg.id, ok: true, result: r.success && r.corners ? { corners: r.corners, score: r.score ?? 1 } : null });
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
