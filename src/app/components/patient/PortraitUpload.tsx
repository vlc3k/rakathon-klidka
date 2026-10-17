"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { CameraIcon, UserIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { uploadDocument, usePatientCase } from "@/app/components/patient/PatientCase";
import { BLAMELESS } from "@/app/components/patient/TodayPanel";
import { documentUrl, errorMessage } from "@/lib/api/client";
import { uploadTaskFor } from "@/lib/caseView";
import { cn } from "@/lib/utils";
import { SmoothImage } from "@/app/components/shared/LoadingStates";

// Fotka pacienta pro bezpečnou identifikaci při příjmu (ambulance ji vidí u jména). Řádek seznamu.
// Ořízne se na čtverec do 600 px a jde na server jako JPEG (portrait).
export function PortraitUpload() {
  const { caseId, view, tasks, refresh } = usePatientCase();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = ""; // ať jde vybrat znovu stejná fotka
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const bitmap = await createImageBitmap(file);
      const size = Math.min(bitmap.width, bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = Math.min(600, size);
      canvas.getContext("2d")?.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
      if (!blob) throw new Error("Fotku se nepodařilo zpracovat.");
      await uploadDocument(caseId, blob, "fotka.jpg", { type: "portrait", taskId: uploadTaskFor(tasks, "portrait") });
      await refresh();
    } catch (e) {
      console.error("Nahrání fotky selhalo:", e);
      setError(errorMessage(e, BLAMELESS.send));
    } finally {
      setBusy(false);
    }
  };

  const portrait = view.portrait;
  return (
    <li>
      <label className="press flex min-h-16 cursor-pointer items-center gap-4 px-4 py-3 select-none hover:bg-muted/50 has-disabled:cursor-default has-focus-visible:bg-muted">
        <input type="file" accept="image/*" capture="user" className="sr-only" disabled={busy} onChange={(e) => onFile(e.currentTarget)} />
        <UserIcon className="size-6 shrink-0 p-0.5 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-base">{busy ? "Nahrávám fotku…" : "Vaše fotka"}</span>
          <span className={cn("block text-sm", error ? "text-destructive" : "text-muted-foreground")} role={error ? "alert" : undefined}>
            {error || (portrait ? "Klepnutím vyfotíte znovu" : "Abychom vás při příjmu poznali")}
          </span>
        </span>
        {busy ? (
          <span className="flex size-11 shrink-0 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </span>
        ) : portrait ? (
          <SmoothImage src={documentUrl(caseId, portrait.documentId)} alt="Vaše fotka" className="size-11 shrink-0 rounded-full" imgClassName="size-full object-cover" />
        ) : (
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted">
            <CameraIcon className="size-5" />
          </span>
        )}
      </label>
    </li>
  );
}
