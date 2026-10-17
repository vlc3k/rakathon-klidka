"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

// Přehrávač hlasové zprávy jako v chatu (Google Messages, WhatsApp): tlačítko, vlna zvuku a pod ní čas a datum.
// Vlna je spočítaná ze skutečné nahrávky (hlasitost po úsecích), čárek je tolik, kolik se vejde (jedna na 4 px),
// a odehraná část se plynule barví do primary. Kliknutím nebo tažením po vlně se posouvá, šipkami po 5 s.
// Během přehrávání je místo data rychlost 1× / 1,5× / 2×, vlna se tak nikdy nezúží.
// Nahrávka se stáhne jednou: z ní se spočítá vlna a stejný soubor se pak přehrává.
// Hraje vždy jen jedna zpráva, spuštění další tu předchozí zastaví.

const SPEEDS = [1, 1.5, 2];
// Šířka čárky a mezery v px (čárka w-0.5 = 2 px).
const BAR_STEP = 4;

let playing: HTMLAudioElement | null = null;

export function VoicePlayer({ src, seconds, seed, date }: { src: string; seconds: number | null; seed: string; date: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const played = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const [samples, setSamples] = useState<Float32Array | null>(null);
  const [count, setCount] = useState(80);
  const [duration, setDuration] = useState(seconds ?? 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [speed, setSpeed] = useState(1);
  // Pozice pro čtečku (posuvník); obraz se kreslí zvlášť každý snímek.
  const [position, setPosition] = useState(0);

  const peaks = useMemo(() => (samples ? measurePeaks(samples, count) : placeholderPeaks(seed, count)), [samples, seed, count]);

  // Čárek tolik, kolik se vejde do šířky.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setCount(Math.max(24, Math.floor(entry.contentRect.width / BAR_STEP))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Stáhnout nahrávku, spočítat vlnu a přehrávat už z paměti (bez druhého stahování).
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    fetch(src)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(async (buffer) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(new Blob([buffer]));
        const el = audio.current;
        if (el && el.paused && el.currentTime === 0) el.src = objectUrl;
        const context = new AudioContext();
        try {
          const decoded = await context.decodeAudioData(buffer.slice(0));
          if (!alive) return;
          setSamples(decoded.getChannelData(0));
          setDuration(decoded.duration);
        } finally {
          void context.close();
        }
      })
      // Bez vlny se dá pořád přehrát přímo ze serveru, vlna zůstane orientační.
      .catch((e) => console.warn("Vlnu hlasové zprávy se nepodařilo spočítat:", e));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  // Odehraná část vlny a čas, přímo do DOM (60× za sekundu by React zbytečně překresloval celý řádek).
  const paint = (showPosition = true) => {
    const el = audio.current;
    const ratio = el && duration ? Math.min(1, el.currentTime / duration) : 0;
    played.current?.style.setProperty("clip-path", `inset(0 ${100 - ratio * 100}% 0 0)`);
    if (clock.current) clock.current.textContent = formatTime(showPosition ? (el?.currentTime ?? 0) : duration);
  };

  // Během přehrávání se průběh kreslí každý snímek (timeupdate je jen pár za sekundu a cuká).
  useEffect(() => {
    if (!isPlaying) return;
    let frame = 0;
    const tick = () => {
      paint();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  });

  const toggle = async () => {
    const el = audio.current;
    if (!el) return;
    if (!el.paused) return el.pause();
    if (playing && playing !== el) playing.pause();
    playing = el;
    el.playbackRate = speed;
    setStarted(true);
    try {
      await el.play();
    } catch (e) {
      console.error("Hlasovou zprávu se nepodařilo přehrát:", e);
    }
  };

  const seekTo = (ratio: number) => {
    const el = audio.current;
    if (!el || !duration) return;
    el.currentTime = Math.max(0, Math.min(1, ratio)) * duration;
    setPosition(el.currentTime);
    setStarted(true);
    paint();
  };

  const seekFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    seekTo((event.clientX - rect.left) / rect.width);
  };

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audio.current) audio.current.playbackRate = next;
  };

  return (
    <div className="flex flex-col gap-1">
      <audio
        ref={audio}
        src={src}
        preload="none"
        onPlay={() => setIsPlaying(true)}
        onPause={() => {
          setIsPlaying(false);
          paint();
        }}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onEnded={(event) => {
          event.currentTarget.currentTime = 0;
          setPosition(0);
          setStarted(false);
          setIsPlaying(false);
          paint(false);
        }}
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value) && value > 0) setDuration(value);
        }}
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={isPlaying ? "Pozastavit hlasovou zprávu" : "Přehrát hlasovou zprávu"}
          className="press flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground outline-none select-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {isPlaying ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
        </button>

        <div
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label="Posun ve zprávě"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(position)}
          aria-valuetext={`${formatTime(position)} z ${formatTime(duration)}`}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            seekFromPointer(event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) seekFromPointer(event);
          }}
          onKeyDown={(event) => {
            const el = audio.current;
            if (!el || !duration) return;
            if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
              event.preventDefault();
              seekTo((el.currentTime + (event.key === "ArrowRight" ? 5 : -5)) / duration);
            } else if (event.key === " " || event.key === "Enter") {
              event.preventDefault();
              void toggle();
            }
          }}
          className="relative h-9 min-w-0 flex-1 cursor-pointer touch-none rounded-md outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Wave peaks={peaks} className={cn("bg-foreground/15", !samples && "motion-safe:animate-pulse")} />
          <div ref={played} aria-hidden className="absolute inset-0" style={{ clipPath: "inset(0 100% 0 0)" }}>
            <Wave peaks={peaks} className="bg-primary" />
          </div>
        </div>
      </div>

      <div className="flex h-5 items-center justify-between gap-4 pl-14 text-xs text-muted-foreground">
        <span ref={clock} className="tabular-nums">
          {formatTime(started ? position : duration)}
        </span>
        {started ? (
          <button
            type="button"
            onClick={cycleSpeed}
            aria-label={`Rychlost přehrávání ${formatSpeed(speed)}`}
            className="press -my-3 flex h-11 items-center outline-none select-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:animate-in motion-safe:fade-in"
          >
            <span className="flex h-6 min-w-10 items-center justify-center rounded-full bg-muted px-2 font-semibold text-foreground tabular-nums">{formatSpeed(speed)}</span>
          </button>
        ) : (
          <span className="tabular-nums">{date}</span>
        )}
      </div>
    </div>
  );
}

