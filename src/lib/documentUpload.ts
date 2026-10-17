// Nahrání lékařské zprávy z prohlížeče do API v1. Bez Reactu: komponenta se jen přihlásí ke stavu.
//
// Stránky jdou po dvou souběžně, každá zvlášť (nahrát → přepsat), takže velký dokument nenarazí
// na limity jednoho požadavku. Když stránka selže, tok u ní počká na rozhodnutí: zkusit znovu, nebo přeskočit.
// Až jsou všechny stránky hotové nebo přeskočené, vznikne z nich přepis dokumentu (hodnoty do databáze).
// Selže-li i to, jde to zopakovat, nebo dokument nechat bez čtení (stránky dostane ambulance tak jak jsou).

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

// Vývojářský režim ?mockapi (jen mimo produkci, jako ?fakecam u skeneru): odpovědi API se předstírají,
// aby šel tok vyzkoušet bez databáze a AI. ?mockapi=fail: druhá stránka se napoprvé nepřečte.
const mockMode = () =>
  process.env.NODE_ENV !== "production" && typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("mockapi") : null;

async function mockFetch(url: string): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  if (url.endsWith("/transcribe")) {
    await wait(2500);
    const failOnce = mockMode() === "fail" && url.includes("/documents/mock-2/") && !mockFailed.has(url);
    if (failOnce) mockFailed.add(url);
    return failOnce ? json({ error: "Čtení trvalo příliš dlouho. Zkuste to znovu, nebo čtení přeskočte." }, 502) : json({ status: "processed" });
  }
  await wait(2000);
  return json({ id: "mock-transcript", status: "processed" }, 201);
}
const mockFailed = new Set<string>();
let mockDocuments = 0;

// Telefon bez přihlášení („Vyfotit telefonem“): odkaz z QR jde s každým požadavkem v hlavičce x-upload-link.
let uploadLinkToken: string | null = null;
export function setUploadLink(token: string | null) {
  uploadLinkToken = token;
}
const linkHeaders = (): Record<string, string> => (uploadLinkToken ? { "x-upload-link": uploadLinkToken } : {});

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await (mockMode() !== null ? mockFetch(url) : fetch(url, { cache: "no-store", ...init, headers: { ...init?.headers, ...linkHeaders() } })).catch(() => null);
  if (!res) throw new UploadError("Jste offline. Zkontrolujte připojení.", 0);
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new UploadError(body?.error ?? "Něco se pokazilo.", res.status);
  return body as T;
}

// Nahrání souboru přes XHR: fetch neumí hlásit průběh odesílání, a ten chceme ukázat skutečný (ne točící se kolečko).
function sendFile(url: string, file: Blob, name: string, fields: Record<string, string>, onProgress: (ratio: number) => void): Promise<{ id: string }> {
  if (mockMode() !== null) {
    const id = `mock-${++mockDocuments}`;
    return new Promise((resolve) => {
      let sent = 0;
      const tick = () => {
        sent = Math.min(1, sent + 0.12);
        onProgress(sent);
        if (sent < 1) setTimeout(tick, 180);
        else setTimeout(() => resolve({ id }), 150);
      };
      setTimeout(tick, 150);
    });
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    for (const [name, value] of Object.entries(linkHeaders())) xhr.setRequestHeader(name, value);
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
    xhr.onload = () => {
      const body = xhr.response as { id?: string; error?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300 && body?.id) resolve({ id: body.id });
      else reject(new UploadError(body?.error ?? "Stránku se nepodařilo nahrát.", xhr.status));
    };
    xhr.onerror = () => reject(new UploadError("Jste offline. Zkontrolujte připojení.", 0));
    const form = new FormData();
    form.set("file", file, name);
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    xhr.send(form);
  });
}

const postJson = (url: string, json?: unknown) =>
  call(url, { method: "POST", ...(json === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(json) }) });

