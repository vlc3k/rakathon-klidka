"use client";

import { Button } from "@/components/ui/button";
import { InfoTip } from "@/app/components/shared/InfoTip";
import { CountUp } from "@/app/components/shared/motion/CountUp";
import { Reveal } from "@/app/components/shared/motion/Reveal";
import { QueueStatsSkeleton, QueueTableSkeleton } from "@/app/components/shared/LoadingStates";
import { PatientQueue } from "@/app/components/staff/PatientQueue";
import { useApi } from "@/lib/api/useApi";
import type { Queue } from "@/lib/api/types";

// Přehled AA: čísla nahoře a fronta z GET /api/v1/queue. Obnovuje se, ať je vidět, co pacient právě poslal.
export function QueueOverview() {
  const { data, error, loading, reload } = useApi<Queue>("/api/v1/queue", { refreshMs: 30_000 });

  const stats = [
    { value: data?.stats.alert ?? 0, label: "Pozor" },
    { value: data?.stats.new ?? 0, label: "Nové" },
    { value: data?.stats.silent ?? 0, label: "Neozvali se", info: "Pacienti, kteří si od založení zákroku ani neotevřeli úkoly. Zavolejte jim, appku část lidí nepoužije." },
    {
      value: data?.stats.daysAhead ?? 0,
      label: "Předem",
      info: "Průměrně tolik dní před zákrokem známe hemoglobin.",
    },
  ];

  return (
    <div className="flex flex-col gap-10">
      <Reveal className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <h1 className="text-3xl font-semibold tracking-tight lg:text-4xl">Přehled</h1>
        {loading && <QueueStatsSkeleton />}
        {data && (
          <dl className="grid grid-cols-3 gap-4 lg:flex lg:gap-12">
            {stats.map((stat) => (
              <div key={stat.label} className="flex flex-col-reverse gap-1">
                <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                  {stat.label}
                  {stat.info && <InfoTip>{stat.info}</InfoTip>}
                </dt>
                <dd className="text-4xl font-semibold tracking-tight">
                  <CountUp value={stat.value} />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Reveal>

      {loading && <QueueTableSkeleton />}
      {error && !data && (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl bg-background p-6">
          <p className="text-base">{error.message}</p>
          <Button variant="secondary" className="h-11 rounded-full px-5" onClick={() => reload()}>
            Zkusit znovu
          </Button>
        </div>
      )}
      {data && <PatientQueue rows={data.rows} />}
    </div>
  );
}
