import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, count, eq, gt, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { cases, helpers, patients, sessions, users } from "@/db/schema";
import type { CurrentUser } from "@/lib/server/auth";
import { getDb, type Executor } from "@/lib/server/db";
import { recordEvents } from "@/lib/server/events";
import { conflict, notFound } from "@/lib/server/http";
import { HELPER_RELATIONS, INVITE_DAYS, relationLabel } from "@/lib/helpers";

// Pomocník z rodiny. Pacient pozve (jméno, vztah, výslovný souhlas), dostane jednorázově odkaz s tokenem,
// pomocník ho otevře a ověří se datem narození pacienta. V databázi je jen SHA-256 tokenu.
// Přístup je na úrovni pacienta (všechny jeho zákroky), ukončí ho jen pacient.
// Události jdou do časové osy každého běžícího zákroku pacienta; bez zákroku se nezapíše nic (events potřebují case_id).

const MAX_TOKEN_LENGTH = 64;
// Pojistka proti zaplnění tabulky jedním účtem: kolik platných pozvánek a pomocníků může pacient mít najednou.
export const MAX_ACTIVE_HELPERS = 10;

export const inviteSchema = z.strictObject({
  displayName: z.string().trim().min(1, "Napište jméno.").max(60),
  relation: z.enum(HELPER_RELATIONS),
  consent: z.literal(true, "Bez souhlasu pomocníka pozvat nejde."),
});

export const acceptSchema = z.strictObject({
  token: z.string().min(1).max(MAX_TOKEN_LENGTH),
  birthDate: z.iso.date(),
});

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
// Klíč pro omezení zkoušení data narození: jedna pozvánka = jeden „účet“.
export const inviteAttemptKey = (token: string) => `helper-invite:${hashToken(token)}`;

type HelperRow = typeof helpers.$inferSelect;

function toDto(row: HelperRow) {
  return {
    id: row.id,
    displayName: row.displayName,
    relation: row.relation,
    joinedAt: row.joinedAt,
    inviteExpiresAt: row.inviteExpiresAt,
    createdAt: row.createdAt,
  };
}

// Platí: nezrušený a buď už přijatý, nebo s nevypršenou pozvánkou.
const active = (now: Date) => and(isNull(helpers.revokedAt), or(isNotNull(helpers.joinedAt), gt(helpers.inviteExpiresAt, now)));

async function caseEvents(tx: Executor, patientId: string, event: { actorId: string; type: string; subjectId: string; summary: string; data?: Record<string, unknown> }) {
  const open = await tx.select({ id: cases.id }).from(cases).where(and(eq(cases.patientId, patientId), inArray(cases.status, ["new", "active"])));
  await recordEvents(tx, open.map((c) => ({ caseId: c.id, ...event })));
}

const who = (row: Pick<HelperRow, "displayName" | "relation">) => `${row.displayName} (${relationLabel(row.relation)})`;

export async function listHelpers(patientId: string) {
  const rows = await getDb().select().from(helpers).where(and(eq(helpers.patientId, patientId), active(new Date()))).orderBy(asc(helpers.createdAt));
  return rows.map(toDto);
}

export async function createInvite(actor: CurrentUser, input: z.infer<typeof inviteSchema>) {
  const now = new Date();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + INVITE_DAYS * 24 * 60 * 60 * 1000);
  const row = await getDb().transaction(async (tx) => {
    const [{ total }] = await tx.select({ total: count() }).from(helpers).where(and(eq(helpers.patientId, actor.id), active(now)));
    if (total >= MAX_ACTIVE_HELPERS) throw conflict("Pomocníků je už hodně. Nejdřív některého odeberte.");
    const [created] = await tx
      .insert(helpers)
      .values({ patientId: actor.id, displayName: input.displayName, relation: input.relation, inviteTokenHash: hashToken(token), inviteExpiresAt: expiresAt, consentAt: now, createdBy: actor.id })
      .returning();
    await caseEvents(tx, actor.id, { actorId: actor.id, type: "helper.invited", subjectId: created.id, summary: `Pacient pozval pomocníka: ${who(created)}.` });
    return created;
  });
  return { helper: toDto(row), token, expiresAt };
}

