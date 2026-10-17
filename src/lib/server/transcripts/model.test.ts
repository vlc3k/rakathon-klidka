import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { AiError, callStructured } from "@/lib/server/transcripts/model";

process.env.AZURE_OPENAI_API_KEY = "test-key";

const schema = z.strictObject({ ok: z.boolean() });
const call = () =>
  callStructured({ step: "extraction", schemaName: "test", schema, system: "s", user: [{ type: "text", text: "t" }], timeoutMs: 1000, maxTokens: 100, context: { documentId: "d1" } });

const reply = (content: string, init: { finish?: string; status?: number } = {}) =>
  new Response(JSON.stringify({ model: "gpt-test", usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }, choices: [{ finish_reason: init.finish ?? "stop", message: { content } }] }), {
    status: init.status ?? 200,
  });

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Spustí volání a protočí čekání mezi pokusy.
async function run() {
  const result = call().then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  return result;
}

describe("volání modelu", () => {
  test("vrátí ověřená data, model, spotřebu a počet pokusů; posílá strict json_schema", async () => {
    fetchMock.mockResolvedValueOnce(reply('{"ok":true}'));

    const result = await run();

    expect(result).toEqual({ value: { data: { ok: true }, model: "gpt-test", usage: { input: 3, output: 2, total: 5 }, durationMs: expect.any(Number), attempts: 1 } });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.response_format.json_schema).toMatchObject({ strict: true, schema: { additionalProperties: false, required: ["ok"] } });
  });

  test("dočasná chyba (503, 429) se zopakuje", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "1" } })).mockResolvedValueOnce(reply('{"ok":true}'));

    const result = await run();

    expect(result).toMatchObject({ value: { attempts: 3 } });
  });

  test("odpověď mimo schéma se zopakuje a po třech pokusech skončí invalid_output", async () => {
    fetchMock.mockImplementation(async () => reply('{"ok":"ano"}'));

    const result = await run();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ error: expect.objectContaining({ code: "invalid_output", step: "extraction", retryable: true }) });
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(expect.stringContaining('"code":"invalid_output"'));
  });

  test("odmítnutý požadavek (400) a useknutá odpověď se neopakují", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 400 }));
    expect(await run()).toMatchObject({ error: expect.objectContaining({ code: "rejected", status: 400 }) });

    fetchMock.mockResolvedValueOnce(reply('{"ok":tr', { finish: "length" }));
    expect(await run()).toMatchObject({ error: expect.objectContaining({ code: "truncated" }) });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("výpadek spojení je network a log neobsahuje obsah požadavku", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const result = await run();

    expect(result).toMatchObject({ error: expect.any(AiError) });
    expect((result as { error: AiError }).error.code).toBe("network");
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain('"documentId":"d1"');
    expect(logged).not.toContain("test-key");
  });
});
