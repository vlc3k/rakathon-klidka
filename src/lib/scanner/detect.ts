import { getCv } from "./opencv";
import { detectMl, mlAvailable } from "./mlDetect";
import { detectCorners } from "./scan";
import type { Corners, Point } from "./types";

const WORK_WIDTH = 400; // detekce běží na malém snímku (400 px stačí na hrany papíru, worker to zvládne ~10× za s)

// Fallback: čtení přes canvas. Bez willReadFrequently – to by nutilo prohlížeč kopírovat celý 4K snímek z GPU.
const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
let bitmapPathBroken = false;

/**
 * Najde dokument v aktuálním snímku videa; rohy vrací v souřadnicích videa.
 * Rychlá cesta: createImageBitmap(video, resize) zmenší snímek na GPU a bitmapa se bez kopie předá workeru,
 * který ji přečte v OffscreenCanvas. Hlavní vlákno tak nikdy nesahá na plný 4K snímek (na telefonu ~800 ms).
 */
export async function detectInVideo(video: HTMLVideoElement, work: HTMLCanvasElement): Promise<Corners | null> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const scale = WORK_WIDTH / vw;
  const h = Math.max(1, Math.round(vh * scale));

  let found: Corners | null = null;
  if (!bitmapPathBroken && typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(video, { resizeWidth: WORK_WIDTH, resizeHeight: h, resizeQuality: "low" });
      // Nejdřív ML. Když dokument nevidí (bílý papír na světlém stole, papír daleko), zkusí se klasická detekce:
      // ta kandidáty hodnotí podle toho, jestli strany leží na skutečné hraně papíru, takže bloky textu
      // a předměty na stole neprojdou.
      const ml = mlAvailable() ? await detectMl(bmp, 0.4) : null;
      if (ml) {
        found = ml.corners;
        bmp.close();
      } else {
        // OpenCV se může ještě načítat nebo selhat – to není chyba cesty přes bitmapu, jen tenhle snímek nic nenajde
        found = await getCv()
          .detectBitmap(bmp, 0.15)
          .catch(() => {
            bmp.close();
            return null;
          });
      }
    } catch {
      bitmapPathBroken = true; // prohlížeč to neumí (starší Safari) – dál už jen přes canvas
      found = await detectViaCanvas(video, work, h);
    }
  } else {
    found = await detectViaCanvas(video, work, h);
  }

  if (!found) return null;
  const up = (p: Point): Point => ({ x: p.x / scale, y: p.y / scale });
  return {
    topLeftCorner: up(found.topLeftCorner),
    topRightCorner: up(found.topRightCorner),
    bottomLeftCorner: up(found.bottomLeftCorner),
    bottomRightCorner: up(found.bottomRightCorner),
  };
}

async function detectViaCanvas(video: HTMLVideoElement, work: HTMLCanvasElement, h: number): Promise<Corners | null> {
  if (work.width !== WORK_WIDTH || work.height !== h) {
    work.width = WORK_WIDTH;
    work.height = h;
  }
  let ctx = contexts.get(work);
  if (!ctx) {
    ctx = work.getContext("2d")!;
    contexts.set(work, ctx);
  }
  ctx.drawImage(video, 0, 0, work.width, work.height);
  const ml = mlAvailable() ? await detectMl(work, 0.4) : null;
  return ml ? ml.corners : detectCorners(work, 0.15);
}

export type Hint = "searching" | "closer" | "hold" | "ready";

/**
 * Sleduje, jestli se nalezený dokument v záběru nehýbe. Když je po zadanou dobu na místě,
 * hlásí stable=true (automatické snímání). progress 0–1 je pro kroužek kolem spouště.
 */
export class StabilityTracker {
  private last: Corners | null = null;
  private stableSince: number | null = null;
  private stableSamples = 0;

  private smooth: Corners | null = null;

  constructor(
    private holdMs = 600,
    private tolerance = 0.02, // podíl šířky videa (~25 px z 1280); ML detektor má šum ~1 px na 224 px vstupu
  ) {}

  reset() {
    this.last = null;
    this.smooth = null;
    this.stableSince = null;
    this.stableSamples = 0;
  }

  update(raw: Corners | null, videoWidth: number, videoHeight: number, now = performance.now()): { hint: Hint; stable: boolean; progress: number } {
    if (!raw) {
      this.reset();
      return { hint: "searching", stable: false, progress: 0 };
    }
    // exponenciální vyhlazení – šum detektoru mezi snímky nemá rušit „klid“
    const keys: (keyof Corners)[] = ["topLeftCorner", "topRightCorner", "bottomLeftCorner", "bottomRightCorner"];
    const corners: Corners = this.smooth
      ? (Object.fromEntries(keys.map((k) => [k, { x: this.smooth![k].x * 0.5 + raw[k].x * 0.5, y: this.smooth![k].y * 0.5 + raw[k].y * 0.5 }])) as unknown as Corners)
      : raw;
    this.smooth = corners;
    const area =
      Math.abs((corners.topRightCorner.x - corners.topLeftCorner.x) * (corners.bottomLeftCorner.y - corners.topLeftCorner.y)) /
      (videoWidth * videoHeight);
    // i menší dokument (dál) se snímá – kamera má 4K; jen drobný (pod 8 % záběru) chceme blíž
    if (area < 0.08) {
      this.reset();
      return { hint: "closer", stable: false, progress: 0 };
    }
    if (this.last) {
      const moved = Math.max(...keys.map((k) => Math.hypot(corners[k].x - this.last![k].x, corners[k].y - this.last![k].y)));
      if (moved < this.tolerance * videoWidth) {
        this.stableSince ??= now;
        this.stableSamples++;
      } else {
        this.stableSince = null;
        this.stableSamples = 0;
      }
    }
    this.last = corners;
    const elapsed = this.stableSince === null ? 0 : now - this.stableSince;
    const progress = Math.min(1, elapsed / this.holdMs);
    // čas i počet snímků: aspoň holdMs v klidu A aspoň 3 po sobě jdoucí klidné detekce
    const stable = elapsed >= this.holdMs && this.stableSamples >= 3;
    return { hint: stable ? "ready" : "hold", stable, progress };
  }
}
