import { requireStaff } from "@/lib/server/auth";
import { json, readIds, readJson, route } from "@/lib/server/http";
import { getTemplate, putTemplateSchema, replaceTemplate } from "@/lib/server/services/templates";

// GET /api/v1/templates/:templateId: šablona s úkoly.
export const GET = route(async (req, ctx: RouteContext<"/api/v1/templates/[templateId]">) => {
  await requireStaff(req);
  const { templateId } = await readIds(ctx, "templateId");
  return json(await getTemplate(templateId));
});

// PUT /api/v1/templates/:templateId: celá šablona najednou. Mazání = isActive: false.
export const PUT = route(async (req, ctx: RouteContext<"/api/v1/templates/[templateId]">) => {
  await requireStaff(req);
  const { templateId } = await readIds(ctx, "templateId");
  return json(await replaceTemplate(templateId, await readJson(req, putTemplateSchema)));
});
