import type { HospitalItem } from "@/lib/fhir/snapshot";
import { formatFullDate } from "@/lib/date";
import { CONSENT_SIGNING } from "@/lib/features";

// Souhrn pro anesteziologa na jedné obrazovce. Osa jako u předoperačního vyšetření (krev, onemocnění, léky,
// alergie, dýchací cesty, souhlas, podklady) a řízení výjimkami: co je v pořádku, je jeden šedý řádek,
// co chce pozornost, svítí. Spojuje dokumenty, nemocniční systém a to, co poslal pacient. Nic nedoporučuje
// a nic nerozhoduje, jen říká, co v podkladech je a co chybí. Řádek se rozbalí na místě a ukáže, z čeho vychází.

export type SummaryTone = "ok" | "attention" | "missing";
export type SummarySource = "dokumenty" | "nemocnice" | "pacient" | "lékař";
/** záložka podkladů pod souhrnem, kde je k řádku víc */
export type SummaryAnchor = "priprava" | "zpravy" | "dokumenty" | "pacient" | "nemocnice";

/** Jedna položka podkladu pod rozbaleným řádkem. Z dokumentu jde ukázat ve zprávě (informationId + documentId). */
export type SummaryItem = {
  text: string;
  source: SummarySource;
  date: string | null;
  informationId?: string;
  documentId?: string | null;
  /** odkaz na stránku originálu (dokumenty v řádku Podklady) */
  href?: string;
  warn?: boolean;
};

export type SummaryRow = {
  key: string;
  label: string;
  tone: SummaryTone;
  text: string;
  /** druhý řádek: z čeho to plyne, co dalšího v podkladech je */
  more: string | null;
  sources: SummarySource[];
  /** údaje z dokumentů, které ještě nikdo nepotvrdil (přečetla je AI) */
  unverified: boolean;
  anchor: SummaryAnchor;
  /** z čeho řádek vychází; prázdné = nic k rozbalení */
  items: SummaryItem[];
};

type DocItem = { id: string; text: string; documentId: string | null };
type Block = { items: DocItem[]; verified: unknown | null };

export type SummaryInput = {
  /** stihne se příprava do termínu (lib/readiness.ts); text a věta z ReadinessCard */
  readiness: { status: "ok" | "tight" | "risk" | "late" | "unknown"; text: string; sentence: string } | null;
  hb: { status: "ok" | "missing" | "alert" | "uncertain"; reason: string | null; value: number | null; observedDate: string | null };
  anamnesis: Block;
  meds: { items: (DocItem & { name: string; dose: string | null })[]; verified: unknown | null };
  /** hodnoty Hb přečtené ze zpráv */
  hbLabs: { id: string; value: string; sampleDate: string | null; documentId: string | null }[];
  allergies: Block;
  allergiesNone: boolean;
  airway: { photos: number; assessment: { mallampati: number | null } | null };
  consentSigned: boolean;
  documents: { total: number; failed: number; unassigned: number; /** pacient poslal k úkolu jiný druh papíru, než ambulance chtěla */ mismatched?: number; list: { id: string; label: string; problem: string | null; href: string }[] };
  /** null = data z nemocnice se ještě nestáhla */
  hospital: HospitalItem[] | null;
};

const SHOWN = 4;
const ROMAN = ["I", "II", "III", "IV"];

// Látky a značky, které ovlivňují srážlivost. Jen upozornění, že je v podkladech má lékař vidět, ne doporučení.
const ANTITHROMBOTIC =
  /warfarin|apixaban|eliquis|rivaroxaban|xarelto|dabigatran|pradaxa|edoxaban|lixiana|clopidogrel|plavix|ticagrelor|brilique|prasugrel|efient|acetylsalicyl|aspirin|anopyrin|godasal|heparin|enoxaparin|clexane|fraxiparin|nadroparin/;
const plain = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
export const isAntithrombotic = (name: string) => ANTITHROMBOTIC.test(plain(name));

function listText(texts: string[]) {
  const head = texts.slice(0, SHOWN).join(", ");
  return texts.length > SHOWN ? `${head} a ${texts.length - SHOWN} další` : head;
}

const sourcesOf = (fromDocs: boolean, fromHospital: boolean): SummarySource[] => [
  ...(fromDocs ? (["dokumenty"] as const) : []),
  ...(fromHospital ? (["nemocnice"] as const) : []),
];

const hospitalGroup = (input: SummaryInput, group: HospitalItem["group"]) => (input.hospital ?? []).filter((i) => i.group === group && i.relevant);

