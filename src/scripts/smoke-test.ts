// Ověří napojení na Azure podle .env: PostgreSQL (TLS, migrace) a Blob Storage (kontejner, zápis, čtení, smazání).
// S --api projde i hlavní tok přes HTTP proti běžící aplikaci a testovací data i soubory po sobě smaže.
//   npm run smoke
//   npm run smoke -- --api --base-url http://localhost:3000
// Hodnoty z .env nikdy nevypisuje.

import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as s from "../db/schema";

try {
  process.loadEnvFile();
} catch {
  // bez .env: hodnoty z prostředí
}

const { values: args } = parseArgs({ options: { api: { type: "boolean" }, "base-url": { type: "string" } } });

let failures = 0;
const ok = (message: string) => console.log(`  ✓ ${message}`);
const bad = (message: string) => {
  failures++;
  console.log(`  ✗ ${message}`);
};
const check = (condition: unknown, message: string, detail = "") => (condition ? ok(message) : bad(detail ? `${message} (${detail})` : message));
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

// ---------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------

async function checkDatabase(pool: Pool) {
  console.log("PostgreSQL");
  const url = new URL(process.env.DATABASE_URL!);
  const sslmode = url.searchParams.get("sslmode");
  check(sslmode === "verify-full", "DATABASE_URL má sslmode=verify-full (produkce bez něj nenastartuje)", `je ${sslmode ?? "bez sslmode"}`);

  const { rows: [server] } = await pool.query<{ version: string }>("select current_setting('server_version') as version");
  ok(`spojení funguje, PostgreSQL ${server.version}`);
  const { rows: [tls] } = await pool.query<{ ssl: boolean; version: string | null }>("select ssl, version from pg_stat_ssl where pid = pg_backend_pid()");
  check(tls?.ssl, `spojení je šifrované${tls?.version ? ` (${tls.version})` : ""}`);

  const journal = JSON.parse(readFileSync(path.resolve("db/migrations/meta/_journal.json"), "utf8")) as { entries: unknown[] };
  const { rows: [applied] } = await pool.query<{ count: string }>("select count(*) from drizzle.__drizzle_migrations").catch(() => ({ rows: [{ count: "0" }] }));
  check(Number(applied.count) === journal.entries.length, `migrace jsou aktuální (${applied.count}/${journal.entries.length})`, "spusťte npm run db:migrate");

  const expected = ["users", "patients", "sessions", "login_attempts", "templates", "template_tasks", "cases", "tasks", "documents", "information", "events"];
  const { rows } = await pool.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public'");
  const missing = expected.filter((t) => !rows.some((r) => r.table_name === t));
  check(missing.length === 0, "všechny tabulky existují", `chybí ${missing.join(", ")}`);
}

// ---------------------------------------------------------------------------
// Azure Blob Storage
// ---------------------------------------------------------------------------

function containerClient(): ContainerClient {
  const container = process.env.AZURE_STORAGE_CONTAINER || "documents";
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (connectionString) return BlobServiceClient.fromConnectionString(connectionString).getContainerClient(container);
  if (process.env.AZURE_STORAGE_ACCOUNT_URL) return new BlobServiceClient(process.env.AZURE_STORAGE_ACCOUNT_URL, new DefaultAzureCredential()).getContainerClient(container);
  throw new Error("Chybí AZURE_STORAGE_CONNECTION_STRING nebo AZURE_STORAGE_ACCOUNT_URL.");
}

async function checkBlob(container: ContainerClient) {
  console.log("Azure Blob Storage");
  ok(`přihlášení ${process.env.AZURE_STORAGE_CONNECTION_STRING ? "connection stringem" : "přes managed identity / Azure CLI"}`);
  const properties = await container.getProperties();
  ok(`kontejner ${container.containerName} existuje`);
  check(!properties.blobPublicAccess, "kontejner je privátní (bez anonymního přístupu)", `veřejný přístup: ${properties.blobPublicAccess}`);

  const probe = container.getBlockBlobClient(`smoke-test/${randomUUID()}`);
  const data = randomBytes(1024);
  try {
    await probe.uploadData(data, { blobHTTPHeaders: { blobContentType: "application/octet-stream" }, conditions: { ifNoneMatch: "*" } });
    ok("zápis souboru");
    const downloaded = await probe.downloadToBuffer();
    check(downloaded.equals(data), "čtení souboru vrátí stejný obsah");
  } finally {
    await probe.deleteIfExists();
    ok("smazání zkušebního souboru");
  }
}

