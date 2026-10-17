import { afterEach, beforeEach, vi } from "vitest";

// Prostředí jako v .env, jen s testovacími hodnotami.
process.env.DATABASE_URL = "postgres://test@localhost/test";
process.env.STAFF_PASSWORD = "test-staff-password-1234";
process.env.SESSION_TTL_HOURS = "12";
process.env.LOGIN_MAX_ATTEMPTS = "5"; // v provozu je limit zatím hodně vysoko; testy ověřují, že mechanismus funguje

// Infrastruktura se v testech nahradí: PostgreSQL v paměti a úložiště souborů v paměti. Zbytek kódu je skutečný.
vi.mock("@/lib/server/db", async () => {
  const { testDb } = await import("./db");
  return { getDb: () => testDb };
});
vi.mock("@/lib/server/blob", async () => {
  const { memoryBlobStore } = await import("./blob");
  return { getBlobStore: () => memoryBlobStore };
});

beforeEach(async () => {
  const [{ resetDb }, { memoryBlobStore }] = await Promise.all([import("./db"), import("./blob")]);
  await resetDb();
  memoryBlobStore.blobs.clear();
});

afterEach(() => {
  vi.useRealTimers();
});
