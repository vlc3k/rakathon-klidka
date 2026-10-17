"use client";

import { InfoTip } from "@/app/components/shared/InfoTip";
import { Reveal } from "@/app/components/shared/motion/Reveal";
import { Stagger, StaggerItem } from "@/app/components/shared/motion/Stagger";
import { LoadError } from "@/app/components/shared/PatientStore";
import { TemplateListSkeleton } from "@/app/components/shared/LoadingStates";
import { RULES } from "@/db/catalog";
import type { Template } from "@/lib/api/types";
import { useApi } from "@/lib/api/useApi";

// Prahy PBM jsou v kódu (db/catalog.ts), stejné čte server. Zatím jen ke čtení.
const pbmRules = [
  { label: "Hemoglobin pod", value: `${RULES.pbm.hbThresholdGl} g/l` },
  { label: "Odběr ne starší než", value: `${RULES.pbm.hbValidForDays} dní` },
  { label: "Krevní ztráta nad", value: `${RULES.pbm.bloodLossThresholdMl} ml` },
  { label: "Perorální léčba od", value: `${RULES.pbm.oralWindowWeeks} týdnů` },
];

// 1 úkol, 2 až 4 úkoly, 0 a víc než 4 úkolů.
function taskCount(count: number) {
  if (count === 1) return "1 úkol";
  if (count >= 2 && count <= 4) return `${count} úkoly`;
  return `${count} úkolů`;
}

export function AdminOverview() {
  const { data, error, reload } = useApi<Template[]>("/api/v1/templates");
  const templates = data?.filter((template) => template.isActive);

  return (
    <div className="flex flex-col gap-10">
      <Reveal>
        <h1 className="text-3xl font-semibold tracking-tight lg:text-4xl">Administrace</h1>
      </Reveal>

      <Stagger delay={0.05} className="grid gap-10 xl:grid-cols-2 xl:items-start">
        <StaggerItem as="section" className="flex flex-col gap-3">
          <div className="flex min-h-11 items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">Šablony</h2>
            <InfoTip>Výběrem šablony při založení zákroku se zkopírují její úkoly.</InfoTip>
          </div>
          {!templates ? (
            error ? (
              <div className="rounded-2xl bg-background">
                <LoadError error={error} onRetry={reload} />
              </div>
            ) : (
              <TemplateListSkeleton />
            )
          ) : templates.length === 0 ? (
            <p className="rounded-2xl bg-background px-6 py-12 text-center text-base text-muted-foreground">
              Zatím tu není žádná šablona.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-2xl bg-background">
              {templates.map((template) => (
                <li key={template.id} className="flex min-h-14 flex-col justify-center px-4 py-2">
                  <span className="text-base">{template.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {taskCount(template.taskCount)}
                    {template.bloodLossMl !== null && ` · krevní ztráta ${template.bloodLossMl} ml`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </StaggerItem>

        <StaggerItem as="section" className="flex flex-col gap-3">
          <div className="flex min-h-11 items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">Pravidlo PBM</h2>
            <InfoTip>Prahy, podle kterých se spouští PBM. Zatím jen ke čtení.</InfoTip>
          </div>
          <ul className="divide-y divide-border rounded-2xl bg-background">
            {pbmRules.map((rule) => (
              <li key={rule.label} className="flex min-h-14 items-center justify-between gap-4 px-4">
                <span className="text-base">{rule.label}</span>
                <span className="text-base font-medium">{rule.value}</span>
              </li>
            ))}
          </ul>
        </StaggerItem>
      </Stagger>
    </div>
  );
}