export type PageStatus = "waiting" | "uploading" | "reading" | "done" | "failed" | "skipped";
export type UploadPage = {
  key: string;
  previewUrl: string;
  status: PageStatus;
  documentId?: string;
  progress: number; // 0–1 při nahrávání
  error?: string; // text chyby od serveru
};
export type FinishStatus = "idle" | "working" | "failed" | "done" | "empty";
export type UploadState = { pages: UploadPage[]; finish: FinishStatus; finishError?: string };

const CONCURRENCY = 2;
const settled = (page: UploadPage) => page.status === "done" || page.status === "skipped";

// taskId: úkol na lékařskou zprávu, který nahrání splní (server ho posune na „nahráno“). Platí pro všechny stránky.
export function createUpload(caseId: string, scanned: { blob: Blob; previewUrl: string }[], { taskId }: { taskId?: string } = {}) {
  const blobs = new Map<string, Blob>();
  let state: UploadState = {
    pages: scanned.map((page, i) => {
      const key = `page-${i + 1}`;
      blobs.set(key, page.blob);
      return { key, previewUrl: page.previewUrl, status: "waiting", progress: 0 };
    }),
    finish: "idle",
  };
  const listeners = new Set<() => void>();
  const queue = state.pages.map((page) => page.key);
  let workers = 0;
  let disposed = false;

  const set = (next: Partial<UploadState>) => {
    if (disposed) return;
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  };
  const patch = (key: string, next: Partial<UploadPage>) => set({ pages: state.pages.map((page) => (page.key === key ? { ...page, ...next } : page)) });
  const page = (key: string) => state.pages.find((p) => p.key === key)!;

  async function processPage(key: string) {
    try {
      let documentId = page(key).documentId;
      if (!documentId) {
        patch(key, { status: "uploading", progress: 0, error: undefined });
        const fields: Record<string, string> = taskId ? { taskId } : {};
        documentId = (await sendFile(`/api/v1/cases/${caseId}/documents`, blobs.get(key)!, `${key}.jpg`, fields, (progress) => patch(key, { progress }))).id;
      }
      // Čtení AI tu nečekáme (desítky sekund na stránku), přečte se na pozadí po dokončení dokumentu.
      patch(key, { status: "done", documentId, progress: 1, error: undefined });
    } catch (error) {
      patch(key, { status: "failed", error: error instanceof Error ? error.message : "Něco se pokazilo." });
    }
  }

  function pump() {
    while (!disposed && workers < CONCURRENCY && queue.length) {
      const key = queue.shift()!;
      workers++;
      void processPage(key).finally(() => {
        workers--;
        pump();
        finishWhenReady();
      });
    }
  }

  function finishWhenReady() {
    if (state.finish !== "idle" || !state.pages.every(settled)) return;
    void finish(false);
  }

  // Dokument ze všech nahraných stránek, v pořadí focení. Přeskočená a nenahraná stránka chybí.
  // Čtení běží na serveru na pozadí (202), pacient má hotovo, jakmile jsou fotky nahrané.
  async function finish(skip: boolean) {
    const documentIds = state.pages.filter((p) => p.documentId).map((p) => p.documentId!);
    if (!documentIds.length) return set({ finish: "empty" });
    set({ finish: "working", finishError: undefined });
    try {
      if (skip) await postJson(`/api/v1/cases/${caseId}/transcripts`, { documentIds, skip: true });
      else await postJson(`/api/v1/cases/${caseId}/transcripts/background`, { documentIds });
      set({ finish: "done" });
    } catch (error) {
      set({ finish: "failed", finishError: error instanceof Error ? error.message : "Něco se pokazilo." });
    }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    start: pump,
    retryPage(key: string) {
      patch(key, { status: "waiting", error: undefined });
      queue.push(key);
      pump();
    },
    skipPage(key: string) {
      patch(key, { status: "skipped" });
      finishWhenReady();
    },
    retryFinish: () => void finish(false),
    skipFinish: () => void finish(true),
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}

export type UploadController = ReturnType<typeof createUpload>;
