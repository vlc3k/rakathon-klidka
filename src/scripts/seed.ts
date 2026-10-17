// Seed produkčních dat podle .env: admin z AA (SEED_ADMIN_EMAIL), přihlásí se heslem STAFF_PASSWORD.
// npm run db:seed   (po npm run db:migrate; opakované spuštění nic nezdvojí)

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../db/schema";
import { seedAdmin } from "../db/seed";

try {
  process.loadEnvFile();
} catch {
  // bez .env: proměnné z prostředí
}

const { DATABASE_URL, SEED_ADMIN_EMAIL, STAFF_PASSWORD } = process.env;
if (!DATABASE_URL || !SEED_ADMIN_EMAIL) {
  console.error("Chybí DATABASE_URL nebo SEED_ADMIN_EMAIL (.env nebo prostředí).");
  process.exit(1);
}
if (!STAFF_PASSWORD) console.warn("STAFF_PASSWORD není nastavené, admin se zatím nepřihlásí.");

async function main(url: string, email: string) {
  const pool = new Pool({ connectionString: url });
  try {
    const admin = await seedAdmin(drizzle({ client: pool, schema }), email);
    console.log(admin.created ? `Založeno: ${email} (${admin.id})` : `Už existuje: ${email} (${admin.id})`);
  } catch (error) {
    console.error(`Seed se nepovedl: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main(DATABASE_URL, SEED_ADMIN_EMAIL);
