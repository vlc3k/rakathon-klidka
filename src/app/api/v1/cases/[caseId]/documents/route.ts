import { json, readIds, readMultipart, route } from "@/lib/server/http";
import { MAX_UPLOAD_REQUEST_BYTES, toMetadataDto, uploadDocument } from "@/lib/server/services/documents";
import { requireUploader } from "@/lib/server/uploadLink";

// POST /api/v1/cases/:caseId/documents: multipart file (+ type, taskId, meta). Stejný soubor podruhé vrátí 200 s existujícím.
// Smí i telefon s odkazem z QR („Vyfotit telefonem“, lib/server/uploadLink.ts).
export const POST = route(async (req, ctx: RouteContext<"/api/v1/cases/[caseId]/documents">) => {
  const { caseId } = await readIds(ctx, "caseId");
  const { user, row } = await requireUploader(req, caseId);
  const { created, document } = await uploadDocument(user, row, await readMultipart(req, MAX_UPLOAD_REQUEST_BYTES));
  return json(toMetadataDto(document, user), { status: created ? 201 : 200 });
});
