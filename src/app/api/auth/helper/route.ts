import { HttpError, json, readJson, route } from "@/lib/server/http";
import { clientIp, loginSucceeded, registerLoginAttempt, type AttemptKey } from "@/lib/server/rate-limit";
import { acceptInvite, acceptSchema, inviteAttemptKey } from "@/lib/server/services/helpers";
import { createSession, deleteSession, getSessionUser, readSessionToken, setSessionCookie } from "@/lib/server/session";

// POST /api/auth/helper { token, birthDate }: pomocník z rodiny přijme pozvánku datem narození pacienta.
// Datum narození má málo možností, proto stejné omezení zkoušení jako přihlášení (na pozvánku i na IP).
export const POST = route(async (req) => {
  const input = await readJson(req, acceptSchema);
  const account: AttemptKey = { kind: "identifier", value: inviteAttemptKey(input.token) };
  const ip = clientIp(req);
  const keys: AttemptKey[] = ip ? [account, { kind: "ip", value: ip }] : [account];

  const attempts = await registerLoginAttempt(keys);
  const userId = await acceptInvite(input);
  if (!userId) throw new HttpError(401, "Datum narození nesedí. Zkontrolujte ho prosím.");
  await loginSucceeded(attempts, account);

  // Vždy nová session (ochrana proti session fixation), předchozí session z tohoto prohlížeče skončí.
  await deleteSession(readSessionToken(req));
  const { token } = await createSession(userId);
  const res = json(await getSessionUser(token));
  setSessionCookie(res, token);
  return res;
});