// Pacient ukončí přístup (i nepřijatou pozvánku). Session pomocníka se smažou hned.
export async function revokeHelper(actor: CurrentUser, helperId: string) {
  await getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(helpers)
      .set({ revokedAt: new Date() })
      .where(and(eq(helpers.id, helperId), eq(helpers.patientId, actor.id), isNull(helpers.revokedAt)))
      .returning();
    if (!row) throw notFound("Pomocník nenalezen.");
    if (row.userId) await tx.delete(sessions).where(eq(sessions.userId, row.userId));
    await caseEvents(tx, actor.id, { actorId: actor.id, type: "helper.revoked", subjectId: row.id, summary: `Pacient ukončil přístup pomocníka: ${who(row)}.` });
  });
}

// Platná pozvánka: nezrušená, nevypršená. Vrací i datum narození pacienta, ven z modulu nejde.
async function findValidInvite(token: string) {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const [row] = await getDb()
    .select({ helper: helpers, patientFirstName: users.firstName, birthDate: patients.birthDate })
    .from(helpers)
    .innerJoin(patients, eq(patients.userId, helpers.patientId))
    .innerJoin(users, eq(users.id, helpers.patientId))
    .where(and(eq(helpers.inviteTokenHash, hashToken(token)), isNull(helpers.revokedAt), gt(helpers.inviteExpiresAt, new Date())));
  return row ?? null;
}

// Stránka pozvánky: komu pomoct (jen křestní jméno, odkaz může vidět i někdo cizí) a koho pacient zval.
export async function describeInvite(token: string) {
  const found = await findValidInvite(token);
  if (!found) return null;
  return { patientFirstName: found.patientFirstName, helperName: found.helper.displayName };
}

// Přijetí pozvánky: pomocník zná datum narození pacienta. Při prvním přijetí vznikne jeho účet,
// dokud pozvánka platí, jde jí znovu přihlásit (session vyprší, telefon se vymění). Vrací id účtu, při špatném datu null.
export async function acceptInvite(input: z.infer<typeof acceptSchema>) {
  const found = await findValidInvite(input.token);
  if (!found) throw notFound("Pozvánka už neplatí. Požádejte o novou.");
  if (found.birthDate !== input.birthDate) return null;
  const invite = found.helper;
  if (invite.userId) return invite.userId;
  return getDb().transaction(async (tx) => {
    // Souběžné přijetí stejné pozvánky: řádek se zamkne, druhý požadavek už najde založený účet.
    const [locked] = await tx.select({ userId: helpers.userId }).from(helpers).where(eq(helpers.id, invite.id)).for("update");
    if (locked?.userId) return locked.userId;
    const [user] = await tx
      .insert(users)
      .values({ role: "helper", firstName: invite.displayName, lastName: "", displayName: invite.displayName })
      .returning({ id: users.id });
    await tx.update(helpers).set({ userId: user.id, joinedAt: new Date() }).where(eq(helpers.id, invite.id));
    await caseEvents(tx, invite.patientId, { actorId: user.id, type: "helper.joined", subjectId: invite.id, summary: `Pomocník přijal pozvánku: ${who(invite)}.` });
    return user.id;
  });
}

// Pomocníci pacienta pro ambulanci (hlavička zákroku): jen ti, kdo pozvánku přijali a přístup mají.
export async function listJoinedHelpers(db: Executor, patientId: string) {
  return db
    .select({ id: helpers.id, displayName: helpers.displayName, relation: helpers.relation, joinedAt: helpers.joinedAt })
    .from(helpers)
    .where(and(eq(helpers.patientId, patientId), isNull(helpers.revokedAt), isNotNull(helpers.joinedAt)))
    .orderBy(asc(helpers.joinedAt));
}
