import type { InformationTypeCode } from "@/db/catalog";
import { boxToQuad, type Quad } from "@/lib/server/transcripts/homography";
import { parseInformationValue } from "@/db/values";
import type { TranscriptPage } from "@/lib/server/transcripts/pipeline";
import type { Extraction } from "@/lib/server/transcripts/schema";

// Výstup AI → řádky tabulky information (stav ai_extracted). Jeden řádek = jedna samostatně ověřitelná věc.
// Typy a tvar hodnot přesně podle db/catalog.ts a db/values.ts; co tvarem neprojde, se vynechá s důvodem.
// Poloha (bbox) a citace (rawText) se dopočítají z řádků přepisu, na které hodnota odkazuje.
// Jistota v databázi je 0–1: nižší z jistoty hodnoty a jistoty přepisu jejích řádků (0–100 / 100).

export type InformationDraft = {
  type: InformationTypeCode;
  value: unknown;
  rawText: string | null;
  observedDate: string | null;
  isObservedDateEstimated: boolean;
  documentId: string;
  bbox: Bbox | null;
  confidence: number;
};

// Kde na fotce (0–1): obdélník kolem, a u narovnané stránky i čtyřúhelník, který kopíruje natočení textu.
export type Bbox = { x: number; y: number; w: number; h: number; quad?: Quad };

export type Skipped = { what: string; reason: string };

// focus: text, který v řádku musí být (výsledek, název léku). Hodnota odkazuje i na řádek s datem odběru
// nebo záhlaví tabulky; poloha a citace se berou jen z řádků s hodnotou, když takové jsou.
type Source = { lines: string[]; confidence: number; focus?: string };

const normalize = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, "").toLowerCase();

// Bez řádků nevíme, odkud údaj je: jistota nanejvýš 50.
const UNSOURCED_MAX_CONFIDENCE = 50;

