/* eslint-disable @typescript-eslint/no-explicit-any -- volné FHIR JSON bez typů */
/**
 * Tenký klient pro FHIR server (InterSystems IRIS for Health, ale funguje s jakýmkoli R4 serverem).
 * Konfigurace z prostředí: FHIR_BASE_URL, FHIR_USER, FHIR_PASSWORD (výchozí = lokální hackathon kit).
 */
export interface FhirClientOptions {
  baseUrl?: string;
  user?: string;
  password?: string;
}

export class FhirError extends Error {
  constructor(
    readonly status: number,
    /** u 400 obvykle OperationOutcome s popisem, co je v resource špatně */
    readonly body: unknown,
  ) {
    super(`FHIR ${status}: ${describe(body)}`);
  }
}

function describe(body: unknown): string {
  const issues = (body as { issue?: { severity?: string; diagnostics?: string; details?: { text?: string } }[] })?.issue;
  if (issues?.length) return issues.map((i) => `${i.severity}: ${i.details?.text ?? i.diagnostics}`).join("; ");
  return typeof body === "string" ? body.slice(0, 500) : JSON.stringify(body).slice(0, 500);
}

export class FhirClient {
  readonly baseUrl: string;
  private readonly auth: string;

  constructor(opts: FhirClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env.FHIR_BASE_URL ?? "http://localhost:52773/fhir/r4").replace(/\/$/, "");
    const user = opts.user ?? process.env.FHIR_USER ?? "SuperUser";
    const password = opts.password ?? process.env.FHIR_PASSWORD ?? "SYS";
    this.auth = "Basic " + Buffer.from(`${user}:${password}`).toString("base64");
  }

  async request<T = any>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}/${path.replace(/^\//, "")}`, {
      ...init,
      headers: {
        Accept: "application/fhir+json",
        "Content-Type": "application/fhir+json",
        Authorization: this.auth,
        ...init.headers,
      },
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {}
    if (!res.ok) throw new FhirError(res.status, body);
    return body as T;
  }

  /** Je server naživu? (CapabilityStatement) */
  metadata() {
    return this.request("metadata");
  }

  /** Odešle transaction/batch Bundle. Vrací response Bundle se stavem každé položky. */
  transaction(bundle: object) {
    return this.request("", { method: "POST", body: JSON.stringify(bundle) });
  }

  /** Vyhledávání, vrací rovnou pole resources (prochází i stránkování). */
  async search<T = any>(resourceType: string, params: Record<string, string | number> = {}): Promise<T[]> {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]): [string, string] => [k, String(v)]));
    let page: any = await this.request(`${resourceType}?${qs}`);
    const out: T[] = [];
    for (;;) {
      out.push(...(page.entry ?? []).map((e: { resource: T }) => e.resource));
      const next = page.link?.find((l: { relation: string }) => l.relation === "next")?.url;
      if (!next) return out;
      page = await this.request(next.startsWith(this.baseUrl) ? next.slice(this.baseUrl.length) : next);
    }
  }

  read<T = any>(resourceType: string, id: string) {
    return this.request<T>(`${resourceType}/${id}`);
  }

  /** Nejnovější Hb pacienta (podle data odběru). */
  async latestHemoglobin(patientId: string) {
    const [obs] = await this.search("Observation", {
      patient: patientId,
      code: "http://loinc.org|718-7",
      _sort: "-date",
      _count: 1,
    });
    return obs ?? null;
  }
}
