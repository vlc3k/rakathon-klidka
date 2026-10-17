"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { usePatientCase } from "@/app/components/patient/PatientCase";
import { PhoneHandoff } from "@/app/components/patient/upload/PhoneHandoff";
import { UploadProgress } from "@/app/components/patient/upload/UploadProgress";
import { isClientDocumentType } from "@/db/catalog";
import type { Task } from "@/lib/api/types";
import {
  createUpload,
  type FinishStatus,
  type UploadController,
} from "@/lib/documentUpload";
import type { ScannedPage } from "@/lib/scanner/types";

// Skener sahá na kameru, canvas a workery, na serveru se nevykresluje.
const DocumentScanner = dynamic(
  () =>
    import("@/app/components/shared/scanner/DocumentScanner").then(
      (m) => m.DocumentScanner,
    ),
  { ssr: false },
);

// ?task=<id> z karty „Zprávy od lékařů“: nahrání úkol posune na „nahráno“. Jen úkol na lékařskou
// zprávu, který ještě čeká (fotka, podpis a hlasovka mají vlastní obrazovky).
function requestedTask(tasks: Task[], id: string | null) {
  const task = id ? tasks.find((t) => t.id === id) : undefined;
  return task &&
    task.kind === "upload" &&
    !isClientDocumentType(task.documentType) &&
    (task.status === "open" || task.status === "snoozed")
    ? task
    : undefined;
}

// Nahrání lékařské zprávy: skener (vyfotit, oříznout, víc stránek) → průběh nahrání a čtení → hotovo.
// Nahrává do zákroku vybraného v PatientCaseProvider (layout), po dokončení obnoví přehled.
export function DocumentUpload() {
  const router = useRouter();
  const { caseId, tasks, refresh } = usePatientCase();
  const task = requestedTask(tasks, useSearchParams().get("task"));
  // Úkol si zapamatujeme při prvním zobrazení (po nahrání se posune a z requestedTask zmizí).
  // Platí jen pro první odeslaný dokument, další focení už k úkolu nepatří.
  const [taskId, setTaskId] = useState(task?.id);
  const [upload, setUpload] = useState<UploadController | null>(null);
  const [scanned, setScanned] = useState<ScannedPage[]>([]);
  // Počítač bez kamery: vyfotit telefonem přes QR kód.
  const [phone, setPhone] = useState(false);

  // Náhledy stránek patří po skenu nám: uvolní se při dalším dokumentu a při odchodu ze stránky.
  useEffect(
    () => () => scanned.forEach((page) => URL.revokeObjectURL(page.previewUrl)),
    [scanned],
  );
  useEffect(() => () => upload?.dispose(), [upload]);

  // Když nahrávání skončí (i s chybou), přehled se načte znovu: nové dokumenty, úkol posunutý na „nahráno“.
  useEffect(() => {
    if (!upload) return;
    let last: FinishStatus = upload.getSnapshot().finish;
    const unsubscribe = upload.subscribe(() => {
      const { finish } = upload.getSnapshot();
      if (finish !== last && (finish === "done" || finish === "failed"))
        void refresh();
      last = finish;
    });
    return () => {
      unsubscribe();
    };
  }, [upload, refresh]);

  if (!upload) {
    return (
      <>
        <DocumentScanner
          title={task?.title ?? "Vyfotit dokument"}
          onCancel={() => router.push("/patient")}
          onUsePhone={() => setPhone(true)}
          onDone={(pages) => {
            const next = createUpload(caseId, pages, { taskId });
            setTaskId(undefined);
            setScanned(pages);
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
              Odeslat
            </button>
          )}
        />
        {phone && (
          <PhoneHandoff
            caseId={caseId}
            taskId={taskId}
            onClose={() => setPhone(false)}
            onReceived={() => {
              setPhone(false);
              void refresh();
              router.push("/patient");
            }}
          />
        )}
      </>
    );
  }

  return (
    <UploadProgress
      upload={upload}
      onAnother={() => {
        setUpload(null);
        setScanned([]);
      }}
    />
  );
}
