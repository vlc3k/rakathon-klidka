"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { AlertIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { Preview } from "@/app/components/shared/scanner/Preview";
import { Viewfinder } from "@/app/components/shared/scanner/Viewfinder";
import { initMlDetector } from "@/lib/scanner/mlDetect";
import { loadOpenCV } from "@/lib/scanner/opencv";
import { disposePage, newPage, rerender, type Page } from "@/lib/scanner/pages";
import { prepareCanvas, preparePhoto } from "@/lib/scanner/scan";
import type { ScannedPage } from "@/lib/scanner/types";

export interface DocumentScannerProps {
  /** Hotové stránky (narovnané JPEG). Stránky i jejich previewUrl pak patří volajícímu. */
  onDone: (pages: ScannedPage[]) => void;
  /** Křížek v hledáčku. */
  onCancel?: () => void;
  /** Nadpis v hledáčku. */
  title?: string;
  /** Hlavní akce v náhledu (tlačítko dole). Bez ní obyčejné „Hotovo“. */
  renderAction?: (done: () => void, disabled: boolean) => React.ReactNode;
  maxPages?: number;
  /** Počítač bez kamery: nabídne vyfotit telefonem přes QR kód. */
  onUsePhone?: () => void;
}

type Screen = "camera" | "preview";

// Skener dokumentů přes celou obrazovku: hledáček, který sám vyfotí → náhled (ořez, filtr, vyčištění,
// znovu, smazat, další stránka) → onDone. Vše běží v prohlížeči (OpenCV ve workeru + ML detektor rohů).
export function DocumentScanner({ onDone, onCancel, title = "Vyfotit dokument", renderAction, maxPages = 10, onUsePhone }: DocumentScannerProps) {
  const [screen, setScreen] = useState<Screen>("camera");
  const [pages, setPages] = useState<Page[]>([]);
  const [index, setIndex] = useState(0);
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cvReady, setCvReady] = useState(false);
  const [mlReady, setMlReady] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const retakeIndex = useRef<number | null>(null);
  const pagesRef = useRef(pages);
  // po onDone patří hotové stránky (a jejich previewUrl) volajícímu, ty už neuvolňujeme
  const handedOff = useRef(false);

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  useEffect(() => {
    // OpenCV (narovnání, vylepšení, záložní detekce) a ML detektor rohů se zahřívají souběžně
    initMlDetector().then((ok) => setMlReady(ok));
    loadOpenCV()
      .then(() => setCvReady(true))
      .catch((e) => setError(e instanceof Error ? e.message : "Nepodařilo se načíst rozpoznávání dokumentů."));
  }, []);

  // úklid náhledů při odpojení
  useEffect(
    () => () => {
      for (const p of pagesRef.current) {
        if (handedOff.current) URL.revokeObjectURL(p.prep.previewUrl);
        else disposePage(p);
      }
    },
    [],
  );

  async function addPrepared(prep: Awaited<ReturnType<typeof prepareCanvas>>) {
    const page = await rerender(newPage(prep));
    setPages((ps) => {
      const i = retakeIndex.current;
      if (i !== null && ps[i]) {
        disposePage(ps[i]);
        const next = ps.slice();
        next[i] = page;
        setIndex(i);
        return next;
      }
      setIndex(ps.length);
      return [...ps, page];
    });
    retakeIndex.current = null;
  }

  async function handleCapture(frame: HTMLCanvasElement) {
    if (pages.length >= maxPages && retakeIndex.current === null) return;
    setBusy(true);
    setError(null);
    try {
      await addPrepared(await prepareCanvas(frame));
      setScreen("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Zpracování fotky selhalo.");
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(files: FileList, fromCamera = false) {
    setBusy(true);
    setError(null);
    try {
      const room = retakeIndex.current !== null ? 1 : Math.max(0, maxPages - pages.length);
      for (const file of Array.from(files).slice(0, room)) {
        await addPrepared(await preparePhoto(file, { fitToFrame: !fromCamera }));
      }
      setScreen("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fotky se nepodařilo načíst.");
    } finally {
      setBusy(false);
    }
  }

  // Úpravy stránky nezamykají obrazovku, výsledek se dopočítá na pozadí.
  async function updatePage(i: number, patch: Partial<Pick<Page, "corners" | "rotation" | "filter" | "cleanLayer">>) {
    const current = pages[i];
    if (!current) return;
    try {
      const updated = await rerender({ ...current, ...patch });
      setPages((ps) => ps.map((p) => (p.id === current.id ? updated : p)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Úpravu se nepodařilo použít.");
    }
  }

  function deletePage(i: number) {
    setPages((ps) => {
      disposePage(ps[i]);
      const next = ps.filter((_, idx) => idx !== i);
      if (!next.length) setScreen("camera");
      setIndex(Math.min(i, Math.max(0, next.length - 1)));
      return next;
    });
  }

  function done() {
    const rendered = pages.map((p) => p.rendered).filter((p): p is ScannedPage => !!p);
    if (!rendered.length) return;
    handedOff.current = true;
    onDone(rendered);
  }

  const last = pages[pages.length - 1];
  const notReady = busy || pages.some((p) => !p.rendered);

  return (
    // Telefon: přes celou obrazovku. Desktop: panel na výšku jako list papíru (3:4) uprostřed, ať se obraz
    // z webkamery na široké obrazovce nepřiblíží a neořízne.
    <div className="fixed inset-0 z-50 flex items-center justify-center overscroll-contain bg-black lg:bg-black/80 lg:backdrop-blur-sm">
      <div className="relative flex size-full flex-col overflow-hidden bg-black lg:aspect-3/4 lg:h-5/6 lg:w-auto lg:rounded-3xl lg:shadow-2xl">
        {screen === "camera" ? (
          <Viewfinder
            appName={title}
            auto={auto}
            onToggleAuto={setAuto}
            pageCount={pages.length}
            lastThumbUrl={last?.rendered?.previewUrl ?? null}
            cvReady={cvReady}
            mlReady={mlReady}
            busy={busy}
            onCapture={handleCapture}
            onImport={handleImport}
            onOpenPreview={() => setScreen("preview")}
            onClose={onCancel}
            onUsePhone={onUsePhone}
          />
        ) : (
          <Preview
            pages={pages}
            index={index}
            busy={busy}
            onIndexChange={setIndex}
            onBack={() => setScreen("camera")}
            onAdd={() => {
              retakeIndex.current = null;
              setScreen("camera");
            }}
            onRetake={(i) => {
              retakeIndex.current = i;
              setScreen("camera");
            }}
            onDelete={deletePage}
            onUpdatePage={updatePage}
            action={
              // done se volá až po kliknutí, ref handedOff se při vykreslení nečte
              // eslint-disable-next-line react-hooks/refs
              renderAction?.(done, notReady) ?? (
                <button type="button" onClick={done} disabled={notReady} className="h-12 w-full rounded-full bg-primary px-6 text-base font-semibold text-primary-foreground select-none disabled:opacity-50">
                  Hotovo
                </button>
              )
            }
          />
        )}

        {busy && (
          <div aria-live="polite" className="absolute inset-0 flex items-center justify-center bg-black/30">
            <Loader2 className="size-8 animate-spin text-white" aria-label="Zpracovávám" />
          </div>
        )}
        {error && (
          <button
            type="button"
            role="alert"
            onClick={() => setError(null)}
            className="absolute inset-x-4 bottom-8 flex items-start gap-2 rounded-2xl bg-background p-4 text-left text-base text-destructive"
          >
            <AlertIcon className="mt-0.5 size-5 shrink-0" />
            {error}
          </button>
        )}
      </div>
    </div>
  );
}
