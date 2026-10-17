import { NextRequest } from "next/server";
import { describe, expect, test } from "vitest";

// Za Azure App Service: proxy přidává skutečnou IP klienta na konec X-Forwarded-For.
process.env.TRUST_PROXY = "true";
const { clientIp } = await import("@/lib/server/rate-limit");

const req = (forwardedFor: string) => new NextRequest("http://localhost/api/auth/login", { headers: { "x-forwarded-for": forwardedFor } });

describe("IP klienta za proxy", () => {
  test("bere poslední položku, kterou přidala proxy, ne tu, kterou poslal klient", () => {
    expect(clientIp(req("1.2.3.4, 203.0.113.7"))).toBe("203.0.113.7");
  });

  test("odstraní port, který přidává Azure App Service", () => {
    expect(clientIp(req("203.0.113.7:51234"))).toBe("203.0.113.7");
  });
});
