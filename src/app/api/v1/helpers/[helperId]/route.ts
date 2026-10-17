import { requirePatient } from "@/lib/server/auth";
import { noContent, readIds, route } from "@/lib/server/http";
import { revokeHelper } from "@/lib/server/services/helpers";

// DELETE /api/v1/helpers/:helperId: pacient ukončí přístup pomocníka (i nepřijatou pozvánku). Jen pacient sám.
export const DELETE = route(async (req, ctx: RouteContext<"/api/v1/helpers/[helperId]">) => {
  const patient = await requirePatient(req);
  const { helperId } = await readIds(ctx, "helperId");
  await revokeHelper(patient, helperId);
  return noContent();
});
