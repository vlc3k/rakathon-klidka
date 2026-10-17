import { requireStaff } from "@/lib/server/auth";
import { json, readJson, readQuery, route } from "@/lib/server/http";
import { createTemplate, createTemplateSchema, listTemplates, listTemplatesSchema } from "@/lib/server/services/templates";

// GET /api/v1/templates?includeInactive=true: seznam šablon (administrace i výběr ve formuláři zákroku).
export const GET = route(async (req) => {
  await requireStaff(req);
  return json(await listTemplates(readQuery(req, listTemplatesSchema)));
});

// POST /api/v1/templates: nová šablona, případně kopie existující (copyFromId).
export const POST = route(async (req) => {
  const actor = await requireStaff(req);
  return json(await createTemplate(actor, await readJson(req, createTemplateSchema)), { status: 201 });
});
