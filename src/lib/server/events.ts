import "server-only";
import { events } from "@/db/schema";
import type { Executor } from "@/lib/server/db";

// Časová osa a audit zákroku. Zapisuje se ve stejné transakci jako změna, kterou popisuje.
// Do summary ani data nepatří rodné číslo ani hodnoty, které pacient nevidí.

export type EventInput = {
  caseId: string;
  actorId: string | null; // null = systém (pravidla, AI)
  type: string;
  subjectId?: string | null;
  summary: string;
  data?: Record<string, unknown>;
};

export async function recordEvents(tx: Executor, inputs: EventInput[]) {
  if (inputs.length === 0) return;
  await tx.insert(events).values(inputs.map((e) => ({ caseId: e.caseId, actorId: e.actorId, type: e.type, subjectId: e.subjectId ?? null, summary: e.summary, data: e.data ?? {} })));
}

export const recordEvent = (tx: Executor, input: EventInput) => recordEvents(tx, [input]);
