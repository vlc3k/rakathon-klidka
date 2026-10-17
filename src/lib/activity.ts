// Kalendář aktivity (/staff/activity): druhy událostí, mřížka týdnů a síla barvy dne. Čisté funkce bez Reactu.

export type ActivityCategory = "upload" | "view" | "ai" | "data" | "task" | "other";

// Pořadí je pořadí v přehledu pod kalendářem.
export const ACTIVITY_CATEGORIES: { id: ActivityCategory; label: string; hint: string }[] = [
  { id: "upload", label: "Nahrání", hint: "Pacient nebo pomocník z rodiny nahrál dokument." },
  { id: "view", label: "Zobrazení", hint: "Pacient otevřel přípravu, nebo ambulance otevřela dokument." },
  { id: "ai", label: "Čtení AI", hint: "AI přečetla dokument (i nepovedená čtení)." },
  { id: "data", label: "Údaje", hint: "Potvrzení, odvolání, opravy a ruční zadání údajů." },
  { id: "task", label: "Úkoly", hint: "Úkoly vytvořené, splněné, odložené a odebrané." },
  { id: "other", label: "Ostatní", hint: "Založení a úpravy zákroku, pomocníci z rodiny, odebrané dokumenty." },
];

export function categoryOf(type: string): ActivityCategory {
  if (type === "document.uploaded") return "upload";
  if (type === "document.seen" || type === "task.read") return "view";
  if (type.startsWith("document.read") || type.startsWith("document.transcri")) return "ai";
  if (type.startsWith("information.")) return "data";
  if (type.startsWith("task.")) return "task";
  return "other";
}

const DAY_MS = 24 * 60 * 60 * 1000;
const utc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// Týdny od pondělí `from` do neděle `to`, každý se sedmi dny (ISO data). Server posílá `from` vždy v pondělí.
export function activityWeeks(from: string, to: string): string[][] {
  const weeks: string[][] = [];
  for (let start = utc(from); start <= utc(to); start += 7 * DAY_MS) {
    weeks.push(Array.from({ length: 7 }, (_, day) => iso(start + day * DAY_MS)));
  }
  return weeks;
}

// Síla barvy 0–4 jako na GitHubu: 0 = nic, pak čtvrtiny podle nejaktivnějšího dne v rozsahu.
export function activityLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.ceil((count / max) * 4)) as 1 | 2 | 3 | 4;
}
