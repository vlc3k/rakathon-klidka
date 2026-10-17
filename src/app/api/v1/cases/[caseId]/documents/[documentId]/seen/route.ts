import { requireCaseAccess, requireStaff } from "@/lib/server/auth";
import { noContent, readIds, route } from "@/lib/server/http";
import { markDocumentSeen } from "@/lib/server/services/documents";

// POST /api/v1/cases/:caseId/documents/:documentId/seen: zaměstnanec otevřel dokument. Zapíše se jen první otevření. Jen AA.
export const POST = route(async (req, ctx: RouteContext<"/api/v1/cases/[caseId]/documents/[documentId]/seen">) => {
  const actor = await requireStaff(req);
  const { caseId, documentId } = await readIds(ctx, "caseId", "documentId");
  await requireCaseAccess(actor, caseId);
  await markDocumentSeen(actor, caseId, documentId);
  return noContent();
});