// Položky ze zpráv a z nemocnice pod sebou; stejný text z obou zdrojů jen jednou (zpráva má přednost, jde ukázat).
function mergeItems(fromDocs: SummaryItem[], fromHospital: SummaryItem[]) {
  const seen = new Set<string>();
  return [...fromDocs, ...fromHospital].filter((i) => {
    const k = plain(i.text).trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
const docItem = (i: DocItem, text = i.text): SummaryItem => ({ text, source: "dokumenty", date: null, informationId: i.id, documentId: i.documentId });
const hospitalItem = (i: HospitalItem, text = i.label): SummaryItem => ({ text, source: "nemocnice", date: i.date ? formatFullDate(i.date) : null });

function hemoglobinRow(input: SummaryInput): SummaryRow {
  const { hb } = input;
  const hospitalHb = hospitalGroup(input, "lab")
    .filter((i) => i.key === "hemoglobin")
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const items: SummaryItem[] = [
    ...input.hbLabs.map((l) => ({ text: `Hb ${l.value}`, source: "dokumenty" as const, date: l.sampleDate, informationId: l.id, documentId: l.documentId })),
    ...hospitalHb.map((i) => hospitalItem(i, `Hb ${i.value}`)),
  ];
  const base = { key: "hb", label: "Krev (PBM)", sources: ["dokumenty"] as SummarySource[], unverified: false, anchor: "zpravy" as const, items };
  const when = hb.observedDate ? ` (${formatFullDate(hb.observedDate)})` : "";
  if (hb.status === "ok") return { ...base, tone: "ok", text: `Hb ${hb.value} g/l${when}`, more: null };
  if (hb.status === "alert") return { ...base, tone: "attention", text: `Hb ${hb.value} g/l${when}, pod 120 g/l`, more: "Anémie, posoudit podle PBM" };
  if (hb.status === "uncertain") return { ...base, tone: "attention", text: `Hb ${hb.value ?? "?"} g/l${when} je potřeba ověřit`, more: "Hodnota neprošla kontrolou čtení, porovnejte s originálem" };
  // Chybí platná hodnota z dokumentů. Starší hodnota z nemocnice platnost nenahradí, ale lékař ji má vidět.
  const latest = hospitalHb[0];
  const stale = hb.reason === "stale" && hb.value !== null ? `Poslední ze zpráv ${hb.value} g/l${when}, starší než 14 dní` : null;
  const hospital = latest ? `V nemocnici ${latest.value}${latest.date ? ` (${formatFullDate(latest.date)})` : ""}` : null;
  return {
    ...base,
    tone: "attention",
    text: "Chybí aktuální Hb (do 14 dní)",
    more: [stale, hospital].filter(Boolean).join(" · ") || null,
    sources: sourcesOf(true, !!latest),
  };
}

function conditionsRow(input: SummaryInput): SummaryRow {
  const smoking = hospitalGroup(input, "other").find((i) => i.key === "smoking_status");
  const items = mergeItems(input.anamnesis.items.map((i) => docItem(i)), hospitalGroup(input, "diagnosis").map((i) => hospitalItem(i)));
  const fromDocs = items.some((i) => i.source === "dokumenty");
  const base = { key: "conditions", label: "Onemocnění", anchor: "zpravy" as const, items, sources: sourcesOf(fromDocs, items.some((i) => i.source === "nemocnice")) };
  if (items.length === 0) return { ...base, tone: "missing", text: "V podkladech nic", more: input.hospital ? null : "Data z nemocnice zatím nestažena", unverified: false };
  return { ...base, tone: "ok", text: listText(items.map((i) => i.text)), more: smoking ? `Kouření: ${smoking.value}` : null, unverified: fromDocs && !input.anamnesis.verified };
}

function medsRow(input: SummaryInput): SummaryRow {
  const items = mergeItems(
    input.meds.items.map((m) => docItem(m, [m.name, m.dose].filter(Boolean).join(" "))),
    hospitalGroup(input, "medication").map((i) => hospitalItem(i)),
  ).map((i) => ({ ...i, warn: isAntithrombotic(i.text) }));
  const fromDocs = items.some((i) => i.source === "dokumenty");
  const flagged = items.filter((i) => i.warn).map((i) => i.text);
  const rest = items.filter((i) => !i.warn).map((i) => i.text);
  const base = { key: "meds", label: "Léky", anchor: "zpravy" as const, items, sources: sourcesOf(fromDocs, items.some((i) => i.source === "nemocnice")) };
  const unverified = fromDocs && !input.meds.verified;
  if (items.length === 0) return { ...base, tone: "missing", text: "V podkladech nejsou", more: "Zeptat se pacienta", unverified: false };
  if (flagged.length > 0) return { ...base, tone: "attention", text: `Ovlivňuje srážlivost: ${flagged.join(", ")}`, more: rest.length ? `Dále ${listText(rest)}` : null, unverified };
  return { ...base, tone: "ok", text: listText(rest), more: null, unverified };
}

// „Neguje“, „nemá“, „bez alergií“: zpráva alergii vylučuje, ne uvádí. AI to občas vrátí jako položku.
const DENIES_ALLERGY = /^(neguje|nem[aá]|ž[aá]dn[eéá]|bez alergi|nkda|alergie neguje)/i;

function allergiesRow(input: SummaryInput): SummaryRow {
  const denied = input.allergies.items.filter((i) => DENIES_ALLERGY.test(i.text.trim()));
  const listed = input.allergies.items.filter((i) => !DENIES_ALLERGY.test(i.text.trim()));
  const items = mergeItems(listed.map((i) => docItem(i)), hospitalGroup(input, "allergy").map((i) => hospitalItem(i)));
  const none = input.allergiesNone || denied.length > 0;
  const fromDocs = items.some((i) => i.source === "dokumenty") || none;
  const base = { key: "allergies", label: "Alergie", anchor: "zpravy" as const, items, sources: sourcesOf(fromDocs, items.some((i) => i.source === "nemocnice")) };
  const unverified = fromDocs && !input.allergies.verified;
  if (items.length > 0) return { ...base, tone: "attention", text: listText(items.map((i) => i.text)), more: null, unverified };
  if (none) return { ...base, tone: "ok", text: "Bez alergií podle zprávy", more: null, unverified, items: denied.map((i) => docItem(i)) };
  return { ...base, tone: "missing", text: "Neuvedeno", more: "Zeptat se pacienta", unverified: false };
}

function airwayRow(input: SummaryInput): SummaryRow {
  const { photos, assessment } = input.airway;
  const base = { key: "airway", label: "Dýchací cesty", anchor: "pacient" as const, unverified: false, items: [] };
  if (assessment) {
    const cls = assessment.mallampati;
    if (cls === null) return { ...base, tone: "attention", text: "Z fotek nelze hodnotit", more: "Posoudit při vyšetření", sources: ["lékař"] };
    return { ...base, tone: cls >= 3 ? "attention" : "ok", text: `Mallampati ${ROMAN[cls - 1]}`, more: cls >= 3 ? "Možné obtížné zajištění dýchacích cest" : null, sources: ["lékař"] };
  }
  if (photos > 0) return { ...base, tone: "attention", text: "Fotky čekají na posouzení", more: null, sources: ["pacient"] };
  return { ...base, tone: "missing", text: "Pacient zatím fotky neposlal", more: null, sources: [] };
}

function consentRow(input: SummaryInput): SummaryRow {
  const base = { key: "consent", label: "Souhlas", anchor: "pacient" as const, unverified: false, more: null, items: [] };
  return input.consentSigned
    ? { ...base, tone: "ok", text: "Podepsán", sources: ["pacient"] }
    : { ...base, tone: "missing", text: "Zatím nepodepsán", sources: [] };
}

function documentsRow(input: SummaryInput): SummaryRow {
  const { total, failed, unassigned, mismatched = 0, list } = input.documents;
  const problems = [
    failed > 0 && `${failed} nepřečten${failed === 1 ? "ý" : "é"}`,
    unassigned > 0 && `${unassigned} nelze přiřadit pacientovi`,
    mismatched > 0 && `${mismatched}× jiný papír, než jsme chtěli`,
  ].filter(Boolean);
  const items: SummaryItem[] = list.map((d) => ({ text: d.problem ? `${d.label}: ${d.problem}` : d.label, source: "dokumenty", date: null, href: d.href, warn: !!d.problem }));
  const base = { key: "documents", label: "Podklady", anchor: "dokumenty" as const, unverified: false, sources: [] as SummarySource[], items };
  const count = `${total} ${total === 1 ? "dokument" : total < 5 ? "dokumenty" : "dokumentů"}`;
  const hospital = input.hospital ? "data z nemocnice stažena" : "data z nemocnice nestažena";
  if (total === 0) return { ...base, tone: "missing", text: "Žádné dokumenty", more: hospital };
  if (problems.length > 0)
    return { ...base, tone: "attention", text: `${count}, ${problems.join(", ")}`, more: failed + unassigned > 0 ? "Projít originál, údaje z nich se nepoužily" : "Úkol je splněný jen formálně, papír chybí dál" };
  return { ...base, tone: "ok", text: count, more: hospital };
}

function readinessRow(input: SummaryInput): SummaryRow | null {
  const r = input.readiness;
  if (!r) return null;
  const tone: SummaryTone = r.status === "ok" ? "ok" : r.status === "unknown" ? "missing" : "attention";
  return { key: "readiness", label: "Termín", tone, text: r.text, more: r.sentence, sources: [], unverified: false, anchor: "priprava", items: [] };
}

export function caseSummary(input: SummaryInput): SummaryRow[] {
  return [readinessRow(input), hemoglobinRow(input), conditionsRow(input), medsRow(input), allergiesRow(input), airwayRow(input), CONSENT_SIGNING ? consentRow(input) : null, documentsRow(input)].filter((r): r is SummaryRow => r !== null);
}
