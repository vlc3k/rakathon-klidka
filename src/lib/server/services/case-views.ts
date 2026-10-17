import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { isClientDocumentType, type ClientDocumentType } from "@/db/catalog";
import { cases, documents, events, helpers, patients, tasks, users } from "@/db/schema";
import type { CaseRecord } from "@/lib/server/auth";
import { maskBirthNumber } from "@/lib/server/birth-number";
import { daysBetween, todayInPrague } from "@/lib/server/dates";
import { getDb, type Executor } from "@/lib/server/db";
import { loadCaseStates, patientStatusKey, type CaseState } from "@/lib/server/services/case-state";
import { CASE_CLOSED, loadCaseDtos } from "@/lib/server/services/cases";
import { DOCUMENT_SEEN } from "@/lib/server/services/documents";
import { listJoinedHelpers } from "@/lib/server/services/helpers";
import { listCaseInformation } from "@/lib/server/services/information";

// Pohledy na zákrok: detail pro AA (vše) a přehled pro pacienta (bez hodnot, upozornění a diagnózy).

type DocumentRow = typeof documents.$inferSelect;
const daysToCase = (surgeryDate: string | null, today: string) => (surgeryDate ? daysBetween(today, surgeryDate) : null);

async function caseDocuments(caseId: string) {
  return getDb().select().from(documents).where(and(eq(documents.caseId, caseId), isNull(documents.removedAt))).orderBy(asc(documents.uploadedAt));
}

// Jména lidí k ID v odpovědi (kdo nahrál, potvrdil, zadal úkol…), ať FE nemusí psát „v ambulanci“.
// U pomocníka z rodiny i vztah k pacientovi („Nahrál(a) Petra (dcera) za pacienta“).
export type People = Record<string, { displayName: string; role: "patient" | "aa" | "helper"; relation?: string }>;

async function loadPeople(db: Executor, ids: (string | null)[]): Promise<People> {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  if (unique.length === 0) return {};
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, role: users.role, relation: helpers.relation })
    .from(users)
    .leftJoin(helpers, eq(helpers.userId, users.id))
    .where(inArray(users.id, unique));
  return Object.fromEntries(rows.map((r) => [r.id, { displayName: r.displayName, role: r.role, ...(r.relation ? { relation: r.relation } : {}) }]));
}

// Proč AI lékařskou zprávu nepřečetla, aby pacient věděl, co udělat („vyfoťte znovu“). Bez hodnot.
type StatusReason = "illegible" | "partial_page" | null;
function statusReason(doc: DocumentRow): StatusReason {
  const codes = new Set((Array.isArray(doc.issues) ? doc.issues : []).map((issue: { code?: unknown }) => issue?.code));
  const legibility = (doc.transcript as { legibility?: string } | null)?.legibility;
  if (legibility === "poor" || codes.has("illegible")) return "illegible";
  if (codes.has("partial_page")) return "partial_page";
  return null;
}

// Klientské soubory (fotka, podpis, hlasovky) mají v pohledech vlastní pole, ne seznam dokumentů.
function clientFiles(docs: DocumentRow[]) {
  const latest = (type: ClientDocumentType) => docs.filter((d) => d.type === type).at(-1) ?? null;
  const consent = latest("consent_signature");
  const portrait = latest("portrait");
  const airway = latest("airway_photo");
  return {
    consent: consent ? { documentId: consent.id, signedAt: consent.uploadedAt, version: (consent.meta as { consentVersion?: string }).consentVersion ?? null } : null,
    portrait: portrait ? { documentId: portrait.id, uploadedAt: portrait.uploadedAt } : null,
    airwayPhoto: airway ? { documentId: airway.id, uploadedAt: airway.uploadedAt, meta: airway.meta } : null,
    voiceMessages: docs
      .filter((d) => d.type === "voice_message")
      .map((d) => ({ documentId: d.id, uploadedAt: d.uploadedAt, uploadedBy: d.uploadedBy, seconds: (d.meta as { seconds?: number }).seconds ?? null })),
  };
}

// Fotky dýchacích cest po polohách (ústa, profil, zakloněná hlava), u každé poslední nahraná.
// Starší nahrání bez polohy: poslední fotka jsou ústa (pacient je posílal jako poslední).
const AIRWAY_VIEWS = ["front", "profile", "extension"] as const;
type AirwayView = (typeof AIRWAY_VIEWS)[number];
function airwayPhotos(docs: DocumentRow[]) {
  const photos = docs.filter((d) => d.type === "airway_photo");
  const byView = new Map<AirwayView, DocumentRow>();
  for (const d of photos) {
    const view = (d.meta as { view?: AirwayView }).view;
    if (view && AIRWAY_VIEWS.includes(view)) byView.set(view, d);
  }
  const last = photos.at(-1);
  if (!byView.has("front") && last && !(last.meta as { view?: string }).view) byView.set("front", last);
  return AIRWAY_VIEWS.flatMap((view) => {
    const d = byView.get(view);
    return d ? [{ view, documentId: d.id, uploadedAt: d.uploadedAt, meta: d.meta }] : [];
  });
}

