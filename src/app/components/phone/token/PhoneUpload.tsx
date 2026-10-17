"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { Check, Loader, RotateCw } from "lucide-react";
import { WarningIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { Button } from "@/components/ui/button";
import { createUpload, setUploadLink, type UploadController, type UploadState } from "@/lib/documentUpload";

// Skener sahá na kameru, canvas a workery, na serveru se nevykresluje.
const DocumentScanner = dynamic(() => import("@/app/components/shared/scanner/DocumentScanner").then((m) => m.DocumentScanner), { ssr: false });

// Telefon z QR kódu: vyfotit → nahrát (s odkazem z QR místo přihlášení) → „Hotovo, telefon můžete odložit“.
// Počítač mezitím sám ukáže, že dokument dorazil. Na telefonu se z dokumentace nic nezobrazuje.
export function PhoneUpload({ token, caseId, taskId }: { token: string; caseId: string; taskId: string | null }) {
  const [upload, setUpload] = useState<UploadController | null>(null);

  useEffect(() => {
    setUploadLink(token);
    return () => setUploadLink(null);
  }, [token]);
  useEffect(() => () => upload?.dispose(), [upload]);

  if (!upload) {
    return (
      <DocumentScanner
        title="Vyfotit dokument"
        onDone={(pages) => {
          const next = createUpload(caseId, pages, taskId ? { taskId } : {});
          setUpload(next);
          next.start();
        }}
        renderAction={(done, disabled) => (
          <button
            type="button"
            onClick={done}
            disabled={disabled}
            className="press flex h-14 w-full items-center justify-center rounded-full bg-primary px-6 text-base font-semibold text-primary-foreground outline-none select-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
          >
            Odeslat do počítače
          </button>
        )}
      />
    );
  }
  return <Progress upload={upload} onAnother={() => setUpload(null)} />;
}

const EMPTY: UploadState = { pages: [], finish: "idle" };

function Progress({ upload, onAnother }: { upload: UploadController; onAnother: () => void }) {
  const state = useSyncExternalStore(upload.subscribe, upload.getSnapshot, () => EMPTY);
  // Po nahrání stránek se čtení spouští na pozadí; pro telefon je hotovo, jakmile server stránky přijal.
  const done = state.finish === "done" || state.finish === "empty";
  const failedPage = state.pages.find((page) => page.status === "failed");
  const sent = state.pages.filter((page) => page.status !== "waiting" && page.status !== "uploading").length;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6 text-center pt-safe pb-safe">
      {done ? (
        <>
          <span className="flex size-16 items-center justify-center rounded-full bg-green-700 text-white">
            <Check className="size-8" />
          </span>
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Hotovo</h1>
            <p className="max-w-xs text-base text-muted-foreground">Dokument je na počítači, telefon můžete odložit.</p>
          </div>
          <button type="button" onClick={onAnother} className="text-base underline underline-offset-4 hover:text-muted-foreground">
            Vyfotit další papír
          </button>
        </>
      ) : failedPage || state.finish === "failed" ? (
        <>
          <WarningIcon className="size-10 text-amber-600" />
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Nepodařilo se odeslat</h1>
            <p className="max-w-xs text-base text-muted-foreground">{failedPage?.error ?? state.finishError ?? "Zkuste to prosím znovu."}</p>
          </div>
          <Button
            className="h-12 rounded-full px-6 text-base"
            onClick={() => (failedPage ? upload.retryPage(failedPage.key) : upload.retryFinish())}
          >
            <RotateCw className="size-4" /> Zkusit znovu
          </Button>
        </>
      ) : (
        <>
          <Loader className="size-10 text-muted-foreground motion-safe:animate-spin" />
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Odesílám do počítače…</h1>
            <p className="text-base text-muted-foreground tabular-nums">
              Strana {Math.min(sent + 1, state.pages.length)} z {state.pages.length}
            </p>
          </div>
        </>
      )}
    </main>
  );
}