export function toInformation(extraction: Extraction, pages: TranscriptPage[]): { rows: InformationDraft[]; skipped: Skipped[] } {
  const lineIndex = new Map<string, { page: TranscriptPage; line: TranscriptPage["transcript"]["lines"][number] }>(
    pages.flatMap((page) => page.transcript.lines.map((line) => [`p${page.pageNumber}-${line.id}`, { page, line }] as const)),
  );
  const firstPage = pages[0];
  const issued = extraction.document.issuedDate;
  const rows: InformationDraft[] = [];
  const skipped: Skipped[] = [];

  // Odkud údaj je: stránka podle prvního řádku, obdélník přes jeho řádky na té stránce, citace z textu řádků.
  function origin(source: Source) {
    const refs = source.lines.map((id) => lineIndex.get(id)).filter((ref) => ref !== undefined);
    if (!refs.length) {
      return { documentId: firstPage.documentId, bbox: null, rawText: null, confidence: Math.min(source.confidence, UNSOURCED_MAX_CONFIDENCE) / 100 };
    }
    const focus = source.focus ? normalize(source.focus) : "";
    const focused = focus ? refs.filter((ref) => normalize(ref.line.text).includes(focus)) : [];
    const main = focused.length ? focused : refs;
    const page = main[0].page;
    const onPage = main.filter((ref) => ref.page === page).map((ref) => ref.line);
    const boxes = onPage.map((line) => line.box).filter((box) => box !== null);
    const union: [number, number, number, number] | null = boxes.length
      ? [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))]
      : null;
    const pageQuad = page.transcript.page?.quad;
    const bbox = union ? (pageQuad ? quadBbox(boxToQuad(union, pageQuad)) : toBbox(union)) : null;
    const lineConfidence = Math.min(...refs.map((ref) => ref.line.confidence));
    return {
      documentId: page.documentId,
      bbox,
      rawText: main.map((ref) => ref.line.text).join(" / ").slice(0, 1000),
      confidence: Math.min(source.confidence, lineConfidence) / 100,
    };
  }

  function add(what: string, type: InformationTypeCode, value: unknown, source: Source, observed: { date: string | null; estimated: boolean }) {
    const parsed = parseInformationValue(type, value);
    if (!parsed.success) {
      skipped.push({ what, reason: parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ") });
      return;
    }
    rows.push({ type, value: parsed.value, observedDate: observed.date, isObservedDateEstimated: observed.estimated, ...origin(source) });
  }

  // Bez data odběru se vezme datum dokumentu a označí jako odhad.
  const documentDate = { date: issued, estimated: issued !== null };

  for (const lab of extraction.labs) {
    const observed = lab.dateKind === "collection" && lab.observedDate ? { date: lab.observedDate, estimated: false } : documentDate;
    const limits = { unit: lab.unit, refLow: lab.refLow, refHigh: lab.refHigh, flag: lab.flag };
    // Výsledek, se kterým pracují pravidla, musí být číslo. Jinak (nečíselný výsledek) jde mezi ostatní.
    if (lab.type !== "other" && lab.value !== null) {
      add(lab.name, lab.type, { value: lab.value, ...limits }, { ...lab, focus: lab.valueText }, observed);
    } else {
      add(lab.name, "lab_other", { name: lab.name.slice(0, 200), value: lab.value ?? lab.valueText, ...limits }, { ...lab, focus: lab.valueText }, observed);
    }
  }

  for (const med of extraction.medications) {
    add(med.name, "medication", { name: med.name, ...(med.strength ? { strength: med.strength } : {}), ...(med.dose ? { dose: med.dose } : {}) }, { ...med, focus: med.name }, documentDate);
  }

  // „Bez alergií“ je taky informace ({none: true}), jinak by nešlo poznat „nevíme“ od „nic“.
  if (extraction.allergies.status === "denied") {
    add("bez alergií", "allergy", { none: true }, { lines: extraction.allergies.lines, confidence: 100 }, documentDate);
  }
  if (extraction.allergies.status === "listed") {
    for (const allergy of extraction.allergies.items) {
      add(allergy.substance, "allergy", { substance: allergy.substance, ...(allergy.reaction ? { reaction: allergy.reaction } : {}) }, { ...allergy, focus: allergy.substance }, documentDate);
    }
  }

  for (const condition of extraction.conditions) {
    add(condition.text, "condition", { text: condition.text, ...(condition.icd10 ? { icd10: condition.icd10 } : {}) }, condition, documentDate);
  }

  return { rows, skipped };
}

// Kde na fotce: rohy 0–1000 → {x, y, w, h} v 0–1 (tvar information.bbox).
function toBbox([x0, y0, x1, y1]: [number, number, number, number]) {
  const round = (n: number) => Math.round(n * 10) / 10_000;
  return { x: round(x0), y: round(y0), w: round(x1 - x0), h: round(y1 - y0) };
}

// Čtyřúhelník v původní fotce → obdélník kolem něj + čtyřúhelník (0–1, 4 desetinná místa).
function quadBbox(quad: Quad): Bbox {
  const round = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1e4) / 1e4;
  const q = quad.map(([x, y]) => [round(x), round(y)]) as Quad;
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: round(Math.max(...xs) - x), h: round(Math.max(...ys) - y), quad: q };
}

// Které stránky se nesrovnalost týká (podle řádků); bez řádků všech stránek.
export function issuesByDocument(extraction: Extraction, pages: TranscriptPage[]) {
  const byDocument = new Map(pages.map((page) => [page.documentId, [] as { code: string; detail: string }[]]));
  for (const issue of extraction.issues) {
    const pageNumbers = new Set(issue.lines.map((id) => Number(/^p(\d+)-/.exec(id)?.[1])));
    const targets = pageNumbers.size ? pages.filter((page) => pageNumbers.has(page.pageNumber)) : pages;
    for (const page of targets) byDocument.get(page.documentId)?.push({ code: issue.code, detail: issue.detail });
  }
  return byDocument;
}
