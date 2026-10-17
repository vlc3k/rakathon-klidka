// Kalendářní data jako ISO řetězce (2026-11-13). Dnešek je v pražském čase, ať se dny do zákroku
// nepřehoupnou o půlnoci UTC. Rozdíly se počítají v UTC, takže je nerozhodí přechod na letní čas.

const PRAGUE_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" });
const DAY_MS = 24 * 60 * 60 * 1000;

export const todayInPrague = () => PRAGUE_DATE.format(new Date());
export const dateInPrague = (at: Date) => PRAGUE_DATE.format(at);

const utc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

export const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / DAY_MS);

export const subtractDays = (iso: string, days: number) => new Date(utc(iso) - days * DAY_MS).toISOString().slice(0, 10);

export function ageOn(birthDate: string, onDate: string) {
  const age = Number(onDate.slice(0, 4)) - Number(birthDate.slice(0, 4));
  return onDate.slice(5) < birthDate.slice(5) ? age - 1 : age;
}

// 2026-10-10 → 10. 10. 2026
export function formatCzechDate(iso: string) {
  const [year, month, day] = iso.split("-");
  return `${Number(day)}. ${Number(month)}. ${year}`;
}
