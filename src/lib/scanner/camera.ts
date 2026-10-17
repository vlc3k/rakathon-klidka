/** Živá kamera pro hledáček. Vyžaduje HTTPS (nebo localhost). */
export function cameraSupported(): boolean {
  if (typeof window !== "undefined" && window.location.search.includes("fakecam")) return true;
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
}

/**
 * Vývojářská falešná kamera (?fakecam v URL): animovaný obrázek „papíru na stole“ jako MediaStream,
 * aby šel hledáček, detekce i automatické snímání testovat na počítači bez kamery.
 */
function fakeCamera(): MediaStream {
  const c = document.createElement("canvas");
  c.width = 1280;
  c.height = 960;
  const ctx = c.getContext("2d")!;
  const t0 = performance.now();
  const draw = () => {
    const t = (performance.now() - t0) / 1000;
    // první 3 s se papír výrazně hýbe, pak se ustálí (test „držte v klidu“ → auto snímek)
    const wobble = t < 3 ? Math.sin(t * 7) * 70 : 0;
    ctx.fillStyle = "#3b2f2a";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#f1eee6";
    ctx.beginPath();
    ctx.moveTo(330 + wobble, 170);
    ctx.lineTo(980 + wobble, 230);
    ctx.lineTo(910 + wobble, 800);
    ctx.lineTo(250 + wobble, 740);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#222";
    ctx.font = "bold 44px sans-serif";
    ctx.fillText("Hemoglobin 98 g/l", 410 + wobble, 380);
    ctx.fillText("Odběr 13.10.2026", 410 + wobble, 460);
    ctx.fillText("Ferritin 11 ug/l", 410 + wobble, 540);
    requestAnimationFrame(draw);
  };
  draw();
  return c.captureStream(30);
}

export async function openCamera(opts: { maxLongSide?: number } = {}): Promise<MediaStream> {
  if (typeof window !== "undefined" && window.location.search.includes("fakecam")) return fakeCamera();
  // Telefon (dotyk): náhled ve Full HD. Video 12 Mpx telefon nestíhá (naměřeno ~10 snímků/s na Androidu, náhled se seká);
  // fotka v plném rozlišení se bere zvlášť přes takePhoto (grabPhoto). Počítač: co nejvyšší rozlišení.
  // Poměr 4:3 sedí na list papíru; když ho kamera neumí, vezme nejbližší.
  const touch = window.matchMedia("(pointer: coarse)").matches;
  const long = opts.maxLongSide ?? (touch ? 1920 : 4032);
  const short = Math.round((long * 3) / 4);
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: long, max: long }, height: { ideal: short, max: long }, aspectRatio: { ideal: 4 / 3 } },
      audio: false,
    });
  } catch {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  }
  await keepSharp(stream);
  return stream;
}

type FocusCapabilities = MediaTrackCapabilities & { focusMode?: string[]; exposureMode?: string[]; whiteBalanceMode?: string[] };

// Průběžné ostření, expozice a vyvážení bílé, když je prohlížeč dovolí nastavit (Android Chrome).
// Safari na iPhonu je neumí, tam ostří kamera sama; nevadí, když to nejde.
async function keepSharp(stream: MediaStream) {
  const track = stream.getVideoTracks()[0];
  const caps = track?.getCapabilities?.() as FocusCapabilities | undefined;
  if (!track || !caps) return;
  const wanted = (["focusMode", "exposureMode", "whiteBalanceMode"] as const).filter((key) => caps[key]?.includes("continuous"));
  if (!wanted.length) return;
  await track.applyConstraints({ advanced: wanted.map((key) => ({ [key]: "continuous" }) as MediaTrackConstraintSet) }).catch(() => undefined);
}

export function stopCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };

export function supportsTorch(stream: MediaStream): boolean {
  const track = stream.getVideoTracks()[0];
  const caps = track?.getCapabilities?.() as TorchCapabilities | undefined;
  return !!caps?.torch;
}

export async function setTorch(stream: MediaStream, on: boolean) {
  const track = stream.getVideoTracks()[0];
  if (!track) return;
  await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
}

type PhotoCapture = { takePhoto(settings?: { imageWidth?: number; imageHeight?: number }): Promise<Blob>; getPhotoCapabilities(): Promise<{ imageWidth?: { max: number } }> };
declare const ImageCapture: { new (track: MediaStreamTrack): PhotoCapture } | undefined;

/**
 * Fotka v plném rozlišení snímače (Android Chrome, ImageCapture.takePhoto), když je větší než video.
 * Jinak (iPhone, chyba, nic většího) nejostřejší snímek videa. Rohy se ve fotce hledají znovu, takže
 * jiný poměr stran nevadí.
 */
export async function grabPhoto(stream: MediaStream, video: HTMLVideoElement): Promise<HTMLCanvasElement> {
  const track = stream.getVideoTracks()[0];
  if (typeof ImageCapture !== "undefined" && track) {
    try {
      const capture = new ImageCapture(track);
      const caps = await capture.getPhotoCapabilities();
      if ((caps.imageWidth?.max ?? 0) > Math.max(video.videoWidth, video.videoHeight)) {
        const blob = await Promise.race([
          capture.takePhoto(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("takePhoto timeout")), 4000)),
        ]);
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
        bitmap.close();
        return canvas;
      }
    } catch (e) {
      console.debug("[doc-intake] takePhoto nejde, beru snímek videa:", e);
    }
  }
  return grabSharpFrame(video);
}

/** Sejme aktuální snímek videa v plném rozlišení streamu. */
export function grabFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d")!.drawImage(video, 0, 0);
  return canvas;
}

// Ostrost snímku: rozptyl Laplaceova operátoru na zmenšené šedé kopii (čím vyšší, tím ostřejší hrany písma).
function sharpness(video: HTMLVideoElement, probe: HTMLCanvasElement) {
  const width = 320;
  const height = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * width));
  probe.width = width;
  probe.height = height;
  const ctx = probe.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  return n ? sumSq / n - (sum / n) ** 2 : 0;
}

/**
 * Nejostřejší ze tří snímků rychle po sobě (asi 150 ms). Zachytí okamžik, kdy se ruka nehýbe a kamera doostřila.
 * V plném rozlišení se drží jen zatím nejlepší snímek, ať telefon nezahltí paměť.
 */
export async function grabSharpFrame(video: HTMLVideoElement, frames = 3, gapMs = 70): Promise<HTMLCanvasElement> {
  const probe = document.createElement("canvas");
  let best: HTMLCanvasElement | null = null;
  let bestScore = -1;
  for (let i = 0; i < frames; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, gapMs));
    const score = sharpness(video, probe);
    if (score > bestScore) {
      bestScore = score;
      best = grabFrame(video);
    }
  }
  return best ?? grabFrame(video);
}