// ---------------------------------------------------------------------------
// Pacient
// ---------------------------------------------------------------------------

export async function listUserCases(userId: string) {
  const db = getDb();
  const rows = await db.select().from(cases).where(eq(cases.patientId, userId)).orderBy(sql`${cases.surgeryDate} asc nulls last`, asc(cases.createdAt));
  const today = todayInPrague();
  const states = await loadCaseStates(db, rows, today);
  return rows.map((row) => ({
    id: row.id,
    procedureName: row.procedureName,
    surgeryDate: row.surgeryDate,
    daysToCase: daysToCase(row.surgeryDate, today),
    status: row.status,
    statusKey: patientStatusKey(states.get(row.id)!),
  }));
}

export async function getPatientCaseView(row: CaseRecord) {
  const db = getDb();
  const today = todayInPrague();
  const [states, docs, contact] = await Promise.all([
    loadCaseStates(db, [row], today),
    caseDocuments(row.id),
    row.contactId ? db.select({ displayName: users.displayName, phone: users.phone }).from(users).where(eq(users.id, row.contactId)) : Promise.resolve([]),
  ]);
  const files = clientFiles(docs);
  const medical = docs.filter((d) => !isClientDocumentType(d.type));
  return {
    id: row.id,
    procedureName: row.procedureName,
    surgeryDate: row.surgeryDate,
    aaVisitAt: row.aaVisitAt,
    daysToCase: daysToCase(row.surgeryDate, today),
    status: row.status,
    statusKey: patientStatusKey(states.get(row.id)!),
    contact: contact[0] ?? null,
    documents: medical.map((d) => ({ id: d.id, type: d.type, taskId: d.taskId, uploadedAt: d.uploadedAt, uploadedBy: d.uploadedBy, status: d.status, statusReason: statusReason(d) })),
    ...files,
    people: await loadPeople(db, [...medical, ...docs.filter((d) => d.type === "voice_message")].map((d) => d.uploadedBy)),
  };
}

// ---------------------------------------------------------------------------
// AA
// ---------------------------------------------------------------------------

export type Alert = { key: string; title: string; info: string; informationIds: string[]; documentIds: string[] };

// Upozornění se počítají za běhu, neukládají se. Klíč odpovídá tasks.alert_key, až přibude vazba úkolu na upozornění.
export function caseAlerts(state: CaseState, docs: Pick<DocumentRow, "id" | "type" | "patientMatch">[]): Alert[] {
  const alerts: Alert[] = [];
  const { hb } = state;
  const hbIds = hb.informationId ? [hb.informationId] : [];
  if (hb.status === "alert") alerts.push({ key: `pbm.hb_low:${hb.informationId}`, title: hb.reason === "no_date" ? "Anémie v dokumentaci" : "Časné PBM posouzení", info: hb.info, informationIds: hbIds, documentIds: [] });
  else if (hb.status === "missing") alerts.push({ key: hb.reason === "stale" ? `pbm.hb_stale:${hb.informationId}` : "pbm.hb_missing", title: "Vyžádat aktuální hemoglobin", info: hb.info, informationIds: hbIds, documentIds: [] });
  else if (hb.status === "uncertain") alerts.push({ key: `hb.uncertain:${hb.informationId}`, title: "Ověřit hemoglobin", info: hb.info, informationIds: hbIds, documentIds: [] });

  for (const doc of docs) {
    if (isClientDocumentType(doc.type) || (doc.patientMatch !== "mismatch" && doc.patientMatch !== "uncertain")) continue;
    alerts.push({
      key: `document.identity:${doc.id}`,
      title: doc.patientMatch === "mismatch" ? "Dokument patří jinému pacientovi" : "Dokument nelze spolehlivě přiřadit",
      info: "Údaje z dokumentu se nepoužijí, dokud vazbu nepotvrdí člověk.",
      informationIds: [],
      documentIds: [doc.id],
    });
  }
  return alerts;
}

