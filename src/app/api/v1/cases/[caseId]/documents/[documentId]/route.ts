import { requireCaseAccess, requireUser } from "@/lib/server/auth";
import { noContent, readIds, route } from "@/lib/server/http";
import { removeDocument } from "@/lib/server/services/documents";

// DELETE /api/v1/cases/:caseId/documents/:documentId: odebrání omylem nahraného dokumentu, nic se nemaže natvrdo.
// Pacient jen svůj a jen dokud s ním AA nepracovala, AA cokoli.
export const DELETE = route(async (req, ctx: RouteContext<"/api/v1/cases/[caseId]/documents/[documentId]">) => {
  const user = await requireUser(req);
  const { caseId, documentId } = await readIds(ctx, "caseId", "documentId");
  const row = await requireCaseAccess(user, caseId);
  await removeDocument(user, row, documentId);
  return noContent();
});
