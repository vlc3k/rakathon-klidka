import "server-only";
import type { z } from "zod";
import { aiEnv } from "@/lib/server/env";
import { modelSchema } from "@/lib/server/transcripts/schema";

// Volání modelu se strukturovaným výstupem (Azure OpenAI, chat completions, json_schema strict).
// Stabilita: časový limit na pokus, opakování dočasných chyb s čekáním, kontrola odpovědi zodem.
// Logy obsahují jen krok, kód, HTTP stav a pokus, nikdy text dokumentu ani odpověď modelu.

export type AiStep = "transcription" | "extraction";

export type AiErrorCode =
  | "not_configured" // chybí klíč nebo konfigurace
  | "timeout" //        model neodpověděl včas
  | "network" //        spojení selhalo
  | "rate_limited" //   429, moc požadavků
  | "unavailable" //    5xx nebo 408 na straně modelu
  | "rejected" //       4xx: požadavek model odmítl (špatný obrázek, příliš velký vstup…)
  | "refused" //        model odmítl odpovědět
  | "truncated" //      odpověď se nevešla do limitu
  | "invalid_output"; // odpověď neodpovídá schématu

const MESSAGES: Record<AiErrorCode, string> = {
  not_configured: "Čtení dokumentů není nastavené.",
  timeout: "Čtení trvalo příliš dlouho.",
  network: "Nepodařilo se spojit se službou pro čtení dokumentů.",
  rate_limited: "Služba pro čtení dokumentů je přetížená.",
  unavailable: "Služba pro čtení dokumentů je dočasně nedostupná.",
  rejected: "Služba pro čtení dokument odmítla.",
  refused: "Model dokument odmítl přečíst.",
  truncated: "Dokument je na jedno přečtení příliš dlouhý.",
  invalid_output: "Model vrátil neplatný výsledek.",
};

const RETRYABLE: ReadonlySet<AiErrorCode> = new Set(["timeout", "network", "rate_limited", "unavailable", "invalid_output"]);

export class AiError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly code: AiErrorCode,
    readonly step: AiStep,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(MESSAGES[code]);
    this.name = "AiError";
    this.retryable = RETRYABLE.has(code);
  }
}

export type AiUsage = { input: number; output: number; total: number };
export type AiResult<T> = { data: T; model: string; usage: AiUsage | null; durationMs: number; attempts: number };

export type AiContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "high" } };

export type StructuredCall<T> = {
  step: AiStep;
  schemaName: string;
  schema: z.ZodType<T>;
  system: string;
  user: AiContentPart[];
  timeoutMs: number;
  maxTokens: number;
  // Co se zaloguje u chyby (id dokumentu, zákroku). Bez osobních údajů.
  context?: Record<string, string>;
};

const MAX_ATTEMPTS = 3;
const MAX_WAIT_MS = 10_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function callStructured<T>(call: StructuredCall<T>): Promise<AiResult<T>> {
  let env: ReturnType<typeof aiEnv>;
  try {
    env = aiEnv();
  } catch {
    const error = new AiError("not_configured", call.step);
    log("error", call, error, 0);
    throw error;
  }

  const started = Date.now();
  const body = JSON.stringify({
    model: env.AZURE_OPENAI_MODEL,
    messages: [
      { role: "system", content: call.system },
      { role: "user", content: call.user },
    ],
    // Teplotu tenhle model nastavit nedovolí (jen výchozí). Stabilitu drží strict schéma a kontrola zodem.
    max_completion_tokens: call.maxTokens,
    response_format: { type: "json_schema", json_schema: { name: call.schemaName, strict: true, schema: modelSchema(call.schema) } },
  });

  for (let attempt = 1; ; attempt++) {
    try {
      const { data, model, usage } = await attemptCall(call, env, body);
      return { data, model, usage, durationMs: Date.now() - started, attempts: attempt };
    } catch (caught) {
      const error = caught instanceof AiError ? caught : new AiError("network", call.step);
      const last = !error.retryable || attempt >= MAX_ATTEMPTS;
      log(last ? "error" : "warn", call, error, attempt);
      if (last) throw error;
      await wait(error.retryAfterMs ?? Math.min(MAX_WAIT_MS, 800 * 2 ** (attempt - 1) + Math.random() * 300));
    }
  }
}

async function attemptCall<T>(call: StructuredCall<T>, env: ReturnType<typeof aiEnv>, body: string) {
  let res: Response;
  try {
    res = await fetch(`${env.AZURE_OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "api-key": env.AZURE_OPENAI_API_KEY, "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(call.timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new AiError(timedOut ? "timeout" : "network", call.step);
  }

  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    if (res.status === 429) throw new AiError("rate_limited", call.step, 429, retryAfter(res.headers.get("retry-after")));
    if (res.status === 408 || res.status >= 500) throw new AiError("unavailable", call.step, res.status);
    throw new AiError("rejected", call.step, res.status);
  }

  let payload: {
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
  };
  try {
    payload = await res.json();
  } catch {
    throw new AiError("invalid_output", call.step, res.status);
  }

  const choice = payload.choices?.[0];
  if (choice?.message?.refusal) throw new AiError("refused", call.step);
  if (choice?.finish_reason === "length") throw new AiError("truncated", call.step);

  let parsed: unknown;
  try {
    parsed = JSON.parse(choice?.message?.content ?? "");
  } catch {
    throw new AiError("invalid_output", call.step);
  }
  const result = call.schema.safeParse(parsed);
  if (!result.success) throw new AiError("invalid_output", call.step);

  const u = payload.usage;
  const usage = u ? { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0, total: u.total_tokens ?? 0 } : null;
  return { data: result.data, model: payload.model ?? env.AZURE_OPENAI_MODEL, usage };
}

function retryAfter(header: string | null) {
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(MAX_WAIT_MS, seconds * 1000) : undefined;
}

function log(level: "warn" | "error", call: StructuredCall<unknown>, error: AiError, attempt: number) {
  const entry = { event: level === "error" ? "ai.failed" : "ai.retry", step: call.step, code: error.code, status: error.status ?? null, attempt, ...call.context };
  console[level](JSON.stringify(entry));
}
