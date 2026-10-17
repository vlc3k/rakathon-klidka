"use client";

import { useState, useSyncExternalStore } from "react";
import { DetailSection } from "@/app/components/shared/DetailSection";
import { ListCard } from "@/app/components/shared/ListCard";
import { CaseSwitcher } from "@/app/components/patient/CaseSwitcher";
import { HelpersSection } from "@/app/components/patient/HelpersSection";
import { useSession } from "@/app/components/shared/Session";
import { usePatientCase } from "@/app/components/patient/PatientCase";
import { PatientDashboard } from "@/app/components/patient/PatientDashboard";
import { PortraitUpload } from "@/app/components/patient/PortraitUpload";
import { PrepareList } from "@/app/components/patient/PrepareList";
import { VoiceMessage } from "@/app/components/patient/VoiceMessage";

// Přehled pacienta ve dvou úrovních: jednoduchá (jen zpráva z ambulance) je výchozí, podrobná přidá seznamy.
// Úroveň je v adrese (?zobrazeni=vse), ne v prohlížeči: přežije obnovení stránky a jde poslat rodině.
// Víc zákroků: nahoře přepínač, vybraný drží PatientCaseProvider v layoutu.
export function PatientHome() {
  const { cases, caseId, selectCase } = usePatientCase();
  const { role } = useSession();
  const [detailed, setDetailed] = useLevel();

  return (
    <div className="flex flex-col gap-8 lg:gap-12">
      <CaseSwitcher cases={cases} selectedId={caseId} onSelect={selectCase} />
      <PatientDashboard
        key={caseId}
        detailed={detailed}
        forHelper={role === "helper"}
        levelToggle={
          <button type="button" onClick={() => setDetailed(!detailed)} className="inline-flex min-h-12 w-fit items-center text-lg underline underline-offset-4 hover:text-muted-foreground">
            {detailed ? "Jednodušší zobrazení" : "Zobrazit všechno"}
          </button>
        }
      >
        <PrepareList />
        <DetailSection title="Pro ambulanci" info="Pomůže anesteziologovi připravit se na váš zákrok. Uvidí to jen vaše ambulance.">
          <ListCard outlined>
            <PortraitUpload />
            <VoiceMessage />
          </ListCard>
        </DetailSection>
        {role === "patient" && <HelpersSection />}
      </PatientDashboard>
    </div>
  );
}

const LEVEL_PARAM = "zobrazeni";
const noSubscribe = () => () => {};

// Úroveň zobrazení z adresy. Změna přepíše adresu bez nového záznamu v historii.
function useLevel(): [boolean, (detailed: boolean) => void] {
  const fromUrl = useSyncExternalStore(noSubscribe, () => new URLSearchParams(window.location.search).get(LEVEL_PARAM) === "vse", () => false);
  const [override, setOverride] = useState<boolean | null>(null);
  const set = (detailed: boolean) => {
    const url = new URL(window.location.href);
    if (detailed) url.searchParams.set(LEVEL_PARAM, "vse");
    else url.searchParams.delete(LEVEL_PARAM);
    window.history.replaceState(window.history.state, "", url);
    setOverride(detailed);
  };
  return [override ?? fromUrl, set];
}
