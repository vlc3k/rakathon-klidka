import { HttpError, json, readJson, route } from "@/lib/server/http";
import { clientIp, loginSucceeded, registerLoginAttempt, type AttemptKey } from "@/lib/server/rate-limit";
import { authenticate, credentialsSchema, normalizeIdentifier } from "@/lib/server/services/login";
import { createSession, deleteSession, readSessionToken, setSessionCookie } from "@/lib/server/session";

// POST /api/auth/login: pacient { identifier, birthDate }, lékař { email, password }.
export const POST = route(async (req) => {
  const credentials = await readJson(req, credentialsSchema);
  const account: AttemptKey = { kind: "identifier", value: "identifier" in credentials ? normalizeIdentifier(credentials.identifier) : credentials.email };
  const ip = clientIp(req);
  const keys: AttemptKey[] = ip ? [account, { kind: "ip", value: ip }] : [account];

  const attempts = await registerLoginAttempt(keys);
  const user = await authenticate(credentials);
  // Stejná odpověď pro neznámý účet i špatný údaj, ať nejde zjistit, kdo je v systému.
  if (!user) throw new HttpError(401, "Neplatné přihlašovací údaje.");
  await loginSucceeded(attempts, account);

  // Vždy nová session (ochrana proti session fixation). Předchozí session z tohoto prohlížeče (sdílené zařízení) skončí.
  await deleteSession(readSessionToken(req));
  const { token } = await createSession(user.id);
  const res = json(user);
  setSessionCookie(res, token);
  return res;
});