// Čárky vlny. Výška se po spočítání skutečné vlny plynule přelije z orientační.
function Wave({ peaks, className }: { peaks: number[]; className: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-between">
      {peaks.map((peak, i) => (
        <span key={i} className={cn("w-0.5 shrink-0 rounded-full transition-all duration-500 ease-smooth", className)} style={{ height: `${Math.round(peak * 100)}%` }} />
      ))}
    </div>
  );
}

// Hlasitost po úsecích (RMS), lehce vyhlazená se sousedy a srovnaná na nejhlasitější úsek.
// Odmocnina zvedne tiché části, ať je vlna čitelná.
function measurePeaks(data: Float32Array, bars: number) {
  const size = Math.max(1, Math.floor(data.length / bars));
  const levels = Array.from({ length: bars }, (_, bar) => {
    let sum = 0;
    const end = Math.min(data.length, (bar + 1) * size);
    for (let i = bar * size; i < end; i++) sum += data[i] * data[i];
    return Math.sqrt(sum / size);
  });
  const smooth = levels.map((level, i) => (levels[i - 1] ?? level) * 0.25 + level * 0.5 + (levels[i + 1] ?? level) * 0.25);
  const max = Math.max(...smooth) || 1;
  return smooth.map((level) => Math.max(0.1, Math.sqrt(level / max)));
}

// Než se nahrávka spočítá (nebo když to prohlížeč neumí): klidná vlna podle ID, pro každou zprávu jiná.
function placeholderPeaks(seed: string, bars: number) {
  let state = [...seed].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261);
  const random = () => {
    state = (Math.imul(state ^ (state >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return state / 4294967296;
  };
  let previous = 0.4;
  return Array.from({ length: bars }, () => {
    previous = previous * 0.6 + (0.12 + random() * 0.6) * 0.4;
    return previous;
  });
}

const formatTime = (value: number) => {
  const total = Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const formatSpeed = (speed: number) => `${String(speed).replace(".", ",")}×`;
