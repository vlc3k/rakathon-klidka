import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { patients, users } from "@/db/schema";
import { getDb } from "@/lib/server/db";
import { staffEnv } from "@/lib/server/env";

// Minimální přihlášení do doby, než bude BankID: pacient identifikátorem z nemocnice a datem narození,
// lékař e-mailem a společným heslem z prostředí. BankID později jen nahradí authenticate().

const patientCredentials = z.strictObject({
  identifier: z.string().trim().min(1).max(64),
  birthDate: z.iso.date(),
});

const staffCredentials = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(1).max(256),
});

export const credentialsSchema = z.union([patientCredentials, staffCredentials]);
export type Credentials = z.infer<typeof credentialsSchema>;

export type AuthenticatedUser = { id: string; role: "patient" | "aa" | "helper"; displayName: string };

export const normalizeIdentifier = (identifier: string) => identifier.trim().toUpperCase();

export async function authenticate(credentials: Credentials): Promise<AuthenticatedUser | null> {
  return "identifier" in credentials ? authenticatePatient(credentials) : authenticateStaff(credentials);
}

async function authenticatePatient({ identifier, birthDate }: z.infer<typeof patientCredentials>) {
  const [row] = await getDb()
    .select({ id: users.id, role: users.role, displayName: users.displayName, birthDate: patients.birthDate })
    .from(patients)
    .innerJoin(users, eq(users.id, patients.userId))
    .where(and(eq(patients.externalId, normalizeIdentifier(identifier)), eq(users.role, "patient")));
  if (!row || row.birthDate !== birthDate) return null;
  return { id: row.id, role: row.role, displayName: row.displayName };
}

// Pacient přihlášený přes Bank iD: banka ověřila totožnost, pacienta najdeme podle rodného čísla a data narození.
export async function authenticateBankid(person: { birthNumber?: string; birthDate?: string }): Promise<AuthenticatedUser | null> {
  if (!person.birthNumber || !person.birthDate) return null;
  const [row] = await getDb()
    .select({ id: users.id, role: users.role, displayName: users.displayName, birthDate: patients.birthDate })
    .from(patients)
    .innerJoin(users, eq(users.id, patients.userId))
    .where(and(eq(patients.birthNumber, person.birthNumber), eq(users.role, "patient")));
  if (!row || row.birthDate !== person.birthDate) return null;
  return { id: row.id, role: row.role, displayName: row.displayName };
}

async function authenticateStaff({ email, password }: z.infer<typeof staffCredentials>) {
  const expected = staffEnv().STAFF_PASSWORD;
  const [row] = await getDb()
    .select({ id: users.id, role: users.role, displayName: users.displayName })
    .from(users)
    .where(and(sql`lower(${users.email}) = ${email}`, eq(users.role, "aa")));
  // Heslo se porovná vždy, i když uživatel neexistuje, ať doba odpovědi neprozradí, které e-maily v systému jsou.
  const passwordOk = expected !== undefined && safeEqual(password, expected);
  if (!row || !passwordOk) return null;
  return row;
}

function safeEqual(a: string, b: string) {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}
