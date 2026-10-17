import { RULES } from "@/db/catalog";
import { daysBetween, formatCzechDate } from "@/lib/server/dates";
import { checkValue } from "@/lib/reading/validate";

// Stav hemoglobinu pro frontu a detail. Deterministické pravidlo ze zadání (PBM), žádná AI.
// Stavy odpovídají štítkům ve FE: ok = V pořádku, missing = Doplnit, alert = Pozor, uncertain = Nejisté.

export type HbObservation = {
  informationId: string;
  value: number;
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
  flag: string | null;
  observedDate: string | null;
  isObservedDateEstimated: boolean; // datum odběru ve zprávě není, je to datum zprávy
  status: "ai_extracted" | "verified" | "rejected";
  confidence: number | null;
  documentMatch: "pending" | "match" | "mismatch" | "uncertain" | null; // null = zadal člověk, ne z dokumentu
  documentIssuedDate: string | null;
  createdAt: Date;
};

export type HbStatus = "ok" | "missing" | "alert" | "uncertain";
export type HbReason = "none" | "stale" | "no_date" | "checks" | "identity" | "unit" | "low";

export type HbFinding = {
  status: HbStatus;
  reason: HbReason | null;
  value: number | null;
  observedDate: string | null;
  informationId: string | null;
  verified: boolean; // hodnotu potvrdila AA proti dokumentu; pacientovi „v pořádku“ jen z ověřené
  info: string;
};

// Prahy pravidla jsou v g/l. Hodnota v g/dl se převede, jiná jednotka (mmol/l…) ne.
// Fyziologicky nemožná hodnota v g/l je skoro jistě g/dl bez jednotky, ani ověřená tedy nespustí PBM.
const PLAUSIBLE_GL: [number, number] = [30, 220];

function toGramsPerLitre(value: number, unit: string | null) {
  const normalized = unit?.replace(/\s/g, "").toLowerCase() ?? "";
  const grams = normalized === "" || normalized === "g/l" ? value : normalized === "g/dl" ? Math.round(value * 100) / 10 : null;
  return grams !== null && grams >= PLAUSIBLE_GL[0] && grams <= PLAUSIBLE_GL[1] ? grams : null;
}

const confidenceLabel = (confidence: number | null) => (confidence === null ? "medium" : confidence >= 0.8 ? "high" : confidence >= 0.5 ? "medium" : "low");

// Nejnovější odběr první, hodnoty bez data až na konci.
function newestFirst(a: HbObservation, b: HbObservation) {
  if (a.observedDate !== b.observedDate) {
    if (!a.observedDate) return 1;
    if (!b.observedDate) return -1;
    return b.observedDate.localeCompare(a.observedDate);
  }
  return b.createdAt.getTime() - a.createdAt.getTime();
}

export function evaluateHemoglobin(observations: HbObservation[], today: string): HbFinding {
  const { hbThresholdGl, hbValidForDays } = RULES.pbm;
  // Zamítnuté hodnoty a dokumenty jiného pacienta se nepoužijí vůbec.
  const usable = observations.filter((o) => o.status !== "rejected" && o.documentMatch !== "mismatch").sort(newestFirst);
  const latest = usable[0];
  if (!latest) return { status: "missing", reason: "none", value: null, observedDate: null, informationId: null, verified: false, info: "Hemoglobin chybí. Vyžádat odběr." };

  const grams = toGramsPerLitre(latest.value, latest.unit);
  const verified = latest.status === "verified";
  const found = (status: HbStatus, reason: HbReason | null, info: string): HbFinding => ({
    status,
    reason,
    value: grams ?? latest.value,
    observedDate: latest.observedDate,
    informationId: latest.informationId,
    verified,
    info,
  });

  if (latest.documentMatch === "uncertain" || latest.documentMatch === "pending") {
    return found("uncertain", "identity", "Dokument s hemoglobinem nelze spolehlivě přiřadit pacientovi. Bez ověření žádná akce.");
  }
  if (grams === null) {
    return found("uncertain", "unit", `Hb ${latest.value} ${latest.unit ?? "bez jednotky"} nejde převést na g/l. Zkontrolujte jednotku v dokumentu.`);
  }
  const v = grams;

  // Kontroly čtení (posunutý řádek, jednotka, meze) jen u neověřeného nálezu AI. Ověřenou hodnotu potvrdil člověk.
  if (latest.status === "ai_extracted") {
    const check = checkValue(
      { code: "hb", value: latest.value, unit: latest.unit, ref_low: latest.refLow, ref_high: latest.refHigh, sample_date: latest.observedDate, flag: latest.flag, confidence: confidenceLabel(latest.confidence) },
      { today: new Date(today), documentDate: latest.documentIssuedDate },
    );
    if (check.status === "uncertain") return found("uncertain", "checks", `Hb ${latest.value} neprošel kontrolou (${check.reasons.join(", ")}). Bez ověření žádná akce.`);
  }

  // Jen s datem zprávy nevíme, jak starý odběr je: stejně jako bez data, anémie zůstane upozorněním.
  if (!latest.observedDate || latest.isObservedDateEstimated) {
    const report = latest.observedDate ? ` z ${formatCzechDate(latest.observedDate)}` : "";
    return v < hbThresholdGl
      ? found("alert", "no_date", `Ve zprávě${report} je anémie (Hb ${v} g/l), ale bez data odběru.`)
      : found("uncertain", "no_date", report ? `Hb ${v} g/l ve zprávě${report} je bez data odběru. Vyžádat aktuální odběr.` : "Hemoglobin bez data odběru. Vyžádat aktuální odběr.");
  }

  const sampled = formatCzechDate(latest.observedDate);
  if (v < hbThresholdGl) return found("alert", "low", `Hb ${v} g/l z odběru ${sampled}.`);
  if (daysBetween(latest.observedDate, today) > hbValidForDays) {
    return found("missing", "stale", `Hb ${v} g/l z odběru ${sampled} je neaktuální (platí ${hbValidForDays} dní).`);
  }
  return found("ok", null, `Hb ${v} g/l z odběru ${sampled}.${verified ? "" : " Zatím neověřeno."}`);
}
