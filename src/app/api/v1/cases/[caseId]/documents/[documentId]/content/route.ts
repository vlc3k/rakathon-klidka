import { requireCaseAccess, requireUser } from "@/lib/server/auth";
import { readIds, route } from "@/lib/server/http";
import { documentContent } from "@/lib/server/services/documents";

// GET /api/v1/cases/:caseId/documents/:documentId/content: originál souboru, jen po ověření přístupu.
export const GET = route(async (req, ctx: RouteContext<"/api/v1/cases/[caseId]/documents/[documentId]/content">) => {
  const user = await requireUser(req);
  const { caseId, documentId } = await readIds(ctx, "caseId", "documentId");
  await requireCaseAccess(user, caseId);
  return documentContent(caseId, documentId);
});
