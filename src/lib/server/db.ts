import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { databaseEnv } from "@/lib/server/env";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Executor = Db | Tx;

// Jeden pool na proces. V dev režimu přežije hot reload přes globalThis, jinak by každá změna kódu otevřela nová spojení.
const globalForDb = globalThis as typeof globalThis & { smartOncoDb?: Db };

export function getDb(): Db {
  if (!globalForDb.smartOncoDb) {
    const pool = new Pool({
      connectionString: databaseEnv().DATABASE_URL, // TLS přes sslmode=verify-full v URL
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 15_000, // dlouhý dotaz nezablokuje spojení napořád
      application_name: "smart-onco-aa",
    });
    // Chyba nečinného spojení (restart serveru, výpadek sítě) nesmí shodit proces. Pool spojení nahradí.
    pool.on("error", (error) => console.error("PostgreSQL: chyba nečinného spojení:", error.message));
    globalForDb.smartOncoDb = drizzle({ client: pool, schema });
  }
  return globalForDb.smartOncoDb;
}
