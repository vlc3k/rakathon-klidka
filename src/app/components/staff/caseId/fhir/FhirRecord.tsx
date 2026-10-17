/* eslint-disable @typescript-eslint/no-explicit-any -- záznamy z FHIR jsou volné JSON */
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { DownloadIcon, ServerIcon, WarningIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { DetailSection } from "@/app/components/shared/DetailSection";
import { ListCard } from "@/app/components/shared/ListCard";
import type { HospitalRecord } from "@/lib/fhir/hospital";
import { cn } from "@/lib/utils";

type Resource = { resourceType: string; id: string; [key: string]: any };

// Odpověď nemocničního FHIR serveru čitelně: karty podle druhu záznamu, u každého řádku ID v nemocnici
// a po rozkliknutí originál (JSON přesně tak, jak ho server poslal).
export function FhirRecord({ caseId, patientName, result }: { caseId: string; patientName: string; result: HospitalRecord | { error: string } }) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <Link
          href={`/staff/${caseId}`}
          className="press -ml-2 inline-flex h-11 w-fit items-center gap-1 rounded-full pr-3 pl-1 text-base text-muted-foreground outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="size-5" />
          {patientName}
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Data z nemocnice</h1>
      </div>

      {"error" in result ? (
        <p role="alert" className="flex items-start gap-2 rounded-2xl bg-background p-5 text-base text-red-700">
          <WarningIcon className="mt-1 size-4 shrink-0" /> {result.error}
        </p>
      ) : (
        <Record caseId={caseId} record={result} />
      )}
    </div>
  );
}

function Record({ caseId, record }: { caseId: string; record: HospitalRecord }) {
  const resources = record.bundle.entry.map((e) => e.resource as Resource);
  const of = (...types: string[]) => resources.filter((r) => types.includes(r.resourceType));
  const patient = of("Patient")[0];
  const labs = of("Observation").sort((a, b) => String(b.effectiveDateTime ?? "").localeCompare(String(a.effectiveDateTime ?? "")));

  return (
    <>
      <section className="flex flex-col gap-3 rounded-2xl bg-background p-5">
        <p className="flex items-center gap-2 text-base font-semibold">
          <ServerIcon className="size-4" /> {record.software}
        </p>
        <p className="text-sm text-muted-foreground">
          Odpověď serveru {record.server} (FHIR {record.fhirVersion}) z {fmtDateTime(record.fetchedAt)}, {record.bundle.total} záznamů za {record.ms} ms. Načítá se při
          každém otevření stránky, nic se nebere z mezipaměti.
        </p>
        <a
          href={`/api/fhir/${caseId}`}
          download={`${caseId}-fhir.json`}
          className="press inline-flex h-11 w-fit items-center gap-2 rounded-full bg-muted px-4 text-sm font-medium outline-none select-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <DownloadIcon className="size-4" /> Stáhnout JSON
        </a>
      </section>

      <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-8">
          {patient && (
            <DetailSection title="Pacient">
              <ListCard>
                <Row
                  resource={patient}
                  label={name(patient)}
                  // Jen rodné číslo (podle něj se páruje). Ostatní identifikátory jsou v originálu.
                  value={patient.identifier?.map((i: any) => String(i.value ?? "")).find((v: string) => /^\d{6}\/?\d{3,4}$/.test(v))}
                  sub={[patient.birthDate && `narozen ${fmtDate(patient.birthDate)}`, { male: "muž", female: "žena" }[patient.gender as string]].filter(Boolean).join(" · ")}
                />
              </ListCard>
            </DetailSection>
          )}
          <DetailSection title="Laboratoř" aside={labs.length > 0 && `${labs.length} výsledků`}>
            <ListCard>
              {labs.length === 0 ? (
                <Empty />
              ) : (
                labs.map((o) => (
                  <Row
                    key={o.id}
                    resource={o}
                    label={concept(o.code)}
                    value={quantity(o.valueQuantity)}
                    flag={o.interpretation?.[0]?.coding?.[0]?.code}
                    sub={o.effectiveDateTime ? `odběr ${fmtDate(o.effectiveDateTime)}` : "bez data odběru"}
                  />
                ))
              )}
            </ListCard>
          </DetailSection>
        </div>

        <div className="flex flex-col gap-8">
          <DetailSection title="Diagnózy">
            <ListCard>
              {of("Condition").length === 0 ? (
                <Empty />
              ) : (
                of("Condition").map((c) => (
                  <Row key={c.id} resource={c} label={concept(c.code)} sub={[status(c.clinicalStatus), c.recordedDate && `zapsáno ${fmtDate(c.recordedDate)}`].filter(Boolean).join(" · ")} />
                ))
              )}
            </ListCard>
          </DetailSection>
          <DetailSection title="Léky">
            <ListCard>
              {of("MedicationStatement", "MedicationRequest").length === 0 ? (
                <Empty />
              ) : (
                of("MedicationStatement", "MedicationRequest").map((m) => (
                  <Row
                    key={m.id}
                    resource={m}
                    label={concept(m.medicationCodeableConcept) || m.medicationReference?.display || "Lék"}
                    sub={[m.status === "active" ? "užívá" : m.status, (m.dateAsserted || m.authoredOn) && `zapsáno ${fmtDate(m.dateAsserted || m.authoredOn)}`].filter(Boolean).join(" · ")}
                  />
                ))
              )}
            </ListCard>
          </DetailSection>
          <DetailSection title="Alergie">
            <ListCard>
              {of("AllergyIntolerance").length === 0 ? (
                <Empty text="Nemocnice nemá záznam." />
              ) : (
                of("AllergyIntolerance").map((a) => <Row key={a.id} resource={a} label={concept(a.code)} sub={a.recordedDate && `zapsáno ${fmtDate(a.recordedDate)}`} />)
              )}
            </ListCard>
          </DetailSection>
        </div>
      </div>
    </>
  );
}

