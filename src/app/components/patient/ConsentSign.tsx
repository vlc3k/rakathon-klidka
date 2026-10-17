"use client";

import { useRef, useState } from "react";
import { DoneIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { Button } from "@/components/ui/button";
import { uploadDocument, usePatientCase } from "@/app/components/patient/PatientCase";
import { BLAMELESS, RadioReply } from "@/app/components/patient/TodayPanel";
import { documentUrl, errorMessage } from "@/lib/api/client";
import { uploadTaskFor } from "@/lib/caseView";
import { formatDateTime } from "@/lib/date";
import { CONSENT_VERSION } from "@/lib/patientInfo";
import { SmoothImage } from "@/app/components/shared/LoadingStates";
import { useSession } from "@/app/components/shared/Session";

// Podpis prstem. V provozu by ho doplnilo ověření identity (Bank iD), v prototypu jen podpis a čas.
// Podpis jde na server jako PNG (consent_signature) s verzí textu souhlasu.
export function ConsentSign() {
  const { caseId, view, tasks, refresh } = usePatientCase();
  const { role } = useSession();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Hned po podpisu odpověď z rádia; při další návštěvě stránky jen podpis.
  const [justSigned, setJustSigned] = useState(false);

  // Souhlas je právní úkon pacienta, pomocník z rodiny ho za něj nepodepíše (server podpis od pomocníka odmítne).
  if (role === "helper" && !view.consent) {
    return <p className="rounded-2xl border-2 border-border px-5 py-4 text-lg">Souhlas s anestezií podepisuje jen pacient sám, ve svém přihlášení. Pomocník ho podepsat nemůže.</p>;
  }
  if (view.consent && justSigned) return <RadioReply />;
  if (view.consent) {
    return (
      <div className="flex flex-col gap-3">
        <p className="flex items-center gap-2 text-base font-medium text-green-700">
          <DoneIcon className="size-5" /> Podepsáno {formatDateTime(view.consent.signedAt)}
        </p>
        <SmoothImage src={documentUrl(caseId, view.consent.documentId)} alt="Váš podpis" className="h-24 w-max rounded-xl bg-background p-2" imgClassName="h-full w-auto" placeholderClassName="w-48" />
      </div>
    );
  }

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * e.currentTarget.width, y: ((e.clientY - r.top) / r.height) * e.currentTarget.height };
  };
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx || busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = point(e);
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d");
    const p = point(e);
    ctx?.lineTo(p.x, p.y);
    ctx?.stroke();
    setHasInk(true);
  };
  const clear = () => {
    const c = canvas.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  };

  const sign = async () => {
    const c = canvas.current;
    if (!c) return;
    setBusy(true);
    setError("");
    try {
      const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Podpis se nepodařilo uložit jako obrázek.");
      await uploadDocument(caseId, blob, "podpis.png", {
        type: "consent_signature",
        meta: { consentVersion: CONSENT_VERSION },
        taskId: uploadTaskFor(tasks, "consent_signature"),
      });
      // Po obnovení přijde view.consent a místo pole se ukáže podpis.
      // Nejdřív příznak, ať se po obnovení neukáže na okamžik jen podpis místo odpovědi.
      setJustSigned(true);
      await refresh();
    } catch (e) {
      console.error("Odeslání podpisu selhalo:", e);
      setError(errorMessage(e, BLAMELESS.send));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <label className="flex min-h-14 cursor-pointer items-center gap-4 rounded-2xl border-2 border-border px-4 py-3 text-lg font-medium">
        <input type="checkbox" className="size-7 shrink-0 accent-foreground" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        Přečetl(a) jsem a souhlasím
      </label>
      <div className="flex flex-col gap-2">
        <span className="text-lg text-muted-foreground">Podepište se prstem do rámečku</span>
        <canvas
          ref={canvas}
          width={800}
          height={260}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={() => (drawing.current = false)}
          className="h-40 w-full touch-none rounded-2xl border-2 border-dashed border-foreground/40 bg-background"
          aria-label="Pole pro podpis"
        />
        {hasInk && !busy && (
          <button type="button" onClick={clear} className="inline-flex min-h-12 w-max items-center text-lg text-muted-foreground underline underline-offset-4">
            Smazat podpis
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <Button className="h-12 rounded-full text-base" disabled={!agreed || !hasInk || busy} onClick={sign}>
        {busy ? "Odesílám…" : "Podepsat"}
      </Button>
    </div>
  );
}
