import { defineConfig } from "drizzle-kit";

// drizzle-kit běží mimo Next.js, proto si .env načte sám (když existuje).
try {
  process.loadEnvFile();
} catch {
  // bez .env: DATABASE_URL přijde z prostředí (CI, Azure)
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
