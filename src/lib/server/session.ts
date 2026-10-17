import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import type { NextRequest, NextResponse } from "next/server";
import { helpers, sessions, users } from "@/db/schema";
import { getDb } from "@/lib/server/db";
import { authEnv } from "@/lib/server/env";

// Session v databázi: v cookie je jen náhodný token (256 bitů), v tabulce sessions jeho SHA-256.
// Proti bezstavovému JWT jde session okamžitě zrušit (odhlášení, kompromitace) a únik databáze ji nevydá.
// Prefix __Host- vynutí Secure, Path=/ a zakáže Domain; na http://localhost v dev režimu nejde, proto jen v produkci.

const PRODUCTION = process.env.NODE_ENV === "production";
export const SESSION_COOKIE = PRODUCTION ? "__Host-aa_session" : "aa_session";
const MAX_TOKEN_LENGTH = 64;

export type SessionUser = {
  id: string;
  role: "patient" | "aa" | "helper";
  firstName: string;
  lastName: string;
  displayName: string;
  /** jen pomocník z rodiny: komu pomáhá */
  helping?: { helperId: string; patientId: string; patientName: string };
};

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const ttlSeconds = () => authEnv().SESSION_TTL_HOURS * 60 * 60;

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlSeconds() * 1000);
  const db = getDb();
  // Úklid prošlých session téhož uživatele, ať tabulka neroste.
  await db.delete(sessions).where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, new Date())));
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function getSessionUser(token: string | undefined): Promise<SessionUser | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const [row] = await getDb()
    .select({ id: users.id, role: users.role, firstName: users.firstName, lastName: users.lastName, displayName: users.displayName })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())));
  if (!row) return null;
  if (row.role !== "helper") return row;
  // Pomocník platí jen s nezrušeným přístupem k pacientovi. Ukončení přístupu tak zastaví i session, kterou by úklid minul.
  const helping = await helperAccess(row.id);
  return helping ? { ...row, helping } : null;
}

async function helperAccess(userId: string) {
  const [row] = await getDb()
    .select({ helperId: helpers.id, patientId: helpers.patientId, patientName: users.displayName })
    .from(helpers)
    .innerJoin(users, eq(users.id, helpers.patientId))
    .where(and(eq(helpers.userId, userId), isNull(helpers.revokedAt)));
  return row ?? null;
}

export async function deleteSession(token: string | undefined) {
  if (!token || token.length > MAX_TOKEN_LENGTH) return;
  await getDb().delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export function readSessionToken(req: NextRequest) {
  return req.cookies.get(SESSION_COOKIE)?.value;
}

const cookieOptions = { httpOnly: true, secure: PRODUCTION, sameSite: "lax", path: "/" } as const;

export function setSessionCookie(res: NextResponse, token: string) {
  res.cookies.set(SESSION_COOKIE, token, { ...cookieOptions, maxAge: ttlSeconds() });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", { ...cookieOptions, maxAge: 0 });
}
