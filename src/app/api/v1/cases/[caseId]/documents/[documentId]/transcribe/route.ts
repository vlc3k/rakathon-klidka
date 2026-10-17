import { requireOpenCase, requireUser } from "@/lib/server/auth";
import { json, readIds, route } from "@/lib/server/http";
import { toMetadataDto } from "@/lib/server/services/documents";
import { transcribeDocument } from "@/lib/server/services/transcripts";

// POST /api/v1/cases/:caseId/documents/:documentId/transcribe: AI přepíše nahranou stránku (fotka → řádky textu s polohou).
// Už přepsanou stránku nečte znovu. Chyba AI → 502 a stránka failed, jde zopakovat. Vrací metadata, bez textu.
export const POST = route(async (req, ctx: RouteContext<"/api/v1/cases/[caseId]/documents/[documentId]/transcribe">) => {
  const user = await requireUser(req);
  const { caseId, documentId } = await readIds(ctx, "caseId", "documentId");
  const row = await requireOpenCase(user, caseId);
  return json(toMetadataDto(await transcribeDocument(user, row, documentId), user));
});
