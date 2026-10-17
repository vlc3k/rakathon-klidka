"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu } from "@base-ui/react/menu";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Loader2, MoreHorizontal, RefreshCw } from "lucide-react";
import { DownloadIcon, ReportIcon, ServerIcon, WarningIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/app/components/shared/InfoTip";
import { ListCard, ListRow } from "@/app/components/shared/ListCard";
import { api, errorMessage } from "@/lib/api/client";
import { useHospitalSnapshots } from "@/lib/hospitalStore";
import type { HospitalGroup, HospitalItem, HospitalSnapshot } from "@/lib/fhir/snapshot";
import { cn } from "@/lib/utils";

// Data z nemocničního systému (FHIR). „Aktualizovat“ stáhne novou kopii k této operaci; starší kopie zůstanou
// a jde se k nim vrátit (nabídka „⋯“ v liště synchronizace). Ukládat kopie API zatím neumí (MISSING_ENDPOINTS.md),
// drží je prohlížeč (lib/hospitalStore.ts). Údaje z nemocnice jsou ověřené zdrojem, proto bez „AI“.
// Stejný vzhled jako údaje ze zpráv: nahoře bílá lišta synchronizace (kdy, kdo, co se zapsalo, „⋯“ a „Aktualizovat“),
// pod ní jen vážná upozornění, pak karty Alergie, Diagnózy, Léky, Laboratoř a Vitální funkce ve dvou
// sloupcích. Řádek: název, pod ním datum a štítky „Nové“ / „z ambulance“, vpravo hodnota (mimo normu červeně).
// Než se data poprvé stáhnou, je místo karet prázdný stav s jedním velkým tlačítkem.
export function HospitalPanel({ caseId }: { caseId: string }) {
  const { snapshots, add } = useHospitalSnapshots(caseId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const index = Math.max(0, snapshots.findIndex((s) => s.id === selectedId));
  const current = snapshots[index];
  const previous = snapshots[index + 1];

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const snapshot = await api.post<HospitalSnapshot>(`/api/fhir/${caseId}`);
      add(snapshot);
      setSelectedId(null);
    } catch (e) {
      setError(errorMessage(e, "Stažení se nepovedlo."));
    } finally {
      setLoading(false);
    }
  }

  const items = current ? (showAll ? current.items : relevantOnly(current.items)) : [];
  const prevIds = previous ? new Set(previous.items.map((i) => `${i.id}|${i.value}`)) : null;
  const isNew = (i: HospitalItem) => !!prevIds && !prevIds.has(`${i.id}|${i.value}`);
  const hidden = current ? current.items.length - relevantOnly(current.items).length : 0;
  const group = (g: HospitalGroup) => items.filter((i) => i.group === g);

  return (
    // Bez vlastního nadpisu: „Z nemocnice“ už říká záložka.
    <section aria-label="Data z nemocnice" className="flex flex-col">
      {!current ? (
        <FirstSync loading={loading} error={error} onSync={refresh} />
      ) : (
        <div className="flex flex-col gap-4">
          <SyncBar
            caseId={caseId}
            snapshots={snapshots}
            current={current}
            latest={index === 0}
            onSelect={setSelectedId}
            loading={loading}
            onRefresh={refresh}
          />

          {(error || (current.identity && current.identity.result !== "match") || (current.sent?.failed ?? 0) > 0) && (
            <div className="flex flex-col gap-1.5 text-sm">
              {error && <Note tone="error">{error}</Note>}
              {current.identity && current.identity.result !== "match" && (
                <Note tone="warning">
                  V nemocnici veden jako {current.patient.name}. {current.identity.reason} Ověřte, že jde o stejného člověka.
                </Note>
              )}
              {(current.sent?.failed ?? 0) > 0 && <Note tone="warning">{facts(current.sent!.failed)} se do nemocnice zapsat nepodařilo.</Note>}
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <ItemsCard title="Alergie" items={group("allergy")} isNew={isNew} empty="Nemocnice nemá záznam" allergy />
            <ItemsCard title="Diagnózy" items={group("diagnosis")} isNew={isNew} empty="Žádné aktivní" />
            <ItemsCard title="Léky" items={group("medication")} isNew={isNew} empty="Žádné aktivní" />
            <ItemsCard title="Laboratoř" items={group("lab")} isNew={isNew} empty="Žádné výsledky" values />
            {group("vital").length > 0 && <ItemsCard title="Vitální funkce" items={group("vital")} isNew={isNew} values />}
            {showAll && group("other").length > 0 && <ItemsCard title="Ostatní" items={group("other")} isNew={isNew} values />}
          </div>

          {(hidden > 0 || showAll) && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="press flex h-11 w-fit items-center gap-1.5 self-center rounded-full px-4 text-sm font-medium text-muted-foreground outline-none select-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {showAll ? "Jen údaje k operaci" : `Zobrazit vše · ${hidden} dalších`}
              <ChevronDown className={cn("size-4 transition-transform motion-safe:ease-smooth", showAll && "rotate-180")} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// Lišta synchronizace nahoře (záložka nemá vlastní nadpis): bílý blok jako ostatní karty. Vlevo kdy se stahovalo,
// relativně („dnes v 12:08“), a pod tím šedě kdo, odkud a co se zapsalo do nemocnice; staré stažení oranžově.
// Vpravo jen „⋯“ (co poslala nemocnice, starší kopie) a „Aktualizovat“.
function SyncBar({
  caseId,
  snapshots,
  current,
  latest,
  onSelect,
  loading,
  onRefresh,
}: {
  caseId: string;
  snapshots: HospitalSnapshot[];
  current: HospitalSnapshot;
  latest: boolean;
  onSelect: (id: string) => void;
  loading: boolean;
  onRefresh: () => void;
}) {
  // Čas otevření záložky stačí, „dnes“ a „zastaralé“ se nemusí přepočítávat každou sekundu.
  const [now] = useState(() => Date.now());
  const stale = latest && now - new Date(current.fetchedAt).getTime() > STALE_MS;
  const sent = current.sent;
  const written = sent && sent.created > 0 ? `do nemocnice zapsáno ${facts(sent.created)}` : null;
  const already = sent && (sent.existing > 0 || (sent.known ?? 0) > 0) ? `${facts(sent.existing + (sent.known ?? 0))} už v nemocnici` : null;
  return (
    // Telefon: text přes celou šířku a tlačítka pod ním vpravo. Od sm: všechno v jednom řádku.
    <div className="flex flex-col gap-2 rounded-2xl bg-background py-3 pr-3 pl-5 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ServerIcon className={cn("size-5 shrink-0", latest ? "text-muted-foreground" : "text-amber-600")} />
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-base font-medium">
            {latest ? `Staženo ${relativeTime(current.fetchedAt, now)}` : `Starší kopie z ${relativeTime(current.fetchedAt, now)}`}
            <InfoTip label="Jak synchronizace funguje">
              „Aktualizovat“ nejdřív zapíše do nemocnice údaje z dokumentů, které jste ověřili, pak stáhne aktuální data pacienta jako kopii k tomuto
              zákroku. Starší kopie ani jiné zákroky se nepřepisují.
              {current.source && ` Data poslal ${current.source.software} (FHIR ${current.source.fhirVersion}): ${current.source.resources} záznamů za ${current.source.ms} ms.`}
            </InfoTip>
          </p>
          <p className="text-sm text-muted-foreground">
            {[current.by, current.source?.software].filter(Boolean).join(" · ")}
            {written && <span className="text-green-700"> · {written}</span>}
            {!written && already && ` · ${already}`}
            {stale && <span className="text-amber-700"> · data mohou být zastaralá</span>}
            {!latest && <span className="text-amber-700"> · prohlížíte starší kopii</span>}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1 self-end sm:ml-auto sm:self-auto">
        <MoreMenu caseId={caseId} snapshots={snapshots} current={current} now={now} onSelect={onSelect} />
        <Button className="h-11 rounded-full px-4 text-base" variant={stale || !latest ? "default" : "secondary"} onClick={onRefresh} disabled={loading}>
          <RefreshCw className={cn("size-4", loading && "motion-safe:animate-spin")} />
          {loading ? "Stahuji…" : "Aktualizovat"}
        </Button>
      </div>
    </div>
  );
}

// „⋯“ u lišty: odkaz na to, co nemocnice poslala (přesně, jak to poslala), a výběr kopie dat od nejnovější.
function MoreMenu({
  caseId,
  snapshots,
  current,
  now,
  onSelect,
}: {
  caseId: string;
  snapshots: HospitalSnapshot[];
  current: HospitalSnapshot;
  now: number;
  onSelect: (id: string) => void;
}) {
  const item = "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-1.5 text-base outline-none select-none data-highlighted:bg-muted";
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Další možnosti"
        className="press flex size-11 items-center justify-center rounded-full text-muted-foreground outline-none select-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-muted"
      >
        <MoreHorizontal className="size-5" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-50">
          <Menu.Popup className="flex min-w-72 origin-(--transform-origin) flex-col rounded-2xl bg-popover p-1.5 text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none motion-safe:transition motion-safe:duration-150 motion-safe:ease-smooth data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <Menu.Item render={<Link href={`/staff/${caseId}/fhir`} />} className={item}>
              <ReportIcon className="size-5 shrink-0" />
              <span className="flex-1">Co poslala nemocnice</span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Menu.Item>
            {snapshots.length > 1 && (
              <>
                <Menu.Separator className="mx-1.5 my-1 h-px bg-border" />
                <Menu.Group>
                  <Menu.GroupLabel className="px-3 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">Kopie dat</Menu.GroupLabel>
                  <Menu.RadioGroup value={current.id} onValueChange={(value) => onSelect(value as string)}>
                    {snapshots.map((s, i) => (
                      <Menu.RadioItem key={s.id} value={s.id} className={item}>
                        <span className="flex size-5 shrink-0 items-center justify-center">
                          <Menu.RadioItemIndicator>
                            <Check className="size-4 text-primary" strokeWidth={2.5} />
                          </Menu.RadioItemIndicator>
                        </span>
                        <span className="flex flex-1 flex-col">
                          <span className="tabular-nums">{relativeTime(s.fetchedAt, now)}</span>
                          <span className="text-sm text-muted-foreground">
                            {s.by}
                            {i === 0 && " · nejnovější"}
                          </span>
                        </span>
                      </Menu.RadioItem>
                    ))}
                  </Menu.RadioGroup>
                </Menu.Group>
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

// Krátké upozornění s ikonou pod lištou: chyba červeně, varování oranžově.
function Note({ tone, children }: { tone: "error" | "warning"; children: React.ReactNode }) {
  return (
    <p role={tone === "error" ? "alert" : undefined} className={cn("flex items-start gap-2", tone === "error" ? "text-red-700" : "text-amber-700")}>
      <WarningIcon className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

// Stažení starší než den: data v nemocnici se mezitím mohla změnit, „Aktualizovat“ se zvýrazní.
const STALE_MS = 24 * 60 * 60 * 1000;
const facts = (n: number) => `${n} ${n === 1 ? "ověřený údaj" : n < 5 ? "ověřené údaje" : "ověřených údajů"}`;

// „dnes v 12:08“, „včera v 9:41“, jinak „12. 10. v 14:05“.
function relativeTime(iso: string, now: number) {
  const d = new Date(iso);
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date(now)) - day(d)) / 86_400_000);
  if (diff === 0) return `dnes v ${time}`;
  if (diff === 1) return `včera v ${time}`;
  return `${d.getDate()}. ${d.getMonth() + 1}. v ${time}`;
}

// Karta jednoho druhu údajů jako seznam v Nastavení. `values`: hodnota vpravo (laboratoř, vitální funkce),
// mimo normu červeně se šipkou. `allergy`: alergie červeně s výstrahou, jako v údajích ze zpráv.
function ItemsCard({
  title,
  items,
  isNew,
  empty,
  values = false,
  allergy = false,
}: {
  title: string;
  items: HospitalItem[];
  isNew: (item: HospitalItem) => boolean;
  empty?: string;
  values?: boolean;
  allergy?: boolean;
}) {
  return (
    <ListCard title={title} count={items.length || undefined}>
      {items.length === 0 ? (
        <ListRow label={<span className="text-muted-foreground">{empty}</span>} />
      ) : (
        items.map((item) => {
          const Arrow = item.flag === "L" ? ArrowDown : ArrowUp;
          return (
            <ListRow
              key={item.id}
              icon={allergy ? <WarningIcon className="size-5 shrink-0 text-red-600" /> : undefined}
              label={<span className={cn(allergy && "font-semibold text-red-700")}>{labelOf(item)}</span>}
              sub={
                (item.date || isNew(item) || item.fromApp) && (
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {item.date && <span className="tabular-nums">{fmtDate(item.date)}</span>}
                    {isNew(item) && <span className="rounded-full bg-green-50 px-1.5 text-xs font-medium text-green-700">Nové</span>}
                    {item.fromApp && <span className="rounded-full bg-muted px-1.5 text-xs font-medium">z ambulance</span>}
                  </span>
                )
              }
              trailing={
                values && (
                  // Hodnota nejvýš na půl řádku a smí se zalomit: dlouhý text z nemocnice nesmí stlačit název.
                  <span className={cn("flex max-w-48 items-center justify-end gap-1 text-right text-base font-semibold tabular-nums wrap-anywhere sm:max-w-64", item.flag && "text-red-700")}>
                    {valueOf(item)}
                    {item.flag && (
                      <>
                        <Arrow className="size-4" aria-hidden />
                        <span className="sr-only">{item.flag === "L" ? "pod normou" : "nad normou"}</span>
                      </>
                    )}
                  </span>
                )
              }
            />
          );
        })
      )}
    </ListCard>
  );
}

// Vitální funkce z nemocnice česky (FHIR posílá anglické názvy z LOINC, třeba „Body Height“).
const VITAL_LABELS: Record<string, string> = {
  height: "Výška",
  weight: "Hmotnost",
  bmi: "BMI",
  blood_pressure: "Krevní tlak",
  heart_rate: "Tep",
  spo2: "Saturace kyslíkem",
};
const labelOf = (item: HospitalItem) => (item.group === "vital" && VITAL_LABELS[item.key]) || item.label;

// Hodnota čitelně: tlak jako „120/74 mm Hg“ místo „Diastolic Blood Pressure: 74 mm[Hg]; Systolic…“, jednotky bez
// závorek z UCUM („mm[Hg]“ → „mm Hg“, „kg/m2“ → „kg/m²“).
function valueOf(item: HospitalItem) {
  const systolic = item.value.match(/systolic[^:]*:\s*([\d.,]+)/i)?.[1];
  const diastolic = item.value.match(/diastolic[^:]*:\s*([\d.,]+)/i)?.[1];
  if (systolic && diastolic) return `${systolic}/${diastolic} mm Hg`;
  return item.value.replace(/mm\[Hg\]/g, "mm Hg").replace(/\/m2\b/g, "/m²");
}

// První stažení jako prázdný stav s jednou hlavní akcí (vzor ContentUnavailableView v iOS, empty states v SAP Fiori):
// ikona, jedna věta proč je prázdno, jedna co stažení udělá, a velké tlačítko. Chyba je hned nad ním.
function FirstSync({ loading, error, onSync }: { loading: boolean; error: string | null; onSync: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 rounded-2xl bg-background px-6 py-12 text-center lg:py-16">
      <ServerIcon className="size-10" />
      <div className="flex max-w-md flex-col gap-2">
        <h3 className="text-xl font-semibold tracking-tight">Data z nemocnice ještě nejsou stažená</h3>
        <p className="text-base text-muted-foreground">Stáhneme diagnózy, léky, alergie a výsledky pacienta.</p>
      </div>
      {error && (
        <p role="alert" className="flex items-start gap-2 text-left text-sm text-red-700">
          <WarningIcon className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      )}
      <Button className="h-12 w-full rounded-full px-6 text-base sm:w-auto" onClick={onSync} disabled={loading}>
        {loading ? <Loader2 className="size-5 motion-safe:animate-spin" /> : <DownloadIcon className="size-5" />}
        {loading ? "Stahuji z nemocnice…" : error ? "Zkusit znovu" : "Stáhnout z nemocnice"}
      </Button>
    </div>
  );
}

// K operaci: alergie, aktivní diagnózy a léky, u hodnot jen poslední výsledek každého parametru.
function relevantOnly(items: HospitalItem[]) {
  const seen = new Set<string>();
  return items
    .filter((i) => i.relevant)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .filter((i) => {
      if (i.group !== "lab" && i.group !== "vital") return true;
      if (seen.has(i.key)) return false;
      seen.add(i.key);
      return true;
    });
}

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
};