// Řádek: vlevo co to je a pod tím datum a ID záznamu v nemocnici, vpravo hodnota. Pod ním originál k rozkliknutí.
function Row({ resource, label, value, sub, flag }: { resource: Resource; label: string; value?: string; sub?: string; flag?: string }) {
  return (
    <li className="flex flex-col py-2.5 pr-3 pl-5">
      <div className="flex min-h-8 items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-base wrap-anywhere">{label}</div>
          <div className="text-sm text-muted-foreground">
            {sub && <span>{sub} · </span>}
            <span className="tabular-nums">
              {resource.resourceType}/{resource.id}
            </span>
          </div>
        </div>
        {value && (
          <span className={cn("shrink-0 pr-2 text-base font-semibold tabular-nums", (flag === "L" || flag === "H") && "text-red-700")}>
            {value}
            {flag === "L" ? " ↓" : flag === "H" ? " ↑" : ""}
          </span>
        )}
      </div>
      <details className="group">
        <summary className="-ml-2 flex h-11 w-fit cursor-pointer list-none items-center rounded-full px-2 text-sm font-medium text-muted-foreground select-none hover:text-foreground">
          <span className="group-open:hidden">Zobrazit originál</span>
          <span className="hidden group-open:inline">Skrýt originál</span>
        </summary>
        <pre className="mt-1 mb-2 max-h-80 overflow-auto rounded-xl bg-muted p-3 text-xs leading-relaxed">{JSON.stringify(resource, null, 2)}</pre>
      </details>
    </li>
  );
}

function Empty({ text = "Žádné záznamy." }: { text?: string }) {
  return <li className="px-5 py-3 text-base text-muted-foreground">{text}</li>;
}

const name = (p: Resource) => {
  const n = p.name?.find((x: any) => x.use === "official") ?? p.name?.[0];
  return [n?.given?.join(" "), n?.family].filter(Boolean).join(" ") || "Bez jména";
};
const concept = (c: any): string => c?.text ?? c?.coding?.find((x: any) => x.display)?.display ?? c?.coding?.[0]?.code ?? "";
const status = (c: any) => ({ active: "aktivní", resolved: "vyřešeno", inactive: "neaktivní" } as Record<string, string>)[c?.coding?.[0]?.code] ?? c?.coding?.[0]?.code;
// UCUM pro lidi: 10*9/L → 10⁹/L
const quantity = (q: any) =>
  q?.value == null ? undefined : `${String(q.value).replace(".", ",")} ${String(q.unit ?? q.code ?? "").replace("10*9", "10⁹").replace("10*3", "10³").replace("ug/L", "µg/L")}`.trim();
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${+d}. ${+m}. ${y}`;
};
const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
};
