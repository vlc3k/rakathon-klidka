import { afterEach, describe, expect, test, vi } from "vitest";
import { createUploadLink, readUploadLink } from "@/lib/server/uploadLink";

const CASE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

describe("odkaz z QR pro „Vyfotit telefonem“", () => {
  afterEach(() => vi.useRealTimers());

  test("platný odkaz nese zákrok, uživatele a úkol", () => {
    const { token } = createUploadLink(CASE, USER, null);
    expect(readUploadLink(token)).toMatchObject({ caseId: CASE, userId: USER, taskId: null });
  });

  test("podvržený obsah nebo podpis neprojde", () => {
    const { token } = createUploadLink(CASE, USER, null);
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ caseId: "jiny-zakrok", userId: USER, taskId: null, issuedAt: Date.now(), expiresAt: Date.now() + 60_000 })).toString("base64url");
    expect(readUploadLink(`${forged}.${signature}`)).toBeNull();
    expect(readUploadLink(`${payload}.${signature.slice(0, -2)}xx`)).toBeNull();
    expect(readUploadLink("nesmysl")).toBeNull();
    expect(readUploadLink(null)).toBeNull();
  });

  test("po 15 minutách vyprší", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T10:00:00Z"));
    const { token } = createUploadLink(CASE, USER, null);
    vi.setSystemTime(new Date("2026-10-17T10:14:00Z"));
    expect(readUploadLink(token)).not.toBeNull();
    vi.setSystemTime(new Date("2026-10-17T10:16:00Z"));
    expect(readUploadLink(token)).toBeNull();
  });
});
