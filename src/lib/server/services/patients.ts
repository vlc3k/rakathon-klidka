import "server-only";
import { asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { cases, patients, users } from "@/db/schema";
import type { CurrentUser } from "@/lib/server/auth";
import { maskBirthNumber, parseBirthNumber } from "@/lib/server/birth-number";
import { getDb } from "@/lib/server/db";
import { uniqueConstraint } from "@/lib/server/db-errors";
import { badRequest, conflict, notFound, prefixIssues } from "@/lib/server/http";
import { normalizeIdentifier } from "@/lib/server/services/login";
import { caseInputSchema, createCase } from "@/lib/server/services/cases";
import { isoDate, likePattern, personName, phone } from "@/lib/server/validation";

// Pacienti: uživatel s rolí 'patient' + řádek v patients. RČ se ukládá jen jako číslice,
// v seznamu jde ven maskované, celé jen v detailu pro formulář úpravy.

const identityFields = {
  firstName: personName,
  lastName: personName,
  phone: phone.nullable(),
  externalId: z.string().trim().min(1).max(64), // pacient se jím přihlašuje
  birthNumber: z.string().trim().max(16).nullable(),
  birthDate: isoDate,
  sex: z.enum(["M", "F"]).nullable(),
};

export const createPatientSchema = z.strictObject({
  firstName: identityFields.firstName,
  lastName: identityFields.lastName,
  phone: identityFields.phone.optional(),
  externalId: identityFields.externalId,
  birthNumber: identityFields.birthNumber.optional(),
  birthDate: identityFields.birthDate.optional(),
  sex: identityFields.sex.optional(),
  cases: z.array(caseInputSchema).max(20).optional(),
});

export const patchPatientSchema = z.strictObject({
  firstName: identityFields.firstName.optional(),
  lastName: identityFields.lastName.optional(),
  phone: identityFields.phone.optional(),
  externalId: identityFields.externalId.optional(),
  birthNumber: identityFields.birthNumber.optional(),
  birthDate: identityFields.birthDate.optional(),
  sex: identityFields.sex.optional(),
});

export const listPatientsSchema = z.strictObject({ q: z.string().trim().max(100).optional() });

type Identity = { birthNumber: string | null; birthDate: string; sex: string | null };

// Z RČ se odvodí datum narození a pohlaví. Když přijde i datum narození, musí sedět.
function resolveIdentity(input: { birthNumber?: string | null; birthDate?: string; sex?: string | null }): Identity {
  if (input.birthNumber) {
    const parsed = parseBirthNumber(input.birthNumber);
    if (!parsed) throw badRequest("Neplatné údaje.", [{ path: "birthNumber", message: "Neplatné rodné číslo." }]);
    if (input.birthDate && input.birthDate !== parsed.birthDate) {
      throw badRequest("Neplatné údaje.", [{ path: "birthDate", message: "Datum narození nesedí s rodným číslem." }]);
    }
    return { birthNumber: parsed.digits, birthDate: parsed.birthDate, sex: input.sex ?? parsed.sex };
  }
  if (!input.birthDate) throw badRequest("Neplatné údaje.", [{ path: "birthDate", message: "Bez rodného čísla je datum narození povinné." }]);
  return { birthNumber: null, birthDate: input.birthDate, sex: input.sex ?? null };
}

function duplicateError(error: unknown) {
  const constraint = uniqueConstraint(error);
  if (constraint === "patients_external_id_unique") return conflict("Pacient s tímto identifikátorem už existuje.");
  if (constraint === "patients_birth_number_unique") return conflict("Pacient s tímto rodným číslem už existuje.");
  return null;
}

type PatientRow = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  phone: string | null;
  createdAt: Date;
  externalId: string | null;
  birthNumber: string | null;
  birthDate: string;
  sex: string | null;
};

const patientColumns = {
  id: users.id,
  firstName: users.firstName,
  lastName: users.lastName,
  displayName: users.displayName,
  phone: users.phone,
  createdAt: users.createdAt,
  externalId: patients.externalId,
  birthNumber: patients.birthNumber,
  birthDate: patients.birthDate,
  sex: patients.sex,
};

