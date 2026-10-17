"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Square } from "lucide-react";
import { DoneIcon, VoiceIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { uploadDocument, usePatientCase } from "@/app/components/patient/PatientCase";
import { BLAMELESS } from "@/app/components/patient/TodayPanel";
import { errorMessage } from "@/lib/api/client";
import { uploadTaskFor } from "@/lib/caseView";
import { cn } from "@/lib/utils";

// Server přijme do 600 s, nahrávání sami utneme dřív.
const MAX_SECONDS = 120;

type Phase = "idle" | "recording" | "sending" | "sent";

// Hlasová zpráva pro ambulanci: pro ty, kdo nechtějí psát. Ambulance si ji pustí v detailu.
// `row`: řádek seznamu (Pro ambulanci), `button`: samostatné tlačítko (u karty „Kde ho seženu?“).
// Nahrávka jde na server jako WebM nebo MP4 (voice_message) s délkou v sekundách.
export function VoiceMessage({ variant = "row" }: { variant?: "row" | "button" }) {
  const { caseId, view, tasks, refresh } = usePatientCase();
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const unmounted = useRef(false);

  // Odchod ze stránky během nahrávání: vypnout mikrofon a nic neposílat.
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      if (recorder.current?.state === "recording") recorder.current.stop();
    };
  }, []);

  const send = async (blob: Blob, length: number) => {
    if (blob.size === 0) {
      setError(BLAMELESS.empty);
      setPhase("idle");
      return;
    }
    setPhase("sending");
    try {
      const fileName = blob.type.includes("mp4") ? "zprava.mp4" : "zprava.webm";
      await uploadDocument(caseId, blob, fileName, {
        type: "voice_message",
        meta: { seconds: Math.min(600, Math.max(0, Math.round(length))) },
        taskId: uploadTaskFor(tasks, "voice_message"),
      });
      await refresh();
      setPhase("sent");
    } catch (e) {
      console.error("Odeslání hlasové zprávy selhalo:", e);
      setError(errorMessage(e, BLAMELESS.send));
      setPhase("idle");
    }
  };

  const start = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const rec = new MediaRecorder(stream, { mimeType: type });
      const chunks: Blob[] = [];
      const startedAt = Date.now();
      const timer = setInterval(() => {
        const s = Math.round((Date.now() - startedAt) / 1000);
        setSeconds(s);
        if (s >= MAX_SECONDS && rec.state === "recording") rec.stop();
      }, 250);
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        clearInterval(timer);
        stream.getTracks().forEach((t) => t.stop());
        if (!unmounted.current) void send(new Blob(chunks, { type }), (Date.now() - startedAt) / 1000);
      };
      recorder.current = rec;
      rec.start();
      setSeconds(0);
      setPhase("recording");
    } catch (e) {
      console.error("Mikrofon se nespustil:", e);
      setError("Povolte prosím mikrofon v prohlížeči.");
    }
  };

  const count = view.voiceMessages.length;
  const detail =
    error ||
    (phase === "recording"
      ? "Klepnutím odešlete"
      : phase === "sending"
        ? "Chvilku strpení"
        : phase === "sent"
          ? "Odesláno, ambulance si ji poslechne"
          : count
            ? `Odesláno ${count}×`
            : "Dotaz, změna léků, cokoli");

  const toggle = () => (phase === "recording" ? recorder.current?.stop() : start());
  const icon =
    phase === "recording" ? (
      <Square className="size-4 fill-current" />
    ) : phase === "sending" ? (
      <Loader2 className="size-5 animate-spin" />
    ) : phase === "sent" ? (
      <DoneIcon className="size-5 text-status-done-accent [--icon-accent:currentColor]" />
    ) : (
      <VoiceIcon className="size-5" />
    );

  if (variant === "button") {
    return (
      <span className="flex flex-col gap-1">
        <button
          type="button"
          onClick={toggle}
          disabled={phase === "sending"}
          className={cn(
            "press flex h-12 w-fit items-center gap-2 rounded-full px-5 text-base font-semibold outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-70",
            phase === "recording" ? "bg-destructive text-white hover:bg-destructive/90" : "bg-muted hover:bg-muted/70",
          )}
        >
          {icon}
          {phase === "recording" ? `Odeslat · ${seconds} s` : phase === "sending" ? "Odesílám…" : phase === "sent" ? "Odesláno" : "Namluvit zprávu"}
        </button>
        {error && (
          <span role="alert" className="text-base text-destructive">
            {error}
          </span>
        )}
      </span>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={toggle}
        disabled={phase === "sending"}
        className="press flex min-h-16 w-full items-center gap-4 px-4 py-3 text-left outline-none select-none hover:bg-muted/50 focus-visible:bg-muted disabled:opacity-70"
      >
        <VoiceIcon className="size-6 shrink-0 p-0.5 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-base">{phase === "recording" ? `Nahrávám ${seconds} s` : phase === "sending" ? "Odesílám zprávu…" : "Hlasová zpráva"}</span>
          <span className={cn("block text-sm", error ? "text-destructive" : "text-muted-foreground")} role={error ? "alert" : undefined}>
            {detail}
          </span>
        </span>
        <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-full", phase === "recording" ? "bg-destructive text-white" : "bg-muted")}>{icon}</span>
      </button>
    </li>
  );
}
