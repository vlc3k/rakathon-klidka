import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { users } from "@/db/schema";
import { assertCaseOpen, requireCaseAccess, requireUser, type CaseRecord, type CurrentUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { forbidden } from "@/lib/server/http";

// Odkaz z QR kódu pro „Vyfotit telefonem“: počítač bez kamery ukáže QR, telefon ho naskenuje a nahraje dokument
// k zákroku bez přihlašování. Odkaz je podepsaný (HMAC), platí 15 minut a jen na nahrávání k jednomu zákroku
// (nahrání stránky, čtení, přeskočení čtení), nic z dokumentace se přes něj nezobrazí. Nahrává se jménem toho,
// kdo QR vytvořil. Bez tabulky v databázi: klíč je UPLOAD_LINK_SECRET, bez něj náhodný klíč běžícího serveru
// (odkazy pak přestanou platit po restartu; při víc instancích je potřeba sdílený klíč).

export const UPLOAD_LINK_HEADER = "x-upload-link";
const TTL_MS = 15 * 60 * 1000;

const globalForKey = globalThis as typeof globalThis & { uploadLinkKey?: Buffer };
function key() {
  const secret = process.env.UPLOAD_LINK_SECRET;
  if (secret) return Buffer.from(secret);
  globalForKey.uploadLinkKey ??= randomBytes(32);
  return globalForKey.uploadLinkKey;
}

export type UploadLink = { caseId: string; userId: string; taskId: string | null; issuedAt: number; expiresAt: number };

const sign = (payload: string) => createHmac("sha256", key()).update(payload).digest("base64url");

export function createUploadLink(caseId: string, userId: string, taskId: string | null): { token: string; link: UploadLink } {
  const issuedAt = Date.now();
  const link: UploadLink = { caseId, userId, taskId, issuedAt, expiresAt: issuedAt + TTL_MS };
  const payload = Buffer.from(JSON.stringify(link)).toString("base64url");
  return { token: `${payload}.${sign(payload)}`, link };
}

/** Platný a nevypršelý odkaz, jinak null. */
export function readUploadLink(token: string | null | undefined): UploadLink | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const link = JSON.parse(Buffer.from(payload, "base64url").toString()) as UploadLink;
    return link.expiresAt > Date.now() ? link : null;
  } catch {
    return null;
  }
}

/**
 * Kdo nahrává do zákroku: přihlášený uživatel, nebo telefon s odkazem z QR (hlavička x-upload-link)
 * pro přesně tenhle zákrok. Jen pro nahrávací endpointy.
 */
export async function requireUploader(req: NextRequest, caseId: string): Promise<{ user: CurrentUser; row: CaseRecord }> {
  const token = req.headers.get(UPLOAD_LINK_HEADER);
  if (!token) {
    const user = await requireUser(req);
    const row = await requireCaseAccess(user, caseId);
    assertCaseOpen(row);
    return { user, row };
  }
  const link = readUploadLink(token);
  if (!link || link.caseId !== caseId) throw forbidden("Odkaz z QR kódu vypršel. Na počítači si zobrazte nový.");
  const [user] = await getDb()
    .select({ id: users.id, role: users.role, firstName: users.firstName, lastName: users.lastName, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, link.userId));
  if (!user) throw forbidden("Odkaz z QR kódu už neplatí.");
  const row = await requireCaseAccess(user, caseId);
  assertCaseOpen(row);
  return { user, row };
}
