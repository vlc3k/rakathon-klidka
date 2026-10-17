// Kontroly přečtených hodnot. Pevná pravidla, žádná AI: co nesedí, se nepustí dál a je „nejisté“.
// Cíl: chytit posunuté řádky v tabulkách, špatnou jednotku a nesmyslná čísla dřív, než z nich vznikne akce.

export type ReadValue = {
  code: string;
  value: number | string | null;
  unit: string | null;
  ref_low?: number | null;
  ref_high?: number | null;
  sample_date: string | null;
  flag?: string | null;
  confidence: string;
};

export type Check = { status: "ok" | "uncertain"; reasons: string[] };

type Rule = { min: number; max: number; refLow: [number, number]; refHigh: [number, number]; units: RegExp; altUnit?: { range: [number, number]; label: string } };

// Fyziologicky možné rozpětí a obvyklé referenční meze dospělých (orientační, slouží jen k odhalení záměny řádků).
const RULES: Record<string, Rule> = {
  hb: { min: 30, max: 220, refLow: [100, 140], refHigh: [140, 190], units: /^g\/l$/i, altUnit: { range: [3, 22], label: "vypadá jako g/dl, ne g/l" } },
  plt: { min: 5, max: 1500, refLow: [100, 200], refHigh: [300, 500], units: /^10\^?9\/l$/i },
  wbc: { min: 0.3, max: 100, refLow: [3, 5], refHigh: [9, 12], units: /^10\^?9\/l$/i },
  ferritin: { min: 1, max: 3000, refLow: [5, 40], refHigh: [100, 500], units: /^(ug|µg|μg)\/l$|^ng\/ml$/i },
};

const inRange = (x: number, [a, b]: [number, number]) => x >= a && x <= b;
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN);

export function checkValue(v: ReadValue, ctx: { today: Date; documentDate?: string | null }): Check {
  const rule = RULES[v.code];
  const reasons: string[] = [];
  const x = num(v.value);
  if (!rule) return { status: "ok", reasons };
  if (!Number.isFinite(x)) return { status: "uncertain", reasons: ["hodnota není číslo"] };

  if (rule.altUnit && inRange(x, rule.altUnit.range) && !(v.unit && rule.units.test(v.unit))) reasons.push(rule.altUnit.label);
  else if (x < rule.min || x > rule.max) reasons.push(`hodnota ${x} je mimo možné rozpětí`);

  // model občas píše exponent horním indexem (10⁹/l) nebo hvězdičkou (10*9/l)
  const unit = v.unit?.replace(/\s/g, "").replace(/⁹/g, "^9").replace(/\*/g, "^");
  if (unit && !rule.units.test(unit)) reasons.push(`jednotka ${v.unit} nepatří k vyšetření`);

  const lo = v.ref_low ?? null;
  const hi = v.ref_high ?? null;
  if (lo !== null && hi !== null) {
    if (lo >= hi) reasons.push("referenční meze jsou prohozené");
    else if (!inRange(lo, rule.refLow) || !inRange(hi, rule.refHigh)) reasons.push(`meze ${lo}–${hi} nepatří k vyšetření (posunutý řádek?)`);
    if (v.flag === "L" && x >= lo) reasons.push("značka L nesedí s mezemi");
    if (v.flag === "H" && x <= hi) reasons.push("značka H nesedí s mezemi");
  }

  if (v.sample_date) {
    const d = new Date(v.sample_date);
    if (d > ctx.today) reasons.push("datum odběru je v budoucnosti");
    if (ctx.documentDate && d.getTime() - new Date(ctx.documentDate).getTime() > 86_400_000) reasons.push("odběr je pozdější než zpráva");
  }

  if (v.confidence === "low") reasons.push("čtení s nízkou jistotou");
  return { status: reasons.length ? "uncertain" : "ok", reasons };
}
