import "server-only";
import { aliasedTable, and, eq } from "drizzle-orm";
import { documents, information, users } from "@/db/schema";
import { getDb } from "@/lib/server/db";
import type { VerifiedInfo } from "@/lib/fhir/writeBack";

// Ověřené údaje zákroku pro zápis do nemocnice (lib/fhir/writeBack.ts): kdo je ověřil a z jakého dokumentu jsou.
export async function verifiedInformation(caseId: string): Promise<VerifiedInfo[]> {
  const verifier = aliasedTable(users, "verifier");
  const rows = await getDb()
    .select({ row: information, docType: documents.type, issuedDate: documents.issuedDate, verifierName: verifier.displayName })
    .from(information)
    .leftJoin(documents, eq(documents.id, information.documentId))
    .leftJoin(verifier, eq(verifier.id, information.verifiedBy))
    .where(and(eq(information.caseId, caseId), eq(information.status, "verified")));
  return rows.map(({ row, docType, issuedDate, verifierName }) => ({
    id: row.id,
    type: row.type,
    value: row.value,
    observedDate: row.observedDate,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    verifierName,
    document: row.documentId ? { type: docType, issuedDate } : null,
  }));
}
