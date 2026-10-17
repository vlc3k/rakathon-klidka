import type { CaseDocument, CaseFact, FactKind } from "./types";

/**
 * Tvar výsledku z doc-intake (`ExtractionResult`). Kopie jen potřebných polí,
 * ať balíčky nejsou na sobě závislé – TypeScript to kontroluje strukturálně.
 */
export interface ExtractionLike {
  documentType: string;
  documentDate: string | null;
  facts: {
    key: string;
    label: string;
    value: string | number | null;
    unit: string | null;
    date: string | null;
    dateKind: "collection" | "document" | "unknown";
    confidence: number;
    quote: string;
    page: number;
  }[];
  model: string;
  extractedAt: string;
}

const KIND_BY_KEY: Record<string, FactKind> = {
  diagnosis: "diagnosis",
  medication: "medication",
  allergy: "allergy",
};

function kindOf(f: ExtractionLike["facts"][number]): FactKind {
  // údaj s jednotkou bereme jako laboratoř (Hb, kreatinin…)
  return KIND_BY_KEY[f.key] ?? (f.unit ? "lab" : "other");
}

/**
 * Výsledek extrakce jednoho dokumentu → údaje (stav „AI extrahováno“) + dokument.
 * `documentId` je id, pod kterým má dokument uložený hlavní aplikace.
 */
export function fromExtraction(
  result: ExtractionLike,
  doc: Omit<CaseDocument, "documentType" | "date"> & { id: string },
): { document: CaseDocument; facts: CaseFact[] } {
  const document: CaseDocument = { ...doc, documentType: result.documentType, date: result.documentDate };
  const facts = result.facts.map(
    (f, i): CaseFact => ({
      id: `${doc.id}-${i + 1}`,
      kind: kindOf(f),
      key: f.key,
      label: f.label,
      value: f.value,
      unit: f.unit,
      date: f.date,
      dateKind: f.dateKind,
      verification: "ai_extracted",
      source: {
        author: "ai",
        authorName: result.model,
        recordedAt: result.extractedAt,
        method: "document_extraction",
        documentId: doc.id,
        quote: f.quote,
        page: f.page,
        confidence: f.confidence,
      },
    }),
  );
  return { document, facts };
}
