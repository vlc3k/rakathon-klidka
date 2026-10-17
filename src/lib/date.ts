// Kalendářní data jako ISO řetězce (2026-11-04). Dnešek v pražském čase, stejně jako server
// (lib/server/dates.ts), ať dny do zákroku v prohlížeči sedí s frontou z API.

const PRAGUE_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" });
const DAY_MS = 86_400_000;

export const todayIso = () => PRAGUE_DATE.format(new Date());

// Den z data (2026-11-04) beze změny, z času (2026-11-03T23:30:00Z) podle Prahy, ať se o půlnoci neposune.
const pragueDay = (iso: string) => (iso.length > 10 ? PRAGUE_DATE.format(new Date(iso)) : iso);

// 2026-11-04 → 4. 11. Samotné datum bez Date, ať se server a prohlížeč neliší časovým pásmem.
export function formatDate(iso: string) {
  const [, month, day] = pragueDay(iso).split("-");
  return `${Number(day)}. ${Number(month)}.`;
}

// 2026-11-04 → 4. 11. 2026
export function formatFullDate(iso: string) {
  const [year, month, day] = pragueDay(iso).split("-");
  return `${Number(day)}. ${Number(month)}. ${year}`;
}

// Čas z API (ISO s časovou zónou) → 4. 11. 14:05 v místním čase.
export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Celé dny mezi dvěma ISO daty. Date.parse čte samotné datum jako UTC, takže bez posunu pásma.
export function daysUntil(iso: string, today = todayIso()) {
  return Math.round((Date.parse(iso.slice(0, 10)) - Date.parse(today)) / DAY_MS);
}

// Datum k offsetu od dneška (0 = dnes).
export function dayLabel(offset: number, today = todayIso()) {
  const d = new Date(Date.parse(today) + offset * DAY_MS);
  return `${d.getUTCDate()}. ${d.getUTCMonth() + 1}.`;
}
