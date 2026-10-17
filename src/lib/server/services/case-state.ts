import "server-only";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { documents, information, tasks } from "@/db/schema";
import type { Executor } from "@/lib/server/db";
import { evaluateHemoglobin, type HbFinding, type HbObservation } from "@/lib/server/rules/hemoglobin";
import { evaluatePbm, type PbmState } from "@/lib/server/rules/pbm";

// Spočítaný stav zákroku: hemoglobin, PBM a postup úkolů. Neukládá se, počítá se při každém čtení
// (fronta, detail, přehled pro pacienta) dávkově pro víc zákroků najednou.

export type CaseState = {
  hb: HbFinding;
  pbm: PbmState;
  uploads: { done: number; total: number };
  openPatientTasks: number;
};

export type PatientStatusKey = "pbm_running" | "reviewing" | "ok";

const ACTIVE_TASK = new Set(["open", "submitted", "snoozed"]);

type LabValue = { value?: unknown; unit?: unknown; refLow?: unknown; refHigh?: unknown; flag?: unknown };
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" ? v : null);

export async function loadCaseStates(db: Executor, rows: { id: string; bloodLossMl: number | null }[], today: string): Promise<Map<string, CaseState>> {
  const ids = rows.map((r) => r.id);
  const states = new Map<string, CaseState>();
  if (ids.length === 0) return states;

  const [hbRows, anemiaRows, taskRows] = await Promise.all([
    db
      .select({
        caseId: information.caseId,
        id: information.id,
        value: information.value,
        observedDate: information.observedDate,
        isObservedDateEstimated: information.isObservedDateEstimated,
        status: information.status,
        confidence: information.confidence,
        createdAt: information.createdAt,
        documentMatch: documents.patientMatch,
        documentIssuedDate: documents.issuedDate,
      })
      .from(information)
      .leftJoin(documents, eq(documents.id, information.documentId))
      .where(and(inArray(information.caseId, ids), eq(information.type, "hemoglobin"))),
    db
      .selectDistinctOn([information.caseId], { caseId: information.caseId, value: information.value })
      .from(information)
      .where(and(inArray(information.caseId, ids), eq(information.type, "known_anemia"), ne(information.status, "rejected")))
      .orderBy(information.caseId, desc(information.createdAt)),
    db.select({ caseId: tasks.caseId, assignee: tasks.assignee, kind: tasks.kind, status: tasks.status, process: tasks.process }).from(tasks).where(inArray(tasks.caseId, ids)),
  ]);

  const observations = new Map<string, HbObservation[]>();
  for (const row of hbRows) {
    const value = row.value as LabValue;
    const hb = num(value.value);
    if (hb === null) continue;
    const list = observations.get(row.caseId) ?? [];
    list.push({
      informationId: row.id,
      value: hb,
      unit: str(value.unit),
      refLow: num(value.refLow),
      refHigh: num(value.refHigh),
      flag: str(value.flag),
      observedDate: row.observedDate,
      isObservedDateEstimated: row.isObservedDateEstimated,
      status: row.status,
      confidence: row.confidence,
      documentMatch: row.documentMatch,
      documentIssuedDate: row.documentIssuedDate,
      createdAt: row.createdAt,
    });
    observations.set(row.caseId, list);
  }
  const tasksByCase = new Map<string, typeof taskRows>();
  for (const task of taskRows) {
    if (task.status === "cancelled") continue;
    const list = tasksByCase.get(task.caseId);
    if (list) list.push(task);
    else tasksByCase.set(task.caseId, [task]);
  }
  const knownAnemia = new Set(anemiaRows.filter((r) => (r.value as { value?: unknown }).value === true).map((r) => r.caseId));

  for (const row of rows) {
    const own = tasksByCase.get(row.id) ?? [];
    const uploads = own.filter((t) => t.kind === "upload");
    const hb = evaluateHemoglobin(observations.get(row.id) ?? [], today);
    states.set(row.id, {
      hb,
      pbm: evaluatePbm({
        bloodLossMl: row.bloodLossMl,
        hbStatus: hb.status,
        knownAnemia: knownAnemia.has(row.id),
        activePbmTasks: own.filter((t) => t.process === "pbm" && ACTIVE_TASK.has(t.status)).length,
      }),
      uploads: { done: uploads.filter((t) => t.status === "done").length, total: uploads.length },
      openPatientTasks: own.filter((t) => t.assignee === "patient" && ACTIVE_TASK.has(t.status)).length,
    });
  }
  return states;
}

// Stav přípravy, jak ho vidí pacient. Bez čísel: jen jestli je potřeba odběr, nebo dokumenty prohlíží AA.
// „V pořádku“ jen z ověřeného hemoglobinu (klinicky významná zpráva pacientovi jen z ověřeného údaje).
export function patientStatusKey(state: CaseState): PatientStatusKey {
  if (state.pbm.status === "running") return "pbm_running";
  if (state.hb.status === "ok" && state.hb.verified && state.openPatientTasks === 0) return "ok";
  return "reviewing";
}
