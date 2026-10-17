"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type {
  FaceLandmarker,
  NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { Button } from "@/components/ui/button";
import {
  uploadDocument,
  usePatientCase,
} from "@/app/components/patient/PatientCase";
import { BLAMELESS, RadioReply } from "@/app/components/patient/TodayPanel";
import { errorMessage } from "@/lib/api/client";
import { uploadTaskFor } from "@/lib/caseView";
import { cn } from "@/lib/utils";
import {
  HINTS,
  HOLD_MS,
  VIEWS,
  evaluateView,
  faceCrop,
  motionBetween,
  toVisible,
  mouthCenter,
  mouthOuterRatio,
  mouthRatio,
  pitchOf,
  type AirwayMetrics,
  type Check,
  type View,
} from "@/lib/airway";

// Verze pevně, stejná jako v package.json. Model i wasm z CDN, ať v repu nejsou binárky.
const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

type Phase = "loading" | "live" | "review" | "sending" | "sent" | "error";
// Jas úst se měří jen u fotky zepředu, u ostatních poloh chybí (null).
type ShotMetrics = { [K in keyof AirwayMetrics]: AirwayMetrics[K] | null };
type Shot = { url: string; blob: Blob; metrics: ShotMetrics };

const noSubscribe = () => () => {};

// Server uloží všechny tři, ale v detailu (pro ambulanci i pacienta) vrací zatím jen poslední fotku úst
// a polohu si neukládá. Proto posíláme ústa zepředu jako poslední, ať anesteziolog vidí právě je.
const UPLOAD_ORDER: View[] = ["profile", "extension", "front"];

// meta podle API: jawOpen a mouthRatio 0–10, luma 0–255, chybějící null, nic jiného.
const clamp = (n: number | null, max: number, digits: number) =>
  n === null || !Number.isFinite(n)
    ? null
    : Number(Math.min(max, Math.max(0, n)).toFixed(digits));
const airwayMeta = (m: ShotMetrics) => ({
  jawOpen: clamp(m.jawOpen, 10, 3),
  mouthRatio: clamp(m.mouthRatio, 10, 3),
  luma: clamp(m.luma, 255, 0),
});

