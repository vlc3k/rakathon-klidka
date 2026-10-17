import { requireStaff } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { getQueue } from "@/lib/server/services/queue";

// GET /api/v1/queue: fronta pacientů a čísla nahoře (Pozor, Nové, Předem).
export const GET = route(async (req) => {
  await requireStaff(req);
  return json(await getQueue());
});
