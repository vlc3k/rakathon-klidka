import { requireCaseAccess, requireUser } from "@/lib/server/auth";
import { json, readIds, route } from "@/lib/server/http";
import { findDocument, toMetadataDto } from "@/lib/server/services/documents";

// GET /api/v1/cases/:caseId/documents/:documentId/metadata: stav a údaje dokumentu, bez vyčtených hodnot.
export const GET = route(async (req, ctx: RouteContext<"/api/v1/cases/[caseId]/documents/[documentId]/metadata">) => {
  const user = await requireUser(req);
  const { caseId, documentId } = await readIds(ctx, "caseId", "documentId");
  await requireCaseAccess(user, caseId);
  return json(toMetadataDto(await findDocument(caseId, documentId), user));
});