// ---------------------------------------------------------------------------
// Hlavní tok přes HTTP
// ---------------------------------------------------------------------------

async function checkApi(db: ReturnType<typeof drizzle<typeof s>>, container: ContainerClient) {
  const base = args["base-url"] ?? process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
  console.log(`API (${base})`);
  if (!process.env.STAFF_PASSWORD) return bad("STAFF_PASSWORD není nastavené, lékař se nepřihlásí");

  const origin = new URL(base).origin;
  const call = async (method: string, path: string, options: { cookie?: string; json?: unknown; form?: FormData } = {}) => {
    const headers: Record<string, string> = { origin }; // jako prohlížeč ze stejné domény
    if (options.cookie) headers.cookie = options.cookie;
    let body: BodyInit | undefined;
    if (options.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.json);
    } else if (options.form) body = options.form;
    return fetch(new URL(path, base), { method, headers, body, redirect: "manual" });
  };
  const cookieOf = (res: Response) => res.headers.getSetCookie()[0]?.split(";")[0] ?? "";

  const runId = randomBytes(4).toString("hex");
  const created: { staffId?: string; patientId?: string; caseId?: string } = {};
  try {
    const [staff] = await db
      .insert(s.users)
      .values({ role: "aa", firstName: "Smoke", lastName: "Test", displayName: `Smoke Test ${runId}`, email: `smoke-${runId}@example.invalid` })
      .returning({ id: s.users.id });
    created.staffId = staff.id;

    const staffLogin = await call("POST", "/api/auth/login", { json: { email: `smoke-${runId}@example.invalid`, password: process.env.STAFF_PASSWORD } });
    check(staffLogin.status === 200, "lékař se přihlásí", `HTTP ${staffLogin.status}`);
    const staffCookie = cookieOf(staffLogin);

    const surgeryDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const patientRes = await call("POST", "/api/v1/patients", {
      cookie: staffCookie,
      json: { firstName: "Smoke", lastName: `Test ${runId}`, externalId: `SMOKE-${runId}`, birthDate: "1960-03-01", cases: [{ procedureName: "Smoke test", diagnosis: { text: "Smoke test" }, surgeryDate }] },
    });
    check(patientRes.status === 201, "lékař založí pacienta se zákrokem", `HTTP ${patientRes.status}`);
    const patient = (await patientRes.json()) as { id: string; cases: { id: string }[] };
    created.patientId = patient.id;
    created.caseId = patient.cases[0]?.id;
    const caseId = created.caseId!;

    const taskRes = await call("POST", `/api/v1/cases/${caseId}/tasks`, { cookie: staffCookie, json: { assignee: "patient", kind: "upload", title: "Smoke: laboratoř", documentType: "lab_report" } });
    check(taskRes.status === 201, "lékař vytvoří úkol pro pacienta", `HTTP ${taskRes.status}`);
    const task = (await taskRes.json()) as { id: string };

    const patientLogin = await call("POST", "/api/auth/login", { json: { identifier: `smoke-${runId}`, birthDate: "1960-03-01" } });
    check(patientLogin.status === 200, "pacient se přihlásí identifikátorem a datem narození", `HTTP ${patientLogin.status}`);
    const patientCookie = cookieOf(patientLogin);

    const myCases = await call("GET", `/api/v1/users/${patient.id}/cases`, { cookie: patientCookie });
    check(myCases.status === 200 && JSON.stringify(await myCases.json()).includes(caseId), "pacient vidí svůj zákrok");

    // JPEG hlavička + náhodný obsah, ať se soubor nesloučí s jiným (SHA-256).
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(2048)]);
    const form = new FormData();
    form.set("file", new File([jpeg], "smoke.jpg", { type: "image/jpeg" }));
    form.set("taskId", task.id);
    const upload = await call("POST", `/api/v1/cases/${caseId}/documents`, { cookie: patientCookie, form });
    check(upload.status === 201, "pacient nahraje dokument", `HTTP ${upload.status}`);
    const document = (await upload.json()) as { id: string; status: string };

    const blob = container.getBlobClient(`cases/${caseId}/${document.id}`);
    check(await blob.exists(), "soubor je v Azure Blob Storage pod cases/<caseId>/<documentId>");

    const metadata = await call("GET", `/api/v1/cases/${caseId}/documents/${document.id}/metadata`, { cookie: patientCookie });
    check(metadata.status === 200 && ((await metadata.json()) as { status: string }).status === "uploaded", "metadata dokumentu");
    const content = await call("GET", `/api/v1/cases/${caseId}/documents/${document.id}/content`, { cookie: patientCookie });
    check(content.status === 200 && Buffer.from(await content.arrayBuffer()).equals(Buffer.from(jpeg)), "obsah dokumentu se z úložiště vrátí beze změny");

    const tasks = await call("GET", `/api/v1/cases/${caseId}/tasks`, { cookie: staffCookie });
    const taskStatus = ((await tasks.json()) as { id: string; status: string }[]).find((t) => t.id === task.id)?.status;
    check(taskStatus === "submitted", "nahrání posunulo úkol na submitted", `je ${taskStatus}`);

    const detail = await call("GET", `/api/v1/cases/${caseId}`, { cookie: staffCookie });
    check(detail.status === 200 && JSON.stringify(await detail.json()).includes(document.id), "lékař vidí dokument v detailu zákroku");
    const queue = await call("GET", "/api/v1/queue", { cookie: staffCookie });
    check(queue.status === 200 && JSON.stringify(await queue.json()).includes(caseId), "zákrok je ve frontě");

    const forbidden = await call("GET", `/api/v1/cases/${caseId}`, { cookie: patientCookie });
    check(forbidden.status === 403, "pacient lékařský detail neotevře", `HTTP ${forbidden.status}`);

    const logout = await call("POST", "/api/auth/logout", { cookie: patientCookie });
    const afterLogout = await call("GET", "/api/auth/session", { cookie: patientCookie });
    check(logout.status === 204 && afterLogout.status === 401, "po odhlášení session neplatí");
  } finally {
    // Úklid: soubory zákroku, zákrok (úkoly, dokumenty, informace a události kaskádou), pacient, uživatelé (session kaskádou).
    if (created.caseId) {
      for await (const item of container.listBlobsFlat({ prefix: `cases/${created.caseId}/` })) await container.deleteBlob(item.name);
      await db.delete(s.cases).where(eq(s.cases.id, created.caseId));
    }
    if (created.patientId) {
      await db.delete(s.patients).where(eq(s.patients.userId, created.patientId));
      await db.delete(s.users).where(eq(s.users.id, created.patientId));
    }
    if (created.staffId) await db.delete(s.users).where(eq(s.users.id, created.staffId));
    const [left] = await db.select({ count: sql<number>`count(*)::int` }).from(s.users).where(sql`${s.users.email} = ${`smoke-${runId}@example.invalid`} or ${s.users.displayName} = ${`Smoke Test ${runId}`}`);
    check(left.count === 0, "testovací data a soubory jsou smazané");
  }
}

// ---------------------------------------------------------------------------

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Chybí DATABASE_URL (.env nebo prostředí).");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15_000 });
  try {
    await checkDatabase(pool).catch((error) => bad(`PostgreSQL: ${errorText(error)}`));
    const container = containerClient();
    await checkBlob(container).catch((error) => bad(`Blob Storage: ${errorText(error)}`));
    if (args.api) await checkApi(drizzle({ client: pool, schema: s }), container).catch((error) => bad(`API: ${errorText(error)}`));
  } finally {
    await pool.end();
  }
  console.log(failures ? `\n${failures} kontrol selhalo.` : "\nVše v pořádku.");
  process.exitCode = failures ? 1 : 0;
}

void main();