// Povinná je jen fotka úst (z ní anesteziolog určí Mallampatiho třídu). Profil a zakloněnou hlavu
// může pacient přidat z přehledu, nepovinně. Kamera vede pacienta a vyfotí sama, až je poloha
// správná. Nic nehodnotí, posuzuje anesteziolog.
export function AirwayCapture() {
  const { caseId, tasks, refresh } = usePatientCase();
  const videoRef = useRef<HTMLVideoElement>(null);
  const ovalRef = useRef<SVGEllipseElement>(null);
  // ?ladit v adrese ukáže měřené hodnoty, aby šly prahy doladit na skutečném obličeji.
  const debugRef = useRef<HTMLParagraphElement>(null);
  const debug = useSyncExternalStore(noSubscribe, () => new URLSearchParams(window.location.search).has("ladit"), () => false);
  const stepRef = useRef(0);
  const baselineRef = useRef<number | null>(null);
  // Při focení jedné polohy (přefocení nebo doplnění) se po vyfocení vracíme rovnou na přehled.
  const retakeRef = useRef(false);
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [check, setCheck] = useState<Check>("noFace");
  const [shots, setShots] = useState<Partial<Record<View, Shot>>>({});

  const goTo = useCallback((next: number) => {
    stepRef.current = next;
    setStep(next);
    setCheck("noFace");
    if (next >= VIEWS.length) setPhase("review");
  }, []);

  const capture = useCallback(
    (view: View, lm: NormalizedLandmark[], metrics: ShotMetrics) => {
      const video = videoRef.current;
      if (!video) return;
      const { x, y, size } = faceCrop(
        lm,
        video.videoWidth,
        video.videoHeight,
        view,
      );
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = Math.min(1024, Math.round(size));
      canvas
        .getContext("2d")
        ?.drawImage(video, x, y, size, size, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (!blob) return;
          setShots((s) => ({
            ...s,
            [view]: { url: URL.createObjectURL(blob), blob, metrics },
          }));
        },
        "image/jpeg",
        0.9,
      );
      // Po ústech rovnou na přehled, nepovinné polohy si pacient přidá sám.
      if (retakeRef.current || view === "front") {
        retakeRef.current = false;
        goTo(VIEWS.length);
      } else goTo(stepRef.current + 1);
    },
    [goTo],
  );

  const cameraOn = phase === "loading" || phase === "live";

  useEffect(() => {
    if (!cameraOn) return;
    let stopped = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let landmarker: FaceLandmarker | null = null;
    let prev: NormalizedLandmark[] | undefined;
    let motion = 1;
    let holdStart = 0;
    let lastCheck: Check | null = null;
    let lastStep = stepRef.current;
    const probe = document.createElement("canvas");
    probe.width = 160;
    probe.height = 120;
    const probeCtx = probe.getContext("2d", { willReadFrequently: true });

    const sampleLuma = (lm: NormalizedLandmark[]) => {
      const video = videoRef.current;
      if (!video || !probeCtx) return null;
      probeCtx.drawImage(video, 0, 0, probe.width, probe.height);
      const c = mouthCenter(lm);
      const r = Math.max(2, Math.round(c.r * probe.width));
      const px = probeCtx.getImageData(
        Math.round(c.x * probe.width) - r,
        Math.round(c.y * probe.height) - r,
        r * 2,
        r * 2,
      ).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4)
        sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      return sum / (px.length / 4);
    };

    const setProgress = (p: number) => {
      const oval = ovalRef.current;
      if (oval) oval.style.strokeDashoffset = String(1 - p);
    };

    const loop = () => {
      const video = videoRef.current;
      if (stopped || !video || !landmarker) return;
      if (stepRef.current >= VIEWS.length) return;
      if (stepRef.current !== lastStep) {
        lastStep = stepRef.current;
        holdStart = 0;
        lastCheck = null;
        setProgress(0);
      }
      if (video.readyState >= 2) {
        const view = VIEWS[stepRef.current].id;
        const now = performance.now();
        const res = landmarker.detectForVideo(video, now);
        const lm = res.faceLandmarks[0];
        const jawOpen =
          res.faceBlendshapes[0]?.categories.find(
            (c) => c.categoryName === "jawOpen",
          )?.score ?? 0;
        const mouthLuma = lm && view === "front" ? sampleLuma(lm) : null;
        const pitch = lm
          ? pitchOf(lm, video.videoWidth, video.videoHeight)
          : null;
        // Vyhlazený pohyb: jeden roztřesený snímek detektoru nesmí shodit držení polohy.
        const rawMotion = motionBetween(prev, lm);
        motion = lm && prev ? motion * 0.6 + rawMotion * 0.4 : rawMotion;
        const next = evaluateView(
          view,
          {
            landmarks: lm && toVisible(lm, video.videoWidth, video.videoHeight),
            jawOpen,
            mouthLuma,
            motion,
          },
          pitch,
          baselineRef.current,
        );
        prev = lm;
        if (debugRef.current && lm) {
          const vis = toVisible(lm, video.videoWidth, video.videoHeight);
          debugRef.current.textContent =
            `${next} · jawOpen ${jawOpen.toFixed(2)} · rty ${mouthOuterRatio(vis).toFixed(2)} · ` +
            `uvnitř ${mouthRatio(vis).toFixed(2)} · jas ${mouthLuma?.toFixed(0) ?? "–"} · pohyb ${motion.toFixed(3)} · ` +
            `video ${video.videoWidth}×${video.videoHeight}`;
        }
        if (next !== lastCheck) {
          lastCheck = next;
          setCheck(next);
        }
        if (next === "ok" && lm) {
          holdStart ||= now;
          const p = Math.min(1, (now - holdStart) / HOLD_MS);
          setProgress(p);
          if (p >= 1) {
            // Sklon u první fotky je výchozí bod pro „hlavu zakloňte“.
            if (view === "front") baselineRef.current = pitch;
            holdStart = 0;
            setProgress(0);
            capture(view, lm, {
              jawOpen,
              mouthRatio: mouthRatio(lm),
              luma: mouthLuma,
            });
          }
        } else {
          holdStart = 0;
          setProgress(0);
        }
      }
      raf = requestAnimationFrame(loop);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
          audio: false,
        });
        const video = videoRef.current;
        if (!video || stopped) return;
        video.srcObject = stream;
        await video.play();
        const { FaceLandmarker, FilesetResolver } =
          await import("@mediapipe/tasks-vision");
        const fileset = await FilesetResolver.forVisionTasks(WASM);
        landmarker = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
        });
        if (stopped) return;
        setPhase("live");
        loop();
      } catch (e) {
        console.error("Kamera nebo model se nespustily:", e);
        const denied =
          e instanceof DOMException && e.name === "NotAllowedError";
        setError(
          denied
            ? "Povolte prosím kameru v prohlížeči."
            : "Kamera se nespustila, to se stává. Zkuste jiný prohlížeč, nebo to přeskočte, pusu vám anesteziolog prohlédne při návštěvě.",
        );
        setPhase("error");
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      landmarker?.close();
    };
  }, [cameraOn, capture]);

  // single: vyfotit jen tuhle polohu a vrátit se na přehled; jinak pokračovat dalšími polohami.
  const shoot = (index: number, single: boolean) => {
    const view = VIEWS[index].id;
    const old = shots[view];
    if (old) URL.revokeObjectURL(old.url);
    setShots((s) => {
      const next = { ...s };
      delete next[view];
      return next;
    });
    retakeRef.current = single;
    stepRef.current = index;
    setStep(index);
    setCheck("noFace");
    setPhase("loading");
  };

  const send = async () => {
    setPhase("sending");
    setError("");
    try {
      // Úkol „fotka úst“ splní až fotka zepředu, ať je k úkolu připojená ta, kterou anesteziolog posuzuje.
      // Při opakování po chybě server už nahrané fotky pozná (stejný soubor) a nové nezaloží.
      for (const view of UPLOAD_ORDER) {
        const shot = shots[view];
        if (!shot) continue;
        await uploadDocument(caseId, shot.blob, `usta-${view}.jpg`, {
          type: "airway_photo",
          meta: { ...airwayMeta(shot.metrics), view },
          taskId:
            view === "front" ? uploadTaskFor(tasks, "airway_photo") : undefined,
        });
      }
      await refresh();
      setPhase("sent");
    } catch (e) {
      console.error("Odeslání fotek selhalo:", e);
      setError(
        errorMessage(e, BLAMELESS.send),
      );
      setPhase("review");
    }
  };

  if (phase === "sent") return <RadioReply />;

  if (phase === "review" || phase === "sending") {
    const missingOptional = VIEWS.filter(
      (v) => v.id !== "front" && !shots[v.id],
    );
    return (
      <div className="flex flex-col gap-6">
        <ul className="grid grid-cols-3 gap-2">
          {VIEWS.map((v, i) => {
            const shot = shots[v.id];
            return (
              <li key={v.id} className="flex flex-col gap-1">
                {shot ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={shot.url}
                    alt={v.title}
                    className="aspect-square w-full -scale-x-100 rounded-xl object-cover"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => shoot(i, true)}
                    disabled={phase === "sending"}
                    className="press flex aspect-square w-full items-center justify-center rounded-xl border border-dashed border-muted-foreground/40 bg-background text-center text-xs text-muted-foreground"
                  >
                    Přidat
                  </button>
                )}
                <span className="text-xs">
                  {v.title}
                  {v.id !== "front" && (
                    <span className="text-muted-foreground"> (nepovinné)</span>
                  )}
                </span>
                {shot && (
                  <button
                    type="button"
                    onClick={() => shoot(i, true)}
                    disabled={phase === "sending"}
                    className="w-max text-xs text-muted-foreground underline-offset-4 hover:underline"
                  >
                    Vyfotit znovu
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {missingOptional.length === 2 && (
          <p className="text-sm text-muted-foreground">
            Stačí fotka úst. Fotku z boku a se zakloněnou hlavou můžete přidat,
            pokud chcete, nebo až si o ně anesteziolog řekne.{" "}
            <button
              type="button"
              onClick={() => shoot(1, false)}
              disabled={phase === "sending"}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Přidat obě
            </button>
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button
          className="h-12 rounded-full text-base"
          onClick={send}
          disabled={phase === "sending" || !shots.front}
        >
          {phase === "sending" ? "Odesílám…" : "Poslat anesteziologovi"}
        </Button>
      </div>
    );
  }

  const current = VIEWS[Math.min(step, VIEWS.length - 1)];
  // Ukazatel kroků jen u nepovinných poloh, ústa jsou jediná fotka.
  const optionalSteps = VIEWS.map((v, i) => ({ v, i })).filter(
    ({ v }) => v.id !== "front",
  );
  return (
    <div className="flex flex-col gap-4">
      {current.id !== "front" && (
        <ol className="flex gap-2 text-sm" aria-label="Postup focení">
          {optionalSteps.map(({ v, i }) => (
            <li
              key={v.id}
              aria-current={i === step ? "step" : undefined}
              className={cn(
                "flex-1 rounded-full px-3 py-1.5 text-center",
                i === step
                  ? "bg-primary text-primary-foreground"
                  : i < step
                    ? "bg-green-100 text-green-800"
                    : "bg-background text-muted-foreground",
              )}
            >
              {v.title}
            </li>
          ))}
        </ol>
      )}
      <div className="relative aspect-3/4 w-full overflow-hidden rounded-2xl bg-foreground">
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 size-full -scale-x-100 object-cover"
        />
        <svg
          viewBox="0 0 100 133"
          className="absolute inset-0 size-full"
          aria-hidden
        >
          <ellipse
            cx="50"
            cy="64"
            rx="31"
            ry="42"
            fill="none"
            stroke="white"
            strokeOpacity={0.5}
            strokeWidth="0.8"
          />
          <ellipse
            ref={ovalRef}
            cx="50"
            cy="64"
            rx="31"
            ry="42"
            fill="none"
            stroke="rgb(22 163 74)"
            strokeWidth="1.6"
            pathLength={1}
            strokeDasharray="1"
            strokeDashoffset="1"
            transform="rotate(-90 50 64)"
          />
        </svg>
        {debug && (
          <p ref={debugRef} className="absolute inset-x-0 top-0 bg-black/60 p-2 font-mono text-xs text-white" />
        )}
        {phase === "loading" && (
          <p className="absolute inset-x-0 bottom-6 text-center text-sm text-white/80">
            Zapínám kameru…
          </p>
        )}
      </div>
      {phase === "error" ? (
        <p className="text-base text-red-600">{error}</p>
      ) : (
        <p
          aria-live="polite"
          className={cn(
            "min-h-16 text-center text-2xl font-semibold tracking-tight",
            check === "ok" && "text-green-700",
          )}
        >
          {phase === "live" ? HINTS[check] : ""}
        </p>
      )}
      {phase === "live" && current.id !== "front" && (
        <button
          type="button"
          onClick={() => goTo(retakeRef.current ? VIEWS.length : step + 1)}
          className="mx-auto w-max text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Tuhle fotku přeskočit
        </button>
      )}
    </div>
  );
}
