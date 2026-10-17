"use client";

import { useEffect, useRef, useState } from "react";
import { X, Zap, ZapOff } from "lucide-react";
import { ImagesIcon, ReportIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { cameraSupported, grabPhoto, openCamera, setTorch, stopCamera, supportsTorch } from "@/lib/scanner/camera";
import { detectInVideo, StabilityTracker, type Hint } from "@/lib/scanner/detect";
import type { Corners } from "@/lib/scanner/types";
import { cn } from "@/lib/utils";

export interface ViewfinderProps {
  appName: string;
  auto: boolean;
  onToggleAuto: (auto: boolean) => void;
  pageCount: number;
  lastThumbUrl: string | null;
  cvReady: boolean;
  /** null = ML detektor se ještě načítá, false = není k dispozici (jede klasická detekce) */
  mlReady: boolean | null;
  busy: boolean;
  onCapture: (frame: HTMLCanvasElement) => void;
  /** fromCamera: fotka z foťáku telefonu (input capture), ne soubor z galerie / počítače */
  onImport: (files: FileList, fromCamera?: boolean) => void;
  onOpenPreview: () => void;
  onClose?: () => void;
  /** Počítač bez kamery: vyfotit telefonem přes QR kód. */
  onUsePhone?: () => void;
}

const HINTS: Record<Hint, string> = {
  searching: "Namiřte na dokument",
  closer: "Přibližte se k dokumentu",
  hold: "Držte telefon v klidu",
  ready: "Snímám…",
};

// Hledáček: živý náhled kamery, obrys nalezeného dokumentu, samo vyfotí, když se telefon chvíli drží v klidu.
// Ručně, import z galerie a náhled pořízených stránek. Logika z packages/doc-intake, vzhled podle rules/design.md.
export function Viewfinder(props: ViewfinderProps) {
  const { appName, auto, onToggleAuto, pageCount, lastThumbUrl, cvReady, mlReady, busy, onCapture, onImport, onOpenPreview, onClose, onUsePhone } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);
  const trackerRef = useRef(new StabilityTracker());
  const galleryRef = useRef<HTMLInputElement>(null);
  const fallbackRef = useRef<HTMLInputElement>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });
  const [hint, setHint] = useState<Hint>("searching");
  const [progress, setProgress] = useState(0);
  const [torch, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [flash, setFlash] = useState(false);
  const cooldownUntil = useRef(0);

  // --- kamera ---
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraSlow, setCameraSlow] = useState(false);
  const slowDetections = useRef(0);
  const downgraded = useRef(false);

  function startCamera(maxLongSide?: number) {
    setCameraError(null);
    setCameraSlow(false);
    if (!cameraSupported()) {
      setCameraError("Živý náhled vyžaduje zabezpečené připojení (HTTPS). Fotit můžete přes foťák telefonu.");
      return;
    }
    // Když prohlížeč do 5 s neodpoví (žádost o povolení se neukázala, prohlížeč v jiné aplikaci…), nabídneme ruční start.
    const slowTimer = window.setTimeout(() => setCameraSlow(true), 5000);
    openCamera({ maxLongSide })
      .then((st) => {
        window.clearTimeout(slowTimer);
        if (streamRef.current && !maxLongSide) return stopCamera(st); // mezitím už běží jiný stream
        stopCamera(streamRef.current);
        streamRef.current = st;
        trackerRef.current.reset();
        setStream(st);
        setHasTorch(supportsTorch(st));
        setCameraSlow(false);
      })
      .catch((e: unknown) => {
        window.clearTimeout(slowTimer);
        const name = e instanceof DOMException ? e.name : "";
        setDebug(`getUserMedia: ${name || String(e)}`);
        setCameraError(
          name === "NotAllowedError"
            ? "Přístup ke kameře byl zamítnut. Povolte ho v nastavení prohlížeče, nebo foťte přes foťák telefonu."
            : "Kameru se nepodařilo otevřít. Zkuste to znovu, nebo foťte přes foťák telefonu.",
        );
      });
  }

  useEffect(() => {
    // kamera je vnější systém, stav se nastavuje až v jejím callbacku (jen chybová hláška jde hned)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    startCamera();
    return () => {
      stopCamera(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  const [debug, setDebug] = useState("");

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !stream) return;
    // iOS: atribut muted musí být na elementu před play(), React ho někdy nenastaví → autoplay by selhal
    v.muted = true;
    v.defaultMuted = true;
    v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
    v.srcObject = stream;
    const tryPlay = () => v.play().catch((e: unknown) => setDebug(`play: ${e instanceof Error ? e.name : String(e)}`));
    tryPlay();
    const onMeta = () => {
      setVideoSize({ w: v.videoWidth, h: v.videoHeight });
      tryPlay();
    };
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("canplay", tryPlay);
    const t = stream.getVideoTracks()[0];
    const s = t?.getSettings?.();
    setDebug(`track ${t?.readyState ?? "?"} ${s?.width ?? "?"}×${s?.height ?? "?"} ${s?.facingMode ?? ""}`);
    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("canplay", tryPlay);
    };
  }, [stream]);

  // --- plynulost náhledu: když telefon video v plném rozlišení nestíhá (pod 18 snímků/s dvakrát po sobě),
  // přepne kameru na Full HD. Telefony, které ho zvládnou, si plné rozlišení (ostřejší sken) nechají. ---
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !stream || downgraded.current || !("requestVideoFrameCallback" in v)) return;
    let handle = 0;
    let frames = 0;
    let since = 0;
    let slowWindows = 0;
    const onFrame = (now: number) => {
      if (!since) since = now;
      frames++;
      if (now - since >= 2000) {
        const fps = (frames * 1000) / (now - since);
        slowWindows = fps < 18 ? slowWindows + 1 : 0;
        frames = 0;
        since = now;
        if (slowWindows >= 2 && Math.max(v.videoWidth, v.videoHeight) > 2000 && !downgraded.current) {
          downgraded.current = true;
          setDebug(`náhled ${fps.toFixed(0)} fps – přepínám kameru na Full HD`);
          startCamera(1920);
          return;
        }
      }
      handle = v.requestVideoFrameCallback(onFrame);
    };
    handle = v.requestVideoFrameCallback(onFrame);
    return () => v.cancelVideoFrameCallback(handle);
  }, [stream]);

  // --- detekce dokumentu ve workeru (~6× za sekundu), další snímek až po dokončení předchozího ---
  const targetQuad = useRef<Corners | null>(null);
  const ticks = useRef(0);
  useEffect(() => {
    // ML detektor OpenCV nepotřebuje – hledání startuje, jakmile je připravené ML nebo OpenCV
    if (!stream || !(cvReady || mlReady)) return;
    let timer: number;
    let running = true;
    const tick = async () => {
      if (!running) return;
      const v = videoRef.current;
      if (v && v.readyState >= 2 && !busy && Date.now() > cooldownUntil.current) {
        let found: Corners | null = null;
        const tDet = performance.now();
        try {
          found = await detectInVideo(v, (workRef.current ??= document.createElement("canvas")));
          ticks.current++;
          const ms = performance.now() - tDet;
          // diagnostika jen každý 4. snímek – každý setState je re-render celého hledáčku
          if (ticks.current % 4 === 1) {
            setDebug(`det #${ticks.current} ${found ? "rohy ANO" : "rohy ne"} ${ms.toFixed(0)}ms · video ${v.videoWidth}×${v.videoHeight} rs${v.readyState}${v.paused ? " PAUSED" : ""}`);
          }
          // Pojistka: když telefon detekci na vysokém rozlišení nestíhá, přepneme kameru na Full HD.
          slowDetections.current = ms > 400 ? slowDetections.current + 1 : 0;
          if (!downgraded.current && slowDetections.current >= 3 && Math.max(v.videoWidth, v.videoHeight) > 2000) {
            downgraded.current = true;
            setDebug(`detekce ${ms.toFixed(0)} ms – přepínám kameru na Full HD`);
            startCamera(1920);
          }
        } catch (e) {
          found = null;
          setDebug(`detect CHYBA: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (!running) return;
        targetQuad.current = found; // kreslí se plynule v rAF smyčce níže, ne přes React
        const r = trackerRef.current.update(found, v.videoWidth, v.videoHeight);
        setHint((h) => (h === r.hint ? h : r.hint));
        const p = auto ? Math.round(r.progress * 20) / 20 : 0; // po 5 % – méně překreslování
        setProgress((prev) => (prev === p ? prev : p));
        if (auto && r.stable) {
          trackerRef.current.reset();
          cooldownUntil.current = Date.now() + 2000;
          capture();
        }
      }
      timer = window.setTimeout(tick, 100);
    };
    tick();
    return () => {
      running = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, cvReady, mlReady, auto, busy]);

  // --- plynulé kreslení obrysu: canvas přes video, rohy se dohlazují mezi detekcemi (60 fps) ---
  const overlayRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = overlayRef.current;
    const v = videoRef.current;
    if (!canvas || !v || !stream) return;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let shown: Corners | null = null;
    let alpha = 0;
    const KEYS: (keyof Corners)[] = ["topLeftCorner", "topRightCorner", "bottomRightCorner", "bottomLeftCorner"];
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (!cw || !ch || !v.videoWidth) return;
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
      }
      const target = targetQuad.current;
      if (target) {
        if (!shown) shown = { ...target };
        else for (const k of KEYS) shown[k] = { x: lerp(shown[k].x, target[k].x, 0.3), y: lerp(shown[k].y, target[k].y, 0.3) };
        alpha = Math.min(1, alpha + 0.15);
      } else {
        alpha = Math.max(0, alpha - 0.1);
        if (alpha === 0) shown = null;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!shown || alpha === 0) return;
      // stejné mapování jako object-fit: cover
      const scale = Math.max(cw / v.videoWidth, ch / v.videoHeight) * dpr;
      const ox = (canvas.width - v.videoWidth * scale) / 2;
      const oy = (canvas.height - v.videoHeight * scale) / 2;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      KEYS.forEach((k, i) => {
        const x = ox + shown![k].x * scale;
        const y = oy + shown![k].y * scale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      ctx.fill();
      ctx.lineWidth = 2.5 * dpr;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      for (const k of KEYS) {
        ctx.beginPath();
        ctx.arc(ox + shown[k].x * scale, oy + shown[k].y * scale, 5 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [stream]);

  function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !stream) return;
    setFlash(true);
    window.setTimeout(() => setFlash(false), 180);
    // Fotka v plném rozlišení snímače, kde to jde; jinak nejostřejší ze tří snímků videa (rozmazání pohybem ruky).
    void grabPhoto(stream, v).then(onCapture);
  }

  // Foťák bez živé kamery: na telefonu jeho fotoaparát (input capture), na počítači (bez dotyku) QR kód pro telefon,
  // protože input s capture tam jen otevře výběr souboru (na to je tlačítko s galerií).
  function phoneCamera() {
    if (onUsePhone && !window.matchMedia("(pointer: coarse)").matches) onUsePhone();
    else fallbackRef.current?.click();
  }

  function onShutter() {
    if (stream) capture();
    else phoneCamera();
  }

  async function toggleTorch() {
    if (!stream) return;
    try {
      await setTorch(stream, !torch);
      setTorchOn(!torch);
    } catch {
      setHasTorch(false);
    }
  }

  const ring = 2 * Math.PI * 38;
  const showDebug = typeof window !== "undefined" && window.location.search.includes("debug");
  const hintText =
    videoSize.w === 0 ? "Spouštím kameru…" : !(cvReady || mlReady) ? "Připravuji rozpoznávání…" : auto ? HINTS[hint] : "Vyfoťte tlačítkem dole";

  return (
    // Obraz kamery přes celou obrazovku, lišta nahoře a ovládání dole leží poloprůhledně přes něj.
    <div className="relative min-h-0 flex-1 overflow-hidden bg-black text-white">
      <header className="pt-safe absolute inset-x-0 top-0 z-10 bg-black/40">
        <div className="flex h-14 items-center justify-between px-2">
          <button
            type="button"
            onClick={onClose}
            disabled={!onClose}
            aria-label="Zavřít"
            className="flex size-11 items-center justify-center rounded-full outline-none select-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white disabled:invisible"
          >
            <X className="size-5" />
          </button>
          <span className="text-base font-semibold">{appName}</span>
          {hasTorch ? (
            <button
              type="button"
              onClick={toggleTorch}
              aria-label={torch ? "Vypnout světlo" : "Zapnout světlo"}
              aria-pressed={torch}
              className="flex size-11 items-center justify-center rounded-full outline-none select-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white"
            >
              {torch ? <Zap className="size-5" /> : <ZapOff className="size-5" />}
            </button>
          ) : (
            <span className="size-11" />
          )}
        </div>
      </header>

      <div className="absolute inset-0">
        {stream ? (
          <>
            <video ref={videoRef} className="absolute inset-0 size-full bg-black object-cover" playsInline muted autoPlay />
            <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 size-full" aria-hidden="true" />
            <div className={cn("pointer-events-none absolute inset-0 bg-white", flash ? "opacity-80" : "opacity-0 transition-opacity duration-150")} />
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
            <ReportIcon className="size-10 text-white/70" />
            <p className="max-w-xs text-base text-white/80">
              {cameraError ?? (cameraSlow ? "Prohlížeč zatím kameru nepustil. Povolte ji, nebo dokument vyfoťte foťákem telefonu." : "Spouštím kameru…")}
            </p>
            {(cameraError || cameraSlow) && (
              <div className="flex flex-wrap justify-center gap-2">
                {cameraSupported() && (
                  <button type="button" onClick={() => startCamera()} className="h-11 rounded-full bg-white px-5 text-base font-medium text-black select-none">
                    Povolit kameru
                  </button>
                )}
                <button type="button" onClick={phoneCamera} className="h-11 rounded-full bg-white/15 px-5 text-base font-medium select-none">
                  Vyfotit telefonem
                </button>
              </div>
            )}
          </div>
        )}
        {showDebug && (
          <p className="pointer-events-none absolute inset-x-2 top-24 text-center text-xs text-white/70">
            {window.isSecureContext ? "https" : "http"} · cv {cvReady ? "ok" : "…"} · ml {mlReady === null ? "…" : mlReady ? "ok" : "NE"} · {debug}
            {cameraError ? ` · ${cameraError}` : ""}
          </p>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 z-10">
        {stream && (
          <p aria-live="polite" className="mx-auto mb-4 w-fit rounded-full bg-black/60 px-4 py-2 text-base">
            {hintText}
          </p>
        )}
        <div className="pb-safe bg-black/40">
          <div className="flex flex-col items-center gap-5 px-6 pt-5 pb-6">
            <div role="radiogroup" aria-label="Režim snímání" className="flex rounded-full bg-white/15 p-1">
              {[
                { on: true, label: "Samo" },
                { on: false, label: "Ručně" },
              ].map((m) => (
                <button
                  key={m.label}
                  type="button"
                  role="radio"
                  aria-checked={auto === m.on}
                  onClick={() => onToggleAuto(m.on)}
                  className={cn("h-11 rounded-full px-5 text-base font-medium select-none", auto === m.on ? "bg-white text-black" : "text-white")}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="flex w-full items-center justify-between">
              <button
                type="button"
                onClick={() => galleryRef.current?.click()}
                aria-label="Vybrat fotky z galerie"
                className="flex size-12 items-center justify-center rounded-full bg-white/15 outline-none select-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <ImagesIcon className="size-5" />
              </button>

              <button
                type="button"
                onClick={onShutter}
                disabled={busy}
                aria-label="Vyfotit"
                className="press relative flex size-20 items-center justify-center rounded-full outline-none select-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50"
              >
                <svg viewBox="0 0 84 84" className="absolute inset-0 size-full" aria-hidden="true">
                  <circle cx="42" cy="42" r="38" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="3" />
                  <circle
                    cx="42"
                    cy="42"
                    r="38"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="3"
                    strokeDasharray={ring}
                    strokeDashoffset={ring * (1 - progress)}
                    transform="rotate(-90 42 42)"
                  />
                </svg>
                <span className="size-16 rounded-full bg-white" />
              </button>

              {pageCount > 0 ? (
                <button
                  type="button"
                  onClick={onOpenPreview}
                  aria-label={`Zobrazit pořízené stránky (${pageCount})`}
                  className="relative size-12 rounded-xl bg-white/15 outline-none select-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {lastThumbUrl && <img src={lastThumbUrl} alt="" className="size-full rounded-xl object-cover" />}
                  <span className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full bg-white text-xs font-semibold text-black">
                    {pageCount}
                  </span>
                </button>
              ) : (
                <span className="size-12" />
              )}
            </div>
          </div>
        </div>
      </div>

      <input ref={galleryRef} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && onImport(e.target.files)} />
      <input ref={fallbackRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files && onImport(e.target.files, true)} />
    </div>
  );
}
