"use client";

import Image from "next/image";
import type { PatientCaseView } from "@/lib/api/types";
import { RelayLine } from "@/app/components/shared/motion/RelayLine";

// Konec štafety (kampaň „Svůj úsek“, docs/brain/10-rozhodnuti.md): když pacient nemá nic dalšího na práci,
// karta s fotkou přetržené pásky a „Kolík teď nese Jana“. Během přípravy se neukazuje nic.

export function RelayTrack({ view, patientRunning, contactName }: { view: PatientCaseView; patientRunning: boolean; contactName: string | null }) {
  if (view.status === "cancelled" || view.status === "closed") return null;
  // Během přípravy nic neukazujeme: pruhy „Vy / Ambulance / Zákrok“ seniorům nic neříkaly a působily jako formulář.
  // Karta se ukáže až ve chvíli, kdy pacient má hotovo.
  if (patientRunning) return null;

  // Úsek uběhnutý: fotka přetržené cílové pásky, aby pacient na první pohled poznal, že teď nic nemusí.
  return (
    <div className="flex flex-col gap-5" role="group" aria-label="Štafeta přípravy">
      <Image
        src="/brand/paska.webp"
        alt=""
        width={1200}
        height={900}
        priority
        sizes="(min-width: 1024px) 28rem, 100vw"
        className="aspect-3/2 w-full max-w-md rounded-2xl object-cover"
      />
      <div className="flex flex-col gap-3">
        <h2 className="text-3xl leading-tight font-semibold tracking-tight">Svůj úsek máte za sebou.</h2>
        <RelayLine className="w-40" delay={0.2} />
        <p className="text-lg">Kolík teď nese {contactName ? `${contactName} z ambulance` : "vaše ambulance"}.</p>
      </div>
    </div>
  );
}

