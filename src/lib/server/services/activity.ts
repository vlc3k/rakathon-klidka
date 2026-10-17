import "server-only";
import { desc, eq } from "drizzle-orm";
import { cases, events, users } from "@/db/schema";
import { dateInPrague, subtractDays, todayInPrague } from "@/lib/server/dates";
import { getDb } from "@/lib/server/db";

// Aktivita jednoho zákroku po dnech (záložka Aktivita v detailu, kalendář ve stylu GitHubu): všechny události
// (nahrání, zobrazení, čtení AI, potvrzení, úkoly…) a naplánovaný zákrok. Mřížka jde po týdnech od pondělí,
// od týdne před založením zákroku do týdne po zákroku (nebo po dnešku), aspoň MIN_WEEKS týdnů.

const MIN_WEEKS = 12;
// Pojistka proti obří odpovědi. Jeden zákrok mívá desítky až stovky událostí.
const MAX_EVENTS = 5_000;

const mondayOf = (day: string) => subtractDays(day, (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7);

export function activityRange(first: string, last: string) {
  let from = subtractDays(mondayOf(first), 7);
  const to = subtractDays(mondayOf(last), -13); // neděle týdne po posledním dni
  const DAY_MS = 24 * 60 * 60 * 1000;
  const weeks = (Date.parse(to) - Date.parse(from) + DAY_MS) / (7 * DAY_MS);
  if (weeks < MIN_WEEKS) from = subtractDays(from, Math.ceil(MIN_WEEKS - weeks) * 7);
  return { from, to };
}

export async function getCaseActivity(caseId: string) {
  const db = getDb();
  const today = todayInPrague();
  const [[row], rows] = await Promise.all([
    db.select({ createdAt: cases.createdAt, surgeryDate: cases.surgeryDate, procedureName: cases.procedureName, status: cases.status }).from(cases).where(eq(cases.id, caseId)),
    db
      .select({ id: events.id, type: events.type, summary: events.summary, createdAt: events.createdAt, actorName: users.displayName, actorRole: users.role })
      .from(events)
      .leftJoin(users, eq(users.id, events.actorId))
      .where(eq(events.caseId, caseId))
      .orderBy(desc(events.id))
      .limit(MAX_EVENTS),
  ]);
  const list = rows.map((event) => ({
    id: event.id,
    type: event.type,
    day: dateInPrague(event.createdAt),
    at: event.createdAt,
    summary: event.summary,
    actor: event.actorName ? { displayName: event.actorName, role: event.actorRole! } : null,
  }));

  const days = [dateInPrague(row.createdAt), today, ...list.map((event) => event.day), ...(row.surgeryDate ? [row.surgeryDate] : [])].sort();
  const { from, to } = activityRange(days[0], days.at(-1)!);
  return {
    from,
    to,
    today,
    events: list,
    // Zrušený zákrok se v kalendáři neukazuje jako plánovaný.
    surgery: row.surgeryDate && row.status !== "cancelled" ? { date: row.surgeryDate, procedureName: row.procedureName } : null,
  };
}
