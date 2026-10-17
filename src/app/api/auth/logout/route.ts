import { noContent, route } from "@/lib/server/http";
import { clearSessionCookie, deleteSession, readSessionToken } from "@/lib/server/session";

// POST /api/auth/logout: smaže session na serveru i cookie. Bez session nic nedělá (idempotentní).
export const POST = route(async (req) => {
  await deleteSession(readSessionToken(req));
  const res = noContent();
  clearSessionCookie(res);
  return res;
});
