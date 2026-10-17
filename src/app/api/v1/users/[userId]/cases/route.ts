import { requireSelfOrStaff, requireUser } from "@/lib/server/auth";
import { json, readIds, route } from "@/lib/server/http";
import { listUserCases } from "@/lib/server/services/case-views";

// GET /api/v1/users/:userId/cases: zákroky pacienta. Pacient jen své, AA kohokoli.
export const GET = route(async (req, ctx: RouteContext<"/api/v1/users/[userId]/cases">) => {
  const user = await requireUser(req);
  const { userId } = await readIds(ctx, "userId");
  requireSelfOrStaff(user, userId);
  return json(await listUserCases(userId));
});
