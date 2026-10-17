import "server-only";
import { and, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { events, helpers, users } from "@/db/schema";
import { getDb } from "@/lib/server/db";

// Časová osa zákroku pro AA, od nejnovějšího. Stránkuje se přes ?before=<id poslední události>.

export const listEventsSchema = z.strictObject({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function listEvents(caseId: string, { before, limit }: z.infer<typeof listEventsSchema>) {
  const rows = await getDb()
    .select({ event: events, actorId: users.id, actorName: users.displayName, actorRole: users.role, actorRelation: helpers.relation })
    .from(events)
    .leftJoin(users, eq(users.id, events.actorId))
    // Pomocník z rodiny: vztah k pacientovi, ať je v ose „Petra (dcera)“, ne jen jméno.
    .leftJoin(helpers, eq(helpers.userId, users.id))
    .where(and(eq(events.caseId, caseId), before ? lt(events.id, before) : undefined))
    .orderBy(desc(events.id))
    .limit(limit);
  return rows.map(({ event, actorId, actorName, actorRole, actorRelation }) => ({
    id: event.id,
    type: event.type,
    subjectId: event.subjectId,
    summary: event.summary,
    data: event.data,
    actor: actorId ? { id: actorId, displayName: actorName!, role: actorRole!, ...(actorRelation ? { relation: actorRelation } : {}) } : null,
    createdAt: event.createdAt,
  }));
}
