// Vyzkouší čtení dokumentu naostro proti modelu (klíč z .env.local), bez databáze.
// Jen se syntetickými dokumenty (lib/data/demo-docs), skutečné fotky pacientů sem nepatří.
//
//   npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/transcript-try.ts lib/data/demo-docs/d-case-04-b.jpg [další strany…]
import { readFileSync } from "node:fs";
import { extractValues, transcribePage, type TranscriptPage } from "@/lib/server/transcripts/pipeline";
import { toInformation } from "@/lib/server/transcripts/map";

try {
  process.loadEnvFile(".env.local");
} catch {
  // klíč může přijít z prostředí
}

async function main(files: string[]) {
  const pages: TranscriptPage[] = [];
  for (const [i, file] of files.entries()) {
    const mime = file.endsWith(".png") ? "image/png" : "image/jpeg";
    const { transcript, meta } = await transcribePage(new Uint8Array(readFileSync(file)), mime, { file });
    pages.push({ documentId: `strana-${i + 1}`, pageNumber: i + 1, transcript });
    const low = transcript.lines.filter((line) => line.confidence < 70).length;
    console.log(`Strana ${i + 1}: ${transcript.lines.length} řádků, čitelnost ${transcript.legibility}, pod 70 % jistoty ${low}, ${meta.model}, ${meta.durationMs} ms, pokusů ${meta.attempts}`);
  }

  const { extraction, meta } = await extractValues(pages);
  console.log(`\nHodnoty: ${meta.model}, ${meta.durationMs} ms, pokusů ${meta.attempts}, tokeny ${JSON.stringify(meta.usage)}`);
  console.log(`Dokument: ${extraction.document.type}, vystaven ${extraction.document.issuedDate ?? "?"}`);
  for (const lab of extraction.labs) {
    console.log(`  ${lab.type.padEnd(12)} ${lab.name}: ${lab.valueText} ${lab.unit ?? ""} (${lab.refLow ?? "?"}–${lab.refHigh ?? "?"}) ${lab.flag ?? ""} odběr ${lab.observedDate ?? lab.dateKind}, jistota ${lab.confidence}, řádky ${lab.lines.join(",")}`);
  }
  console.log(`Léky ${extraction.medications.length}, alergie ${extraction.allergies.status} (${extraction.allergies.items.length}), onemocnění ${extraction.conditions.length}, problémy ${extraction.issues.map((i) => i.code).join(", ") || "žádné"}`);

  const { rows, skipped } = toInformation(extraction, pages);
  console.log(`\nDo databáze: ${rows.length} informací (${[...new Set(rows.map((r) => r.type))].join(", ")}), vynecháno ${skipped.length}`);
  for (const s of skipped) console.log(`  vynecháno: ${s.what} (${s.reason})`);
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Zadejte cestu k fotce stránky (JPEG nebo PNG).");
  process.exit(1);
}
main(files).catch((error) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exit(1);
});
