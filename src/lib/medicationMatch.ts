// Je to stejný lék? Názvy léků se v různých zdrojích píšou různě: „Paralen 500 mg (paracetamol)“ v lékovém
// záznamu, „Paralen paracetamol“ nebo jen „Paracetamol“ na zprávě. Stejný lék = mají společné výrazné slovo
// (obchodní název nebo látku): bez diakritiky, aspoň 5 písmen, bez obecných slov (léková forma, sůl…).

const GENERIC = new Set([
  "tablety", "tableta", "tablet", "inhalator", "roztok", "sirup", "sodna", "draselna", "vapenata", "injekce", "kapsle",
  "kyselina", "potreby", "denne", "disorder", "finding", "chronic", "primarni",
]);

export function medicationWords(text: unknown): string[] {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 5 && !GENERIC.has(word));
}

export function sameMedication(a: unknown, b: unknown): boolean {
  const wb = medicationWords(b);
  return medicationWords(a).some((word) => wb.includes(word));
}
