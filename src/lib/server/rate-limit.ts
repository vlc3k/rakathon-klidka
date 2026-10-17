import "server-only";
import { createHash } from "node:crypto";
import { and, count, eq, gt, inArray, lt, min } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { loginAttempts } from "@/db/schema";
import { getDb } from "@/lib/server/db";
import { authEnv } from "@/lib/server/env";
import { HttpError } from "@/lib/server/http";

// Omezení zkoušení přihlášení. Počítá pokusy v databázi, takže platí i pro víc instancí aplikace.
// Datum narození má jen desítky tisíc možností, v ostrém provozu by bez rozumného limitu šlo uhodnout.
//
// Pokus se zapíše ještě před ověřením údajů a teprve pak se spočítá. Paralelní požadavky se tak navzájem vidí
// a limit nejde obejít souběhem. Úspěšné přihlášení svůj záznam smaže, takže se počítají jen neúspěchy.

const WINDOW_MS = 15 * 60 * 1000;

export type AttemptKey = { kind: "identifier" | "ip"; value: string };

// Limit je zatím záměrně vysoko (LOGIN_MAX_ATTEMPTS, výchozí 1000), před ostrým provozem snížit třeba na 5.
const limitFor = (kind: AttemptKey["kind"]) => (kind === "ip" ? 10 : 1) * authEnv().LOGIN_MAX_ATTEMPTS;

const hashKey = (key: AttemptKey) => createHash("sha256").update(`${key.kind}:${key.value}`).digest("hex");

// Za jednou důvěryhodnou proxy (Azure App Service) je skutečná IP poslední položka X-Forwarded-For.
// Položky před ní poslal klient a může si je vymyslet.
export function clientIp(req: NextRequest): string | null {
  if (!authEnv().TRUST_PROXY) return null;
  const last = req.headers.get("x-forwarded-for")?.split(",").map((part) => part.trim()).filter(Boolean).at(-1);
  if (!last) return null;
  // Azure App Service posílá IPv4 i s portem: 203.0.113.7:51234
  return /^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(last) ? last.slice(0, last.lastIndexOf(":")) : last;
}

export async function registerLoginAttempt(keys: AttemptKey[]): Promise<number[]> {
  const db = getDb();
  const now = Date.now();
  const since = new Date(now - WINDOW_MS);
  const hashes = keys.map(hashKey);
  // Úklid prošlých pokusů všech klíčů: jinak by tabulku šlo nafouknout náhodnými identifikátory.
  await db.delete(loginAttempts).where(lt(loginAttempts.createdAt, since));
  const inserted = await db
    .insert(loginAttempts)
    .values(hashes.map((key) => ({ key, createdAt: new Date(now) })))
    .returning({ id: loginAttempts.id });

  for (const [i, key] of keys.entries()) {
    const [row] = await db
      .select({ attempts: count(), oldest: min(loginAttempts.createdAt) })
      .from(loginAttempts)
      .where(and(eq(loginAttempts.key, hashes[i]), gt(loginAttempts.createdAt, since)));
    if (row && row.attempts > limitFor(key.kind)) {
      // Odmítnutý pokus údaje vůbec nezkoušel, takže se nepočítá a zablokování neprodlouží.
      await db.delete(loginAttempts).where(inArray(loginAttempts.id, inserted.map((r) => r.id)));
      const oldest = row.oldest?.getTime() ?? now;
      const retryAfter = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
      throw new HttpError(429, "Příliš mnoho pokusů o přihlášení. Zkuste to prosím později.", { headers: { "retry-after": String(retryAfter) } });
    }
  }
  return inserted.map((r) => r.id);
}

export async function loginSucceeded(attemptIds: number[], account: AttemptKey) {
  const db = getDb();
  if (attemptIds.length) await db.delete(loginAttempts).where(inArray(loginAttempts.id, attemptIds));
  await db.delete(loginAttempts).where(eq(loginAttempts.key, hashKey(account)));
}
