import "server-only";
import { and, count, eq, inArray, isNull, max, ne, or } from "drizzle-orm";
import { cases, events, users } from "@/db/schema";
import { dateInPrague, daysBetween, todayInPrague } from "@/lib/server/dates";
import { getDb } from "@/lib/server/db";
import type { HbStatus } from "@/lib/server/rules/hemoglobin";
import { loadCaseStates, type CaseState } from "@/lib/server/services/case-state";

// Fronta pro AA: kdo potřebuje pozornost. Pořadí Pozor → Doplnit → Nejisté → V pořádku, uvnitř podle dní do zákroku.

export type NextStep = "await_lab" | "assess_pbm" | "request_hb" | "verify" | null;

// Pacient, který se od založení zákroku tolik dní vůbec neozval (ani si neotevřel úkoly), patří sestře na telefon.
// Počítáme s tím, že appku 30–40 % lidí nepoužije (docs/brain/25-zlidsteni-pacienta.md).
export const SILENT_AFTER_DAYS = 2;

const RANK: Record<HbStatus, number> = { alert: 0, missing: 1, uncertain: 2, ok: 3 };

function nextStep(state: CaseState): NextStep {
  if (state.pbm.status === "running") return "await_lab";
  if (state.hb.status === "alert") return "assess_pbm";
  if (state.hb.status === "missing") return "request_hb";
  if (state.hb.status === "uncertain") return "verify";
  return null;
}

// Kolik dní se pacient neozval; null = ozval se, nebo je zákrok založený teprve nedávno.
export function silentDays(heard: boolean, createdOn: string, today: string) {
  if (heard) return null;
  const days = daysBetween(createdOn, today);
  return days >= SILENT_AFTER_DAYS ? days : null;
}

export async function getQueue() {
  const db = getDb();
  const today = todayInPrague();
  const rows = await db.select().from(cases).where(inArray(cases.status, ["new", "active"]));
  const ids = rows.map((r) => r.id);
  const [states, patients, activity, patientEvents] = await Promise.all([
    loadCaseStates(db, rows, today),
    ids.length ? db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, [...new Set(rows.map((r) => r.patientId))])) : Promise.resolve([]),
    // Poslední událost od pacienta nebo systému (AI dočetla dokument). Co udělal někdo z AA, „nové“ není,
    // ani to, že si pacient jen zobrazil úkoly.
    ids.length
      ? db
          .select({ caseId: events.caseId, latest: max(events.createdAt) })
          .from(events)
          .leftJoin(users, eq(users.id, events.actorId))
          .where(and(inArray(events.caseId, ids), or(isNull(events.actorId), eq(users.role, "patient")), ne(events.type, "task.read")))
          .groupBy(events.caseId)
      : Promise.resolve([]),
    // Cokoli, co udělal pacient sám, včetně otevření úkolů: ozval se.
    ids.length
      ? db
          .select({ caseId: events.caseId, n: count() })
          .from(events)
          .innerJoin(users, eq(users.id, events.actorId))
          .where(and(inArray(events.caseId, ids), eq(users.role, "patient")))
          .groupBy(events.caseId)
      : Promise.resolve([]),
  ]);
  const heardFrom = new Set(patientEvents.filter((e) => e.n > 0).map((e) => e.caseId));
  const nameById = new Map(patients.map((p) => [p.id, p.displayName]));
  const latestByCase = new Map(activity.map((a) => [a.caseId, a.latest]));

  const queue = rows
    .map((row) => {
      const state = states.get(row.id)!;
      const latest = latestByCase.get(row.id) ?? null;
      return {
        caseId: row.id,
        patientId: row.patientId,
        patientName: nameById.get(row.patientId) ?? "",
        procedureName: row.procedureName,
        surgeryDate: row.surgeryDate,
        daysToCase: row.surgeryDate ? daysBetween(today, row.surgeryDate) : null,
        hb: { value: state.hb.value, status: state.hb.status, reason: state.hb.reason, verified: state.hb.verified, info: state.hb.info },
        pbmStatus: state.pbm.status,
        nextStep: nextStep(state),
        uploads: { ...state.uploads, findings: state.hb.status === "alert" && state.hb.value !== null ? [`Hb ${state.hb.value}`] : [] },
        isNew: latest !== null && (row.aaSeenAt === null || latest > row.aaSeenAt),
        silentDays: silentDays(heardFrom.has(row.id), dateInPrague(row.createdAt), today),
      };
    })
    .sort((a, b) => RANK[a.hb.status] - RANK[b.hb.status] || (a.daysToCase ?? Infinity) - (b.daysToCase ?? Infinity));

  // „Předem“: průměrně tolik dní před zákrokem hemoglobin známe.
  const known = queue.filter((r) => r.hb.value !== null && r.hb.status !== "uncertain" && r.daysToCase !== null);
  const daysAhead = known.length ? Math.round(known.reduce((sum, r) => sum + r.daysToCase!, 0) / known.length) : 0;
  return {
    stats: { alert: queue.filter((r) => r.hb.status === "alert").length, new: queue.filter((r) => r.isNew).length, silent: queue.filter((r) => r.silentDays !== null).length, daysAhead },
    rows: queue,
  };
}
