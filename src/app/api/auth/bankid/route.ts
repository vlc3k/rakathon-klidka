import { NextResponse, type NextRequest } from "next/server";
import { BANKID_COOKIE, start } from "@/lib/server/bankid";
import { bankidConfigured } from "@/lib/server/env";
import { requestOrigin } from "@/lib/server/http";

// GET /api/auth/bankid: začátek přihlášení přes Bank iD. Přesměruje na Bank iD a do krátké cookie uloží
// state, nonce a PKCE verifier, které se po návratu (/api/auth/bankid/callback) ověří.
const PRODUCTION = process.env.NODE_ENV === "production";

export async function GET(req: NextRequest) {
  const origin = requestOrigin(req);
  const back = (reason: string) => NextResponse.redirect(new URL(`/login?bankid=${reason}`, origin));
  if (!bankidConfigured()) return back("nenastaveno");
  try {
    const { url, pending } = await start(origin);
    const res = NextResponse.redirect(url);
    res.cookies.set(BANKID_COOKIE, JSON.stringify(pending), { httpOnly: true, secure: PRODUCTION, sameSite: "lax", path: "/api/auth/bankid", maxAge: 10 * 60 });
    return res;
  } catch (error) {
    console.error("Bank iD: start selhal:", error);
    return back("nedostupne");
  }
}