async function withCases(rows: PatientRow[], fullBirthNumber: boolean) {
  const ids = rows.map((r) => r.id);
  const caseRows = ids.length
    ? await getDb()
        .select({ id: cases.id, patientId: cases.patientId, procedureName: cases.procedureName, surgeryDate: cases.surgeryDate, status: cases.status })
        .from(cases)
        .where(inArray(cases.patientId, ids))
        .orderBy(sql`${cases.surgeryDate} asc nulls last`, asc(cases.createdAt))
    : [];
  return rows.map((row) => ({
    ...row,
    birthNumber: row.birthNumber && !fullBirthNumber ? maskBirthNumber(row.birthNumber) : row.birthNumber,
    cases: caseRows.filter((c) => c.patientId === row.id).map((c) => ({ id: c.id, procedureName: c.procedureName, surgeryDate: c.surgeryDate, status: c.status })),
  }));
}

export async function listPatients({ q }: z.infer<typeof listPatientsSchema>) {
  const pattern = q ? likePattern(q) : null;
  const rows = await getDb()
    .select(patientColumns)
    .from(users)
    .innerJoin(patients, eq(patients.userId, users.id))
    .where(pattern ? or(ilike(users.firstName, pattern), ilike(users.lastName, pattern), ilike(patients.externalId, pattern)) : undefined)
    .orderBy(asc(users.lastName), asc(users.firstName))
    .limit(500);
  return withCases(rows, false);
}

// Celé RČ jen pro formulář úpravy; jinde maskované.
export async function getPatient(patientId: string, { fullBirthNumber = true } = {}) {
  const [row] = await getDb().select(patientColumns).from(users).innerJoin(patients, eq(patients.userId, users.id)).where(eq(users.id, patientId));
  if (!row) throw notFound("Pacient nenalezen.");
  return (await withCases([row], fullBirthNumber))[0];
}

export async function createPatient(actor: CurrentUser, input: z.infer<typeof createPatientSchema>) {
  const identity = resolveIdentity(input);
  try {
    const id = await getDb().transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ role: "patient", firstName: input.firstName, lastName: input.lastName, displayName: `${input.firstName} ${input.lastName}`, phone: input.phone ?? null })
        .returning({ id: users.id });
      await tx.insert(patients).values({ userId: user.id, externalId: normalizeIdentifier(input.externalId), ...identity });
      for (const [i, caseInput] of (input.cases ?? []).entries()) {
        await createCase(tx, actor, { ...caseInput, patientId: user.id }).catch((error: unknown) => {
          throw prefixIssues(error, `cases.${i}`);
        });
      }
      return user.id;
    });
    return getPatient(id, { fullBirthNumber: false });
  } catch (error) {
    throw duplicateError(error) ?? error;
  }
}

export async function updatePatient(patientId: string, patch: z.infer<typeof patchPatientSchema>) {
  const current = await getPatient(patientId);
  const touchesIdentity = patch.birthNumber !== undefined || patch.birthDate !== undefined || patch.sex !== undefined;
  // Nové RČ určí datum narození a pohlaví samo; když se RČ odebírá nebo nemění, platí dosavadní údaje.
  const newBirthNumber = patch.birthNumber !== undefined && patch.birthNumber !== null;
  const identity = touchesIdentity
    ? resolveIdentity({
        birthNumber: patch.birthNumber !== undefined ? patch.birthNumber : current.birthNumber,
        birthDate: patch.birthDate ?? (newBirthNumber ? undefined : current.birthDate),
        sex: patch.sex !== undefined ? patch.sex : newBirthNumber ? undefined : current.sex,
      })
    : null;
  const firstName = patch.firstName ?? current.firstName;
  const lastName = patch.lastName ?? current.lastName;
  try {
    await getDb().transaction(async (tx) => {
      if (patch.firstName !== undefined || patch.lastName !== undefined || patch.phone !== undefined) {
        await tx.update(users).set({ firstName, lastName, displayName: `${firstName} ${lastName}`, ...(patch.phone !== undefined ? { phone: patch.phone } : {}) }).where(eq(users.id, patientId));
      }
      if (identity || patch.externalId !== undefined) {
        await tx
          .update(patients)
          .set({ ...(identity ?? {}), ...(patch.externalId !== undefined ? { externalId: normalizeIdentifier(patch.externalId) } : {}) })
          .where(eq(patients.userId, patientId));
      }
    });
  } catch (error) {
    throw duplicateError(error) ?? error;
  }
  return getPatient(patientId);
}
