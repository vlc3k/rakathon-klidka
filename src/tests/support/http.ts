import { NextRequest } from "next/server";

export const ORIGIN = "http://localhost:3000";

type RequestOptions = {
  json?: unknown;
  form?: FormData;
  cookie?: string;
  headers?: Record<string, string>;
};

// Požadavek, jak ho pošle prohlížeč ze stejné domény (Origin u zápisů).
export function request(method: string, path: string, options: RequestOptions = {}) {
  const headers = new Headers(options.headers);
  if (options.cookie) headers.set("cookie", options.cookie);
  if (method !== "GET" && method !== "HEAD" && !headers.has("origin")) headers.set("origin", ORIGIN);
  let body: BodyInit | undefined;
  if (options.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.json);
  } else if (options.form) {
    body = options.form;
  }
  return new NextRequest(new URL(path, ORIGIN), { method, headers, body });
}

// Druhý argument route handleru: { params: Promise<…> }.
export function params<T extends Record<string, string>>(value: T) {
  return { params: Promise.resolve(value) };
}

// Hodnota cookie z odpovědi přihlášení, ve tvaru pro hlavičku Cookie dalšího požadavku.
export function sessionCookieFrom(res: Response) {
  const header = res.headers.get("set-cookie");
  if (!header) throw new Error("Odpověď nenastavila cookie.");
  return header.split(";")[0];
}
