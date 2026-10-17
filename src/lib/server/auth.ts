import "server-only";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { connection, type NextRequest } from "next/server";
import { cases } from "@/db/schema";
import { getDb } from "@/lib/server/db";
import { conflict, forbidden, notFound, unauthorized } from "@/lib/server/http";
import { getSessionUser, readSessionToken, SESSION_COOKIE, type SessionUser } from "@/lib/server/session";
import { homeOf } from "@/lib/roles";

// Oprávnění na jednom místě. Každý route handler si uživatele ověří sám, nikdy nevěří klientovi.
// Cizí zákrok vrací 404, ne 403, aby nešlo zjišťovat, která ID existují.

export type CurrentUser = SessionUser;
export type CaseRecord = typeof cases.$inferSelect;

export async function requireUser(req: NextRequest): Promise<CurrentUser> {
  const user = await getSessionUser(readSessionToken(req));
  if (!user) throw unauthorized();
  return user;
}

// Zvát a odebírat pomocníky smí jen pacient sám, pomocník ani AA ne.
export async function requirePatient(req: NextRequest): Promise<CurrentUser> {
  const user = await requireUser(req);
  if (user.role !== "patient") throw forbidden("Tohle může udělat jen pacient sám.");
  return user;
}

export async function requireStaff(req: NextRequest): Promise<CurrentUser> {
  const user = await requireUser(req);
  if (user.role !== "aa") throw forbidden();
  return user;
}

// Stránky: přihlášení se ověří na serveru ještě před vykreslením (layout, RoleGate).
// Bez platné session na přihlášení, s jinou rolí na její úvodní stránku. Čte cookie za běhu,
// proto se volá uvnitř <Suspense>. Víc rolí: pacientskou část vidí i pomocník z rodiny.
export async function requireRole(role: CurrentUser["role"] | CurrentUser["role"][]): Promise<CurrentUser> {
  // Platnost session se porovnává s aktuálním časem, proto se to počítá při každém požadavku.
  await connection();
  const user = await getSessionUser((await cookies()).get(SESSION_COOKIE)?.value);
  if (user && (Array.isArray(role) ? role : [role]).includes(user.role)) return user;
  // Až tady: next/navigation se mimo Next (skripty, scripts/seed-cases.ts) nenačte, zbytek souboru ano.
  const { redirect } = await import("next/navigation");
  return redirect(user ? homeOf(user.role) : "/login");
}

export const isStaff = (user: CurrentUser) => user.role === "aa";

export const isHelper = (user: CurrentUser) => user.role === "helper";

// Za kterého pacienta uživatel jedná: pacient za sebe, pomocník za toho, kdo ho pozval. AA za nikoho.
export const actingPatientId = (user: CurrentUser): string | null =>
  user.role === "patient" ? user.id : user.role === "helper" ? (user.helping?.patientId ?? null) : null;

// Pacient smí jen své zákroky, pomocník zákroky svého pacienta, AA všechny.
export async function requireCaseAccess(user: CurrentUser, caseId: string): Promise<CaseRecord> {
  const [row] = await getDb().select().from(cases).where(eq(cases.id, caseId));
  if (!row || (!isStaff(user) && row.patientId !== actingPatientId(user))) throw notFound("Zákrok nenalezen.");
  return row;
}

/** Uzavřený (exportovaný) zákrok už nejde upravovat; znovu ho otevře jen ambulance (DELETE /close). */
export function assertCaseOpen(row: CaseRecord) {
  if (row.status === "closed") throw conflict("Zákrok je uzavřený a exportovaný, už ho nejde upravovat.");
}

/** Přístup k zákroku pro zápis: jako requireCaseAccess, navíc nesmí být uzavřený. */
export async function requireOpenCase(user: CurrentUser, caseId: string): Promise<CaseRecord> {
  const row = await requireCaseAccess(user, caseId);
  assertCaseOpen(row);
  return row;
}

// Pacient smí jen sám sebe, pomocník svého pacienta, AA kohokoli.
export function requireSelfOrStaff(user: CurrentUser, userId: string) {
  if (!isStaff(user) && actingPatientId(user) !== userId) throw notFound();
}
