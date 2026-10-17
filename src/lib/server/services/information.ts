import "server-only";
import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";
import { INFORMATION_TYPES } from "@/db/catalog";
import { documents, information } from "@/db/schema";
import { isInformationType, parseInformationValue } from "@/db/values";
import type { CurrentUser } from "@/lib/server/auth";
import { todayInPrague } from "@/lib/server/dates";
import { getDb, type Executor } from "@/lib/server/db";
import { recordEvents } from "@/lib/server/events";
import { badRequest, conflict, notFound } from "@/lib/server/http";
import { isoDate } from "@/lib/server/validation";
import { checkValue, type Check } from "@/lib/reading/validate";

// Informace o pacientovi a jejich ověření. Ověřuje, odvolává ověření a zamítá jen AA (kontrola role je v route handleru).

export const verifySchema = z.strictObject({ ids: z.array(z.uuid()).min(1).max(200) });
export const unverifySchema = verifySchema;

export const rejectSchema = z
  .strictObject({
    note: z.string().trim().min(1).max(1000).optional(),
    correction: z.strictObject({ value: z.unknown(), observedDate: isoDate.nullable().optional() }).optional(),
  })
  .refine((body) => body.note || body.correction, { message: "Uveďte opravu, nebo aspoň důvod.", path: ["note"] });

type InformationRow = typeof information.$inferSelect;

// Kódy kontrol čtení v lib/reading/validate.ts.
const CHECK_CODES: Partial<Record<string, string>> = { hemoglobin: "hb", platelets: "plt", leukocytes: "wbc", ferritin: "ferritin" };

function readingChecks(row: InformationRow, documentIssuedDate: string | null): Check | null {
  const code = CHECK_CODES[row.type];
  const value = row.value as { value?: unknown; unit?: unknown; refLow?: unknown; refHigh?: unknown; flag?: unknown };
  if (!code || typeof value.value !== "number") return null;
  const n = (v: unknown) => (typeof v === "number" ? v : null);
  const s = (v: unknown) => (typeof v === "string" ? v : null);
  const confidence = row.confidence === null ? "medium" : row.confidence >= 0.8 ? "high" : row.confidence >= 0.5 ? "medium" : "low";
  return checkValue(
    { code, value: value.value, unit: s(value.unit), ref_low: n(value.refLow), ref_high: n(value.refHigh), sample_date: row.observedDate, flag: s(value.flag), confidence },
    { today: new Date(todayInPrague()), documentDate: documentIssuedDate },
  );
}

export function toInformationDto(row: InformationRow, documentIssuedDate: string | null = null) {
  return {
    id: row.id,
    type: row.type,
    area: isInformationType(row.type) ? INFORMATION_TYPES[row.type].area : null,
    value: row.value,
    rawText: row.rawText,
    observedDate: row.observedDate,
    isObservedDateEstimated: row.isObservedDateEstimated,
    documentId: row.documentId,
    bbox: row.bbox,
    confidence: row.confidence,
    status: row.status,
    enteredBy: row.enteredBy,
    verifiedBy: row.verifiedBy,
    verifiedAt: row.verifiedAt,
    note: row.note,
    replacesId: row.replacesId,
    taskId: row.taskId,
    createdAt: row.createdAt,
    checks: readingChecks(row, documentIssuedDate),
  };
}

// Informace i s datem vystavení dokumentu, aby kontroly čtení vyšly všude stejně.
function selectWithDocument(db: Executor, where: SQL) {
  return db
    .select({ row: information, issuedDate: documents.issuedDate })
    .from(information)
    .leftJoin(documents, eq(documents.id, information.documentId))
    .where(where)
    .orderBy(asc(information.type), asc(information.createdAt));
}

export async function listCaseInformation(db: Executor, caseId: string) {
  const rows = await selectWithDocument(db, eq(information.caseId, caseId));
  return rows.map((r) => toInformationDto(r.row, r.issuedDate));
}

async function informationDtos(db: Executor, ids: string[]) {
  const rows = await selectWithDocument(db, inArray(information.id, ids));
  const byId = new Map(rows.map((r) => [r.row.id, toInformationDto(r.row, r.issuedDate)]));
  return ids.map((id) => byId.get(id)!);
}

export async function verifyInformation(actor: CurrentUser, caseId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  return getDb().transaction(async (tx) => {
    const rows = await tx.select().from(information).where(and(eq(information.caseId, caseId), inArray(information.id, unique))).for("update");
    if (rows.length !== unique.length) throw notFound("Informace nenalezena.");
    if (rows.some((r) => r.status === "rejected")) throw conflict("Zamítnutou informaci nejde ověřit.");
    const pending = rows.filter((r) => r.status === "ai_extracted").map((r) => r.id);
    if (pending.length) {
      await tx.update(information).set({ status: "verified", verifiedBy: actor.id, verifiedAt: new Date() }).where(inArray(information.id, pending));
      await recordEvents(
        tx,
        pending.map((id) => ({ caseId, actorId: actor.id, type: "information.verified", subjectId: id, summary: "Hodnota ověřena proti dokumentu." })),
      );
    }
    return informationDtos(tx, unique);
  });
}

