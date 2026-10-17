// Volání API z prohlížeče. Session je v httpOnly cookie, posílá ji prohlížeč sám (same-origin).
// Chyby API mají tvar { error, issues? } (docs/data_model/api.md), tady z nich je ApiError.

export type ApiIssue = { path: string; message: string };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: ApiIssue[] = [],
  ) {
    super(message);
  }

  // Chyba k jednomu poli formuláře (path z API, třeba „birthNumber“ nebo „cases.0.diagnosis.text“).
  issue(path: string) {
    return this.issues.find((issue) => issue.path === path || issue.path.startsWith(`${path}.`))?.message;
  }
}

// Session vypršela nebo byla zrušena: SessionGate přesměruje na přihlášení.
export const UNAUTHORIZED_EVENT = "aa:unauthorized";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { cache: "no-store", credentials: "same-origin", ...init });
  } catch {
    throw new ApiError(0, "Nepodařilo se spojit se serverem. Zkontrolujte připojení.");
  }
  if (res.status === 401 && path !== "/api/auth/login" && typeof window !== "undefined") {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; issues?: ApiIssue[] } | null;
    throw new ApiError(res.status, body?.error ?? "Něco se pokazilo. Zkuste to prosím znovu.", body?.issues ?? []);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, jsonInit("POST", body ?? {})),
  patch: <T>(path: string, body: unknown) => request<T>(path, jsonInit("PATCH", body)),
  put: <T>(path: string, body: unknown) => request<T>(path, jsonInit("PUT", body)),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  // multipart: Content-Type s hranicí nastaví prohlížeč sám
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: "POST", body: form }),
};

export const errorMessage = (error: unknown, fallback = "Něco se pokazilo. Zkuste to prosím znovu.") =>
  error instanceof ApiError ? error.message : fallback;

// Originál dokumentu (fotka, podpis, hlasovka, PDF). Oprávnění hlídá API.
export const documentUrl = (caseId: string, documentId: string) => `/api/v1/cases/${caseId}/documents/${documentId}/content`;
