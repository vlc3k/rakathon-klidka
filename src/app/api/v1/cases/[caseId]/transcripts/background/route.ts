import { and, eq, inArray, isNull } from "drizzle-orm";
import { documents } from "@/db/schema";
import { isClientDocumentType } from "@/db/catalog";
import { runAfterResponse } from "@/lib/server/background";
import { getDb } from "@/lib/server/db";
import { badRequest, json, notFound, readIds, readJson, route } from "@/lib/server/http";
import { createTranscriptSchema, readDocument } from "@/lib/server/services/transcripts";
import { requireUploader } from "@/lib/server/uploadLink";

const schema = createTranscriptSchema.omit({ skip: true });

// POST /api/v1/cases/:caseId/transcripts/background { documentIds }: přečte dokument na pozadí a hned vrátí 202.
// Pacient po nahrání fotek nečeká na AI (přepis stránky trvá desítky sekund). Stránky se ověří hned,
// samotné čtení běží po odpovědi; výsledek a chyby uvidí ambulance u dokumentu.
export const POST = route(async (req, ctx: RouteContext<"/api/v1/cases/[caseId]/transcripts/background">) => {
  const { caseId } = await readIds(ctx, "caseId");
  const { user, row } = await requireUploader(req, caseId);
  const { documentIds } = await readJson(req, schema);
  const found = await getDb()
    .select({ id: documents.id, type: documents.type })
    .from(documents)
    .where(and(eq(documents.caseId, row.id), inArray(documents.id, documentIds), isNull(documents.removedAt)));
  if (found.length !== documentIds.length) throw notFound("Stránka nenalezena.");
  if (found.some((doc) => isClientDocumentType(doc.type))) throw badRequest("Neplatné údaje.", [{ path: "documentIds", message: "Mezi stránkami je soubor, který se nečte." }]);
  runAfterResponse("transcripts.read", () => readDocument(user, row, documentIds));
  return json({ status: "reading", documentIds }, { status: 202 });
});
