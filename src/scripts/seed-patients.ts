// Zapíše demo pacienty (scripts/data/demo.json) do databáze jako uživatele s rolí pacient, aby se mohli přihlásit:
// identifikátorem z nemocnice + datem narození (POST /api/auth/login), nebo přes Bank iD (rodné číslo + datum narození).
// Idempotentní: pacienta pozná podle identifikátoru nebo rodného čísla a jen aktualizuje jméno, RČ a datum narození.
//
//   npx tsx --tsconfig tsconfig.json scripts/seed-patients.ts      (DATABASE_URL z .env)
import { eq, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import demo from "./data/demo.json";
import { patients, users } from "../db/schema";

try {
  process.loadEnvFile();
} catch {
  // bez .env: DATABASE_URL z prostředí
}
if (!process.env.DATABASE_URL) {
  console.error("Chybí DATABASE_URL (.env nebo prostředí).");
  process.exit(1);
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle({ client: pool });
  try {
    // stejný člověk může mít víc zákroků (případů), do databáze patří jednou
    const people = [...new Map(demo.cases.map((c) => [c.birth_number, c])).values()];
    for (const c of people) {
      const birthNumber = c.birth_number.replace(/\D/g, "");
      const values = { firstName: c.first_name, lastName: c.last_name, displayName: c.patient_name };
      const [existing] = await db
        .select({ userId: patients.userId })
        .from(patients)
        .where(or(eq(patients.externalId, c.external_id), eq(patients.birthNumber, birthNumber)));
      await db.transaction(async (tx) => {
        let userId = existing?.userId;
        if (userId) await tx.update(users).set(values).where(eq(users.id, userId));
        else [{ id: userId }] = await tx.insert(users).values({ role: "patient", ...values }).returning({ id: users.id });
        const row = { externalId: c.external_id, birthNumber, birthDate: c.birth_date, sex: c.sex };
        if (existing) await tx.update(patients).set(row).where(eq(patients.userId, userId!));
        else await tx.insert(patients).values({ userId: userId!, ...row });
      });
      console.log(`${existing ? "aktualizován" : "založen"}: ${c.patient_name}, ${c.external_id}, nar. ${c.birth_date}, RČ ${c.birth_number}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Zápis pacientů selhal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