// Odvolání potvrzení: hodnota od AI se vrátí mezi neověřené (ai_extracted). Kdo a kdy ji potvrdil, zůstane v časové ose.
// Hodnotu, kterou zadal člověk (odpověď pacienta, oprava, zápis AA), AI nečetla, takže mezi nálezy AI nepatří; ta se opravuje přes reject.
export async function unverifyInformation(actor: CurrentUser, caseId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  return getDb().transaction(async (tx) => {
    const rows = await tx.select().from(information).where(and(eq(information.caseId, caseId), inArray(information.id, unique))).for("update");
    if (rows.length !== unique.length) throw notFound("Informace nenalezena.");
    if (rows.some((r) => r.status === "rejected")) throw conflict("Zamítnutou informaci nejde vrátit mezi neověřené.");
    if (rows.some((r) => r.enteredBy !== null)) throw conflict("Hodnotu zadal člověk, ne AI. Potvrzení nejde odvolat, opravte ji.");
    const verified = rows.filter((r) => r.status === "verified");
    if (verified.length) {
      await tx.update(information).set({ status: "ai_extracted", verifiedBy: null, verifiedAt: null }).where(inArray(information.id, verified.map((r) => r.id)));
      await recordEvents(
        tx,
        verified.map((r) => ({
          caseId,
          actorId: actor.id,
          type: "information.unverified",
          subjectId: r.id,
          summary: "Potvrzení hodnoty odvoláno.",
          data: { verifiedBy: r.verifiedBy, verifiedAt: r.verifiedAt?.toISOString() ?? null },
        })),
      );
    }
    return informationDtos(tx, unique);
  });
}

export async function rejectInformation(actor: CurrentUser, caseId: string, informationId: string, body: z.infer<typeof rejectSchema>) {
  return getDb().transaction(async (tx) => {
    const [original] = await tx.select().from(information).where(and(eq(information.id, informationId), eq(information.caseId, caseId))).for("update");
    if (!original) throw notFound("Informace nenalezena.");
    if (original.status === "rejected") throw conflict("Informace už je zamítnutá.");

    let correctionValue: unknown;
    if (body.correction) {
      const parsed = parseInformationValue(original.type, body.correction.value);
      if (!parsed.success) throw badRequest("Neplatné údaje.", parsed.issues.map((i) => ({ ...i, path: `correction.${i.path}` })));
      correctionValue = parsed.value;
    }

    const now = new Date();
    await tx.update(information).set({ status: "rejected", verifiedBy: actor.id, verifiedAt: now, note: body.note ?? null }).where(eq(information.id, original.id));

    let correction: InformationRow | null = null;
    if (body.correction) {
      // Oprava zůstává svázaná s dokumentem a výřezem, ze kterého původní hodnota pochází.
      [correction] = await tx
        .insert(information)
        .values({
          caseId,
          type: original.type,
          value: correctionValue,
          rawText: original.rawText,
          observedDate: body.correction.observedDate !== undefined ? body.correction.observedDate : original.observedDate,
          documentId: original.documentId,
          bbox: original.bbox,
          status: "verified",
          enteredBy: actor.id,
          verifiedBy: actor.id,
          verifiedAt: now,
          replacesId: original.id,
        })
        .returning();
    }

    await recordEvents(tx, [
      { caseId, actorId: actor.id, type: "information.rejected", subjectId: original.id, summary: "Hodnota nesedí s dokumentem, zamítnuta." },
      ...(correction ? [{ caseId, actorId: actor.id, type: "information.corrected", subjectId: correction.id, summary: "Hodnota opravena podle dokumentu.", data: { replaces: original.id } }] : []),
    ]);
    const [rejected, corrected] = await informationDtos(tx, correction ? [original.id, correction.id] : [original.id]);
    return { rejected, correction: corrected ?? null };
  });
}

// ---------------------------------------------------------------------------
// Hodnocení dýchacích cest (Mallampati a nálezy z fotek). Zadává anesteziolog, ne AI:
// údaj vzniká rovnou jako ověřený, kdo a kdy je ve verified_by / verified_at.
// ---------------------------------------------------------------------------

export const airwayAssessmentSchema = z.strictObject({
  mallampati: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable(),
  findings: z.array(z.string()).max(10),
  note: z.string().trim().max(500).optional(),
});

export async function recordAirwayAssessment(actor: CurrentUser, caseId: string, input: z.infer<typeof airwayAssessmentSchema>) {
  const parsed = parseInformationValue("airway_assessment", input);
  if (!parsed.success) throw badRequest("Neplatné údaje.", parsed.issues);
  return getDb().transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx
      .insert(information)
      .values({
        caseId,
        type: "airway_assessment",
        value: parsed.value,
        observedDate: todayInPrague(),
        status: "verified",
        enteredBy: actor.id,
        verifiedBy: actor.id,
        verifiedAt: now,
      })
      .returning();
    const cls = input.mallampati ? `Mallampati ${["I", "II", "III", "IV"][input.mallampati - 1]}` : "z fotek nelze hodnotit";
    await recordEvents(tx, [{ caseId, actorId: actor.id, type: "information.entered", subjectId: row.id, summary: `Dýchací cesty: ${cls}.` }]);
    return toInformationDto(row);
  });
}