export async function getCaseDetail(row: CaseRecord) {
  const db = getDb();
  const today = todayInPrague();
  const [[caseDto], states, docs, info, taskPeople, [patient], seenEvents, caseHelpers, [closedEvent]] = await Promise.all([
    loadCaseDtos(db, [row]),
    loadCaseStates(db, [row], today),
    caseDocuments(row.id),
    listCaseInformation(db, row.id),
    // úkoly chodí přes /tasks, jejich lidi (zadal, schválil, uzavřel) jsou ale v mapě people tady
    db.select({ createdBy: tasks.createdBy, approvedBy: tasks.approvedBy, completedBy: tasks.completedBy, assigneeId: tasks.assigneeId }).from(tasks).where(eq(tasks.caseId, row.id)),
    db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, displayName: users.displayName, phone: users.phone, externalId: patients.externalId, birthNumber: patients.birthNumber, birthDate: patients.birthDate, sex: patients.sex })
      .from(users)
      .innerJoin(patients, eq(patients.userId, users.id))
      .where(eq(users.id, row.patientId)),
    // Kdy a kdo z ambulance dokument poprvé otevřel (markDocumentSeen).
    db
      .select({ documentId: events.subjectId, at: events.createdAt, by: events.actorId })
      .from(events)
      .where(and(eq(events.caseId, row.id), eq(events.type, DOCUMENT_SEEN)))
      .orderBy(asc(events.createdAt)),
    listJoinedHelpers(db, row.patientId),
    // Kdo a kdy zákrok uzavřel (export); jen když je uzavřený.
    row.status === "closed"
      ? db
          .select({ at: events.createdAt, by: events.actorId })
          .from(events)
          .where(and(eq(events.caseId, row.id), eq(events.type, CASE_CLOSED)))
          .orderBy(desc(events.createdAt))
          .limit(1)
      : Promise.resolve([]),
  ]);
  const seen = new Map<string, { at: Date; by: string | null }>();
  for (const event of seenEvents) if (event.documentId && !seen.has(event.documentId)) seen.set(event.documentId, { at: event.at, by: event.by });
  const state = states.get(row.id)!;
  const files = clientFiles(docs);
  // Poslední hodnocení dýchacích cest (zadává AA) i se jménem, kdo hodnotil.
  const assessment = info.filter((i) => i.type === "airway_assessment").at(-1) ?? null;
  const [assessor] = assessment?.verifiedBy
    ? await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, assessment.verifiedBy))
    : [];
  return {
    case: { ...caseDto, daysToCase: daysToCase(row.surgeryDate, today) },
    patient: { ...patient, birthNumber: patient.birthNumber ? maskBirthNumber(patient.birthNumber) : null, portraitDocumentId: files.portrait?.documentId ?? null },
    closed: row.status === "closed" ? { at: closedEvent?.at ?? row.updatedAt, by: closedEvent?.by ?? null } : null,
    hb: state.hb,
    pbm: state.pbm,
    alerts: caseAlerts(state, docs),
    documents: docs
      .filter((d) => !isClientDocumentType(d.type))
      .map((d) => ({
        id: d.id,
        type: d.type,
        status: d.status,
        fileName: d.fileName,
        mimeType: d.mimeType,
        issuedDate: d.issuedDate,
        pageLabel: d.pageLabel,
        patientMatch: d.patientMatch,
        patientMatchNote: d.patientMatchNote,
        issues: d.issues,
        taskId: d.taskId,
        uploadedBy: d.uploadedBy,
        uploadedAt: d.uploadedAt,
        processedAt: d.processedAt,
        error: d.error,
        seenAt: seen.get(d.id)?.at ?? null,
        seenBy: seen.get(d.id)?.by ?? null,
      })),
    information: info,
    activity: { consent: files.consent, voiceMessages: files.voiceMessages },
    airway: files.airwayPhoto,
    airwayPhotos: airwayPhotos(docs),
    // Kdo z rodiny pacientovi pomáhá (hlavička zákroku: „Pomáhá: Petra, dcera“).
    helpers: caseHelpers,
    airwayAssessment: assessment
      ? { ...(assessment.value as { mallampati: 1 | 2 | 3 | 4 | null; findings: string[]; note?: string }), by: assessor?.displayName ?? null, at: assessment.verifiedAt }
      : null,
    people: await loadPeople(db, [
      row.createdBy,
      ...docs.flatMap((d) => [d.uploadedBy, d.patientMatchCheckedBy]),
      ...info.flatMap((i) => [i.enteredBy, i.verifiedBy]),
      ...taskPeople.flatMap((t) => [t.createdBy, t.approvedBy, t.completedBy, t.assigneeId]),
      closedEvent?.by ?? null,
    ]),
  };
}
