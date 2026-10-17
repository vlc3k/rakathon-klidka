import { requireUser } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

// GET /api/auth/session: kdo je přihlášený.
export const GET = route(async (req) => json(await requireUser(req)));
