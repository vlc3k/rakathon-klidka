// Založí člověka z AA, dokud není správa uživatelů v API.
// npm run staff:create -- --email eva.mala@vfn.cz --first Eva --last Malá [--display "MUDr. Eva Malá"] [--phone "+420 224 000 000"]
// Přihlásí se e-mailem a společným heslem STAFF_PASSWORD.

import { parseArgs } from "node:util";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { users } from "../db/schema";

try {
  process.loadEnvFile();
} catch {
  // bez .env: DATABASE_URL z prostředí
}

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    first: { type: "string" },
    last: { type: "string" },
    display: { type: "string" },
    phone: { type: "string" },
  },
});

if (!values.email || !values.first || !values.last) {
  console.error('Použití: npm run staff:create -- --email <e-mail> --first <jméno> --last <příjmení> [--display "MUDr. …"] [--phone "+420 …"]');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("Chybí DATABASE_URL (.env nebo prostředí).");
  process.exit(1);
}

async function main(input: { email: string; first: string; last: string; display?: string; phone?: string }) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const [user] = await drizzle({ client: pool })
      .insert(users)
      .values({
        role: "aa",
        firstName: input.first,
        lastName: input.last,
        displayName: input.display ?? `${input.first} ${input.last}`,
        email: input.email.trim().toLowerCase(),
        phone: input.phone ?? null,
      })
      .returning({ id: users.id });
    console.log(`Založeno: ${input.email} (${user.id})`);
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    console.error(code === "23505" ? "Uživatel s tímto e-mailem už existuje." : `Nepodařilo se založit: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main({ email: values.email, first: values.first, last: values.last, display: values.display, phone: values.phone });
