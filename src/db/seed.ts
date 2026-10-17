import { sql } from "drizzle-orm";
import { users } from "@/db/schema";
import type { Db } from "@/lib/server/db";

// Produkční seed: admin z AA, ať se dá do prázdné databáze přihlásit (heslo je společné STAFF_PASSWORD).
// Jde spouštět opakovaně, existujícího admina nechá být.
export async function seedAdmin(db: Db, email: string) {
  const normalized = email.trim().toLowerCase();
  const [inserted] = await db
    .insert(users)
    .values({ role: "aa", firstName: "Admin", lastName: "Admin", displayName: "Admin", email: normalized })
    .onConflictDoNothing()
    .returning({ id: users.id });
  if (inserted) return { id: inserted.id, created: true };

  const [existing] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(sql`lower(${users.email}) = ${normalized}`);
  if (!existing || existing.role !== "aa") throw new Error(`Uživatel ${normalized} už existuje, ale není z AA.`);
  return { id: existing.id, created: false };
}
