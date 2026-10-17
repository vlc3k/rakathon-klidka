import { and, eq, gte, isNull } from "drizzle-orm";
import { z } from "zod";
import { documents } from "@/db/schema";
import { isClientDocumentType } from "@/db/catalog";
import { requireCaseAccess, requireOpenCase, requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { forbidden, json, readIds, readJson, route } from "@/lib/server/http";
import { createUploadLink, readUploadLink } from "@/lib/server/uploadLink";

// „Vyfotit telefonem“ (počítač bez kamery):
// POST { taskId? } vytvoří odkaz pro QR kód, platný 15 minut jen na nahrávání k tomuto zákroku. Pacient nebo AA.
// GET ?token= stav pro počítač: kolik stránek z telefonu od vytvoření odkazu dorazilo a kolik se ještě čte.
// Adresa v QR musí jít otevřít z telefonu: PUBLIC_APP_URL, jinak adresa, na kterou přišel požadavek (tunel, nasazení).
type Ctx = RouteContext<"/api/v1/cases/[caseId]/upload-link">;

const bodySchema = z.strictObject({ taskId: z.uuid().optional() });

export const POST = route(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  if (user.role === "helper") throw forbidden("Pomocník fotí rovnou svým telefonem.");
  const { caseId } = await readIds(ctx, "caseId");
  await requireOpenCase(user, caseId);
  const { taskId } = await readJson(req, bodySchema);
  const { token, link } = createUploadLink(caseId, user.id, taskId ?? null);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const base = (process.env.PUBLIC_APP_URL || (host ? `${proto}://${host}` : req.nextUrl.origin)).replace(/\/$/, "");
  return json({ token, url: `${base}/phone/${token}`, expiresAt: new Date(link.expiresAt).toISOString() }, { status: 201 });
});

export const GET = route(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const { caseId } = await readIds(ctx, "caseId");
  await requireCaseAccess(user, caseId);
  const link = readUploadLink(req.nextUrl.searchParams.get("token"));
  if (!link || link.caseId !== caseId || link.userId !== user.id) return json({ expired: true, received: 0, reading: 0 });
  const rows = await getDb()
    .select({ type: documents.type, status: documents.status, transcriptId: documents.transcriptId })
    .from(documents)
    .where(and(eq(documents.caseId, caseId), eq(documents.uploadedBy, user.id), gte(documents.uploadedAt, new Date(link.issuedAt)), isNull(documents.removedAt)));
  const pages = rows.filter((row) => !isClientDocumentType(row.type));
  return json({ expired: false, received: pages.length, reading: pages.filter((row) => !row.transcriptId && row.status !== "failed").length });
});
