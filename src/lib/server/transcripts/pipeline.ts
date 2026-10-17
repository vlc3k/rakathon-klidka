import "server-only";
import { findPage, rectify } from "@/lib/server/transcripts/geometry";
import type { Quad } from "@/lib/server/transcripts/homography";
import { callStructured, type AiStep, type AiUsage } from "@/lib/server/transcripts/model";
import { EXTRACTION_PROMPT, PROMPT_VERSION, TRANSCRIPTION_PROMPT } from "@/lib/server/transcripts/prompts";
import {
  extractionSchema,
  pageTranscriptSchema,
  SCHEMA_VERSION,
  type Extraction,
  type PageTranscript,
  type TranscriptLine,
} from "@/lib/server/transcripts/schema";

// Dva kroky čtení lékařské zprávy:
// 1. transcribePage: fotka jedné stránky → řádky textu s polohou a jistotou (jedno volání na stránku,
//    takže vícestránkový dokument nenarazí na limity velikosti požadavku ani počtu obrázků)
// 2. extractValues: přepis všech stránek → hodnoty s odkazy na řádky (jen text, jedno volání na dokument)

// Jak čtení proběhlo. Ukládá se ke stránce (documents.ai_meta) i k přepisu dokumentu (document_transcripts).
export type AiRunMeta = {
  step: AiStep;
  model: string;
  promptVersion: string;
  schemaVersion: number;
  durationMs: number;
  attempts: number;
  usage: AiUsage | null;
  finishedAt: string;
};

// Limity: fotka do 10 MB (upload), přepis dokumentu do 20 stránek a 150 000 znaků.
export const MAX_PAGES = 20;
export const MAX_TRANSCRIPT_CHARS = 150_000;

const TIMEOUT_MS = 120_000;
const MAX_TOKENS = 16_000;

export async function transcribePage(image: Uint8Array, mimeType: "image/jpeg" | "image/png", context: Record<string, string> = {}) {
  // Natočenou nebo šikmo vyfocenou stránku nejdřív narovnat: AI čte líp a obdélníky řádků sedí na jeden řádek.
  const quad = await findPage(image).catch(() => null);
  if (quad) {
    image = await rectify(image, quad);
    mimeType = "image/jpeg";
  }
  const result = await callStructured({
    step: "transcription",
    schemaName: "prepis_stranky",
    schema: pageTranscriptSchema,
    system: TRANSCRIPTION_PROMPT,
    user: [
      { type: "image_url", image_url: { url: `data:${mimeType};base64,${Buffer.from(image).toString("base64")}`, detail: "high" } },
      { type: "text", text: "Přepiš tuto stránku." },
    ],
    timeoutMs: TIMEOUT_MS,
    maxTokens: MAX_TOKENS,
    context,
  });

  const lines: TranscriptLine[] = result.data.lines
    .map((line) => ({ ...line, text: line.text.trim() }))
    .filter((line) => line.text.length > 0)
    .map((line, i) => ({ id: `l${i + 1}`, text: line.text, box: normalizeBox(line.box), confidence: line.confidence }));

  const transcript: PageTranscript = { legibility: result.data.legibility, lines, ...(quad ? { page: { quad: roundQuad(quad) } } : {}) };
  return { transcript, text: lines.map((line) => line.text).join("\n"), meta: runMeta("transcription", result) };
}

export type TranscriptPage = { documentId: string; pageNumber: number; transcript: PageTranscript };

// Přepis všech stránek pro model: každý řádek s id [p<strana>-l<řádek>], na které hodnoty odkazují.
export function fullTranscript(pages: TranscriptPage[]) {
  return pages
    .map((page) => [`--- Strana ${page.pageNumber} ---`, ...page.transcript.lines.map((line) => `[p${page.pageNumber}-${line.id}] ${line.text}`)].join("\n"))
    .join("\n\n");
}

export async function extractValues(pages: TranscriptPage[], context: Record<string, string> = {}) {
  const transcriptText = fullTranscript(pages);
  const result = await callStructured({
    step: "extraction",
    schemaName: "hodnoty_dokumentu",
    schema: extractionSchema,
    system: EXTRACTION_PROMPT,
    user: [{ type: "text", text: transcriptText }],
    timeoutMs: TIMEOUT_MS,
    maxTokens: MAX_TOKENS,
    context,
  });
  return { extraction: keepKnownLines(result.data, pages), transcriptText, meta: runMeta("extraction", result) };
}

function runMeta(step: AiStep, result: { model: string; durationMs: number; attempts: number; usage: AiUsage | null }): AiRunMeta {
  return {
    step,
    model: result.model,
    promptVersion: PROMPT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    durationMs: result.durationMs,
    attempts: result.attempts,
    usage: result.usage,
    finishedAt: new Date().toISOString(),
  };
}

// Obdélník s prohozenými rohy srovná, nulový zahodí.
function normalizeBox(box: number[] | null): TranscriptLine["box"] {
  if (!box) return null;
  const [x0, y0, x1, y1] = [Math.min(box[0], box[2]), Math.min(box[1], box[3]), Math.max(box[0], box[2]), Math.max(box[1], box[3])];
  return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
}

// Odkazy na řádky, které v přepisu nejsou, zahodí (model je vymyslel nebo přepsal).
function keepKnownLines(extraction: Extraction, pages: TranscriptPage[]): Extraction {
  const known = new Set(pages.flatMap((page) => page.transcript.lines.map((line) => `p${page.pageNumber}-${line.id}`)));
  const clean = (lines: string[]) => [...new Set(lines.filter((id) => known.has(id)))];
  const withLines = <T extends { lines: string[] }>(item: T): T => ({ ...item, lines: clean(item.lines) });
  return {
    ...extraction,
    document: withLines(extraction.document),
    patient: {
      name: extraction.patient.name && withLines(extraction.patient.name),
      birthNumber: extraction.patient.birthNumber && withLines(extraction.patient.birthNumber),
    },
    labs: extraction.labs.map(withLines),
    medications: extraction.medications.map(withLines),
    allergies: { ...withLines(extraction.allergies), items: extraction.allergies.items.map(withLines) },
    conditions: extraction.conditions.map(withLines),
    procedure: extraction.procedure && withLines(extraction.procedure),
    issues: extraction.issues.map(withLines),
  };
}

// Rohy stránky v uloženém přepisu na 4 desetinná místa (0–1).
const roundQuad = (quad: Quad) => quad.map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]) as Quad;
