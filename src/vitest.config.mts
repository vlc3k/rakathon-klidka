import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: root },
      // Next.js hlídá "server-only" při buildu; v testech je to prázdný modul.
      { find: "server-only", replacement: `${root}tests/support/server-only.ts` },
    ],
  },
  test: {
    environment: "node",
    include: ["db/**/*.test.ts", "lib/server/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: ["tests/support/setup.ts"],
    // Každý testovací soubor má vlastní databázi v paměti (PGlite), proto stačí izolace po souborech.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
