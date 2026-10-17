import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authEnv } from "@/lib/server/env";

// Společná vrstva route handlerů: chyby, odpovědi, čtení vstupu a ochrana proti CSRF.

// Výchozí hlášky zod (délka, datum, číslo) česky. Platí pro celý server, vlastní hlášky ve schématech zůstávají.
z.config(z.locales.cs());

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly options: { headers?: Record<string, string>; issues?: { path: string; message: string }[] } = {},
  ) {
    super(message);
  }
}

export const badRequest = (message: string, issues?: { path: string; message: string }[]) => new HttpError(400, message, { issues });
export const unauthorized = () => new HttpError(401, "Nejste přihlášen(a).");
export const forbidden = (message = "K tomu nemáte oprávnění.") => new HttpError(403, message);
export const notFound = (message = "Nenalezeno.") => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);

// Chyba vnořeného vstupu (zákrok v POST /patients): cesty polí dostanou předponu, třeba „cases.0.procedureName“.
export function prefixIssues(error: unknown, prefix: string) {
  if (!(error instanceof HttpError) || !error.options.issues) return error;
  const issues = error.options.issues.map((issue) => ({ ...issue, path: `${prefix}.${issue.path}` }));
  return new HttpError(error.status, error.message, { ...error.options, issues });
}

// Odpovědi API obsahují zdravotní údaje: nikdy do sdílené cache ani do cache prohlížeče.
const NO_STORE = { "cache-control": "no-store" };

export function json(data: unknown, init: ResponseInit = {}) {
  return NextResponse.json(data, { ...init, headers: { ...NO_STORE, ...init.headers } });
}

export function noContent() {
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Obal route handleru: CSRF kontrola u zápisů a jednotné chyby { error, issues? }.
// Handler bez parametrů cesty má jen req, s parametry i ctx (RouteContext).
export function route<C = never>(handler: (req: NextRequest, ctx: C) => Promise<Response>) {
  return async (req: NextRequest, ...[ctx]: [C] extends [never] ? [] : [ctx: C]): Promise<Response> => {
    try {
      if (!SAFE_METHODS.has(req.method)) assertSameOrigin(req);
      return await handler(req, ctx as C);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    const body = error.options.issues ? { error: error.message, issues: error.options.issues } : { error: error.message };
    return json(body, { status: error.status, headers: error.options.headers });
  }
  // Zpráva Drizzle obsahuje parametry dotazu, tedy osobní údaje. Logujeme jen chybu ovladače.
  const root = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  const code = typeof root === "object" && root !== null && "code" in root ? ` [${String(root.code)}]` : "";
  console.error(`API: neošetřená chyba${code}:`, root instanceof Error ? root.message : root);
  return json({ error: "Něco se pokazilo. Zkuste to prosím znovu." }, { status: 500 });
}

// Cookie má SameSite=Lax, tohle je druhá vrstva: zápis z cizí stránky odmítneme podle Sec-Fetch-Site a Origin.
// Klient bez Origin (curl, server) projde, CSRF se týká jen prohlížeče a ten Origin u zápisu posílá vždy.
function assertSameOrigin(req: NextRequest) {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw forbidden("Požadavek z cizí stránky.");
  const origin = req.headers.get("origin");
  if (origin && !allowedOrigins(req).includes(origin)) throw forbidden("Požadavek z cizí stránky.");
}

function allowedOrigins(req: NextRequest) {
  const configured = authEnv().APP_ORIGIN?.split(",").map((o) => o.trim()).filter(Boolean);
  if (configured?.length) return configured;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return [req.nextUrl.origin];
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  return [`${proto}://${host}`];
}

export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest(
      "Neplatné údaje.",
      result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  return result.data;
}

const MAX_JSON_BYTES = 64 * 1024;

export async function readJson<T>(req: NextRequest, schema: z.ZodType<T>): Promise<T> {
  if (!/^application\/json\b/i.test(req.headers.get("content-type") ?? "")) throw new HttpError(415, "Očekávám JSON.");
  const text = new TextDecoder().decode(await readLimited(req, MAX_JSON_BYTES));
  if (hasNul(text)) throw badRequest("Neplatné údaje.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw badRequest("Neplatný JSON.");
  }
  return parse(schema, body);
}

// multipart/form-data: tělo se nejdřív načte jen do limitu, teprve pak se rozparsuje.
export async function readMultipart(req: NextRequest, maxBytes: number): Promise<FormData> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\b/i.test(contentType)) throw new HttpError(415, "Očekávám multipart/form-data.");
  const body = await readLimited(req, maxBytes);
  try {
    return await new Response(body, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw badRequest("Neplatný formulář.");
  }
}

// Tělo požadavku čte jen do limitu, i když klient Content-Length neuvede nebo lže.
async function readLimited(req: NextRequest, maxBytes: number): Promise<Buffer<ArrayBuffer>> {
  const declared = Number(req.headers.get("content-length"));
  if (declared > maxBytes) throw new HttpError(413, "Požadavek je příliš velký.");
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "Požadavek je příliš velký.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// PostgreSQL znak NUL v textu ani JSON neuloží (chyba 22021 / 22P05). Ve vstupu ho odmítneme rovnou jako neplatný.
export const hasNul = (text: string) => text.includes("\u0000") || /\\u0000/i.test(text);

export function readQuery<T>(req: NextRequest, schema: z.ZodType<T>): T {
  const query = Object.fromEntries(req.nextUrl.searchParams);
  if (Object.values(query).some(hasNul)) throw badRequest("Neplatné údaje.");
  return parse(schema, query);
}

// Parametry cesty jsou UUID. Neplatné ID je pro klienta totéž co neexistující záznam.
export async function readIds<K extends string>(ctx: { params: Promise<Record<K, string>> }, ...keys: K[]): Promise<Record<K, string>> {
  const values = await ctx.params;
  for (const key of keys) {
    if (!z.uuid().safeParse(values[key]).success) throw notFound();
  }
  return values;
}
