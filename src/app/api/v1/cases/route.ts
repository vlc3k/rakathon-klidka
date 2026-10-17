import { requireStaff } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { json, readJson, readQuery, route } from "@/lib/server/http";
import { createCase, createCaseSchema, getCaseDto, listCases, listCasesSchema } from "@/lib/server/services/cases";

// GET /api/v1/cases?from=&to=&status=&q=: správa zákroků. Zrušené jen s ?status=cancelled.
export const GET = route(async (req) => {
  await requireStaff(req);
  return json(await listCases(readQuery(req, listCasesSchema)));
});

// POST /api/v1/cases: nový zákrok, se šablonou i úkoly z ní.
export const POST = route(async (req) => {
  const actor = await requireStaff(req);
  const input = await readJson(req, createCaseSchema);
  const caseId = await getDb().transaction((tx) => createCase(tx, actor, input));
  return json(await getCaseDto(caseId), { status: 201 });
});
