import { NextResponse, type NextRequest } from "next/server";
import { BANKID_COOKIE, BankidError, finish, type BankidPending } from "@/lib/server/bankid";
import { requestOrigin } from "@/lib/server/http";
import { authenticateBankid } from "@/lib/server/services/login";
import { createSession, deleteSession, readSessionToken, setSessionCookie } from "@/lib/server/session";

// GET /api/auth/bankid/callback: návrat z Bank iD. Ověří state, vymění kód za údaje o člověku, podle rodného čísla
// a data narození najde pacienta a založí stejnou session jako běžné přihlášení (POST /api/auth/login).
export async function GET(req: NextRequest) {
  const origin = requestOrigin(req);
  const back = (reason: string) => {
    const res = NextResponse.redirect(new URL(`/login?bankid=${reason}`, origin));
    res.cookies.set(BANKID_COOKIE, "", { path: "/api/auth/bankid", maxAge: 0 });
    return res;
  };

  let pending: BankidPending;
  try {
    pending = JSON.parse(req.cookies.get(BANKID_COOKIE)?.value ?? "");
  } catch {
    return back("vyprselo");
  }

  try {
    const person = await finish(req.nextUrl.searchParams, pending);
    const user = await authenticateBankid(person);
    if (!user) {
      // Jen při vývoji (sandbox, testovací osoby): koho Bank iD ověřilo, ať jde přiřadit k pacientovi. V produkci nic.
      if (process.env.NODE_ENV !== "production")
        console.log(`[bankid] ověřeno, ale pacient nenalezen: ${person.givenName} ${person.familyName}, nar. ${person.birthDate}, RČ ${person.birthNumber}`);
      return back("nenalezen");
    }

    // Vždy nová session (ochrana proti session fixation), stejně jako u běžného přihlášení.
    await deleteSession(readSessionToken(req));
    const { token } = await createSession(user.id);
    const res = NextResponse.redirect(new URL(user.role === "patient" ? "/patient" : "/staff", origin));
    setSessionCookie(res, token);
    res.cookies.set(BANKID_COOKIE, "", { path: "/api/auth/bankid", maxAge: 0 });
    return res;
  } catch (error) {
    if (error instanceof BankidError) return back(error.message.includes("zrušeno") ? "zruseno" : "neplatne");
    console.error("Bank iD: návrat selhal:", error);
    return back("nedostupne");
  }
}
