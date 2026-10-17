import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Db } from "@/lib/server/db";

// PostgreSQL v paměti (PGlite) se stejnými migracemi jako produkce. Každý testovací soubor má vlastní instanci.
async function createTestDb() {
  const db = drizzle({ client: new PGlite(), schema });
  await migrate(db, { migrationsFolder: "db/migrations" });
  return db;
}

// PGlite a node-postgres mají stejné API dotazů; produkční typ stačí.
export const testDb = (await createTestDb()) as unknown as Db;

const TABLES = ["events", "helpers", "information", "documents", "document_transcripts", "tasks", "cases", "template_tasks", "templates", "sessions", "login_attempts", "patients", "users"];

export async function resetDb() {
  await testDb.execute(sql.raw(`truncate table ${TABLES.join(", ")} restart identity cascade`));
}
