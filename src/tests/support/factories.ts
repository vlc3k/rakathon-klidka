import * as s from "@/db/schema";
import { createSession, SESSION_COOKIE } from "@/lib/server/session";
import { testDb } from "./db";

// Testovací data vkládá přímo do databáze, nezávisle na testovaném API.

let counter = 0;
const next = () => ++counter;

export async function createStaff(overrides: Partial<typeof s.users.$inferInsert> = {}) {
  const n = next();
  const [user] = await testDb
    .insert(s.users)
    .values({ role: "aa", firstName: "Eva", lastName: `Malá${n}`, displayName: `MUDr. Eva Malá${n}`, email: `eva${n}@vfn.cz`, phone: "+420224000000", ...overrides })
    .returning();
  return user;
}

export async function createPatient(overrides: { user?: Partial<typeof s.users.$inferInsert>; patient?: Partial<typeof s.patients.$inferInsert> } = {}) {
  const n = next();
  const [user] = await testDb
    .insert(s.users)
    .values({ role: "patient", firstName: "Jan", lastName: `Novák${n}`, displayName: `Jan Novák${n}`, phone: "+420600000001", ...overrides.user })
    .returning();
  const [patient] = await testDb
    .insert(s.patients)
    .values({ userId: user.id, externalId: `VFN-2026-${String(n).padStart(4, "0")}`, birthDate: "1960-03-01", ...overrides.patient })
    .returning();
  return { user, patient };
}

export async function loginCookie(userId: string) {
  const { token } = await createSession(userId);
  return `${SESSION_COOKIE}=${token}`;
}

export async function createCase(patientId: string, createdBy: string, overrides: Partial<typeof s.cases.$inferInsert> = {}) {
  const [row] = await testDb
    .insert(s.cases)
    .values({ patientId, createdBy, status: "active", procedureName: "Resekce tlustého střeva", surgeryDate: "2026-11-13", contactId: createdBy, ...overrides })
    .returning();
  return row;
}

export async function createDocument(caseId: string, uploadedBy: string, overrides: Partial<typeof s.documents.$inferInsert> = {}) {
  const n = next();
  const [row] = await testDb
    .insert(s.documents)
    .values({ caseId, uploadedBy, filePath: `cases/${caseId}/doc-${n}`, mimeType: "image/jpeg", sha256: `sha-${n}`, status: "processed", type: "lab_report", patientMatch: "match", ...overrides })
    .returning();
  return row;
}

export async function createInformation(caseId: string, overrides: Partial<typeof s.information.$inferInsert> & Pick<typeof s.information.$inferInsert, "type" | "value">) {
  const [row] = await testDb
    .insert(s.information)
    .values({ caseId, status: "ai_extracted", ...overrides })
    .returning();
  return row;
}

export async function createTask(caseId: string, overrides: Partial<typeof s.tasks.$inferInsert> = {}) {
  const [row] = await testDb
    .insert(s.tasks)
    .values({ caseId, assignee: "patient", kind: "upload", title: "Krevní testy", documentType: "lab_report", informationType: "hemoglobin", ...overrides })
    .returning();
  return row;
}
