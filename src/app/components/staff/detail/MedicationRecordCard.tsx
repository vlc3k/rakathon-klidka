"use client";

import { Loader } from "lucide-react";
import { ListCard, ListRow } from "@/app/components/shared/ListCard";
import { AlertIcon, DoneIcon, QuestionIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { useApi } from "@/lib/api/useApi";
import type { CaseDetail } from "@/lib/api/types";
import type { MedicationRecord } from "@/lib/fhir/hospital";
import { sameMedication } from "@/lib/medicationMatch";

// Lékový záznam vedle léků ze zpráv: co si pacient za poslední rok vyzvedl v lékárně (Sdílený lékový záznam,
// eRecept SÚKL; v demu simulace v nemocničním FHIR) a jestli to sedí s tím, co AI přečetla z jeho dokumentů.
// Výjimky svítí: lék z lékárny, který ve zprávách chybí (anesteziolog o něm jinak neví), a lék ze zprávy,
// který si pacient za rok nevyzvedl (možná ho už nebere, nebo je volně prodejný).

const fmtDate = (iso: string) => iso.split("-").reverse().map(Number).join(". ");

export function MedicationRecordCard({ caseId, detail }: { caseId: string; detail: CaseDetail }) {
  const record = useApi<MedicationRecord>(`/api/fhir/${caseId}?view=slz`);
  // Léky ze zpráv: co AI přečetla nebo lékař opravil, bez zamítnutých a bez „nebere žádné“.
  const fromDocuments = detail.information
    .filter((info) => info.type === "medication" && info.status !== "rejected")
    .map((info) => info.value as { name?: string; none?: boolean })
    .filter((value) => !value.none && value.name)
    .map((value) => value.name!);
  const uniqueDocs = fromDocuments.filter((name, i) => fromDocuments.findIndex((other) => sameMedication(other, name)) === i);

  const info = (
    <>
      Léky, které si pacient za poslední rok vyzvedl v lékárně. V provozu ze Sdíleného lékového záznamu (eRecept SÚKL) přes nemocnici,
      v demu simulovaná data.
    </>
  );

  if (record.loading) {
    return (
      <ListCard title="Lékový záznam" info={info}>
        <ListRow icon={<Loader className="size-5 shrink-0 text-muted-foreground motion-safe:animate-spin" />} label="Načítám z lékového záznamu…" />
      </ListCard>
    );
  }
  if (record.error || !record.data) {
    return (
      <ListCard title="Lékový záznam" info={info}>
        <ListRow icon={<AlertIcon className="size-5 shrink-0 text-amber-600" />} label={record.error?.message ?? "Lékový záznam se nepodařilo načíst."} />
      </ListCard>
    );
  }

  const { items, simulated } = record.data;
  const onlyInDocuments = uniqueDocs.filter((name) => !items.some((item) => sameMedication(item.name, name)));
  const missing = items.filter((item) => !fromDocuments.some((name) => sameMedication(item.name, name))).length;

  return (
    <ListCard
      title="Lékový záznam"
      count={items.length || undefined}
      info={info}
      badge={simulated && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">simulace</span>}
      aside={missing > 0 && <span className="text-sm font-medium text-amber-700">{missing === 1 ? "1 lék chybí ve zprávách" : `${missing} léky chybí ve zprávách`}</span>}
    >
      {items.length === 0 && <ListRow icon={<QuestionIcon className="size-5 shrink-0 text-muted-foreground" />} label="Za poslední rok si v lékárně nic nevyzvedl" />}
      {items.map((item) => {
        const inDocuments = fromDocuments.some((name) => sameMedication(item.name, name));
        return (
          <ListRow
            key={item.key}
            icon={inDocuments ? <DoneIcon className="size-5 shrink-0 text-green-700" /> : <AlertIcon className="size-5 shrink-0 text-amber-600" />}
            label={item.name}
            sub={[
              item.dose,
              item.lastDispensed && `naposledy vydáno ${fmtDate(item.lastDispensed)}`,
              item.dispenses > 1 && `${item.dispenses}× za rok`,
              inDocuments ? "i ve zprávách" : "ve zprávách chybí",
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        );
      })}
      {onlyInDocuments.map((name) => (
        <ListRow
          key={`doc-${name}`}
          icon={<QuestionIcon className="size-5 shrink-0 text-muted-foreground" />}
          label={name}
          sub="jen ve zprávách, za rok nevyzvednutý v lékárně (nebere ho už, nebo je volně prodejný?)"
        />
      ))}
    </ListCard>
  );
}
