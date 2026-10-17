import "server-only";
import { z } from "zod";

// Konfigurace z prostředí (.env lokálně, App Settings / Key Vault v Azure).
// Každá část se ověří až při prvním použití, takže build ani přihlášení nespadnou kvůli chybějícímu úložišti.
// Hodnoty proměnných se nikdy nelogují, v chybě jsou jen názvy.

const empty = (value: unknown) => (value === "" ? undefined : value);
const flag = z.preprocess(empty, z.enum(["true", "false"]).default("false")).transform((v) => v === "true");

const databaseSchema = z
  .object({ DATABASE_URL: z.string().min(1) })
  .refine((env) => !requiresTls(env.DATABASE_URL), {
    message: "V produkci musí DATABASE_URL obsahovat sslmode=verify-full (Azure Database for PostgreSQL vyžaduje TLS).",
    path: ["DATABASE_URL"],
  });

// Společné heslo pro lidi z AA, dokud nebude BankID / SSO. Délka se záměrně nehlídá (heslo "admin" je v pořádku).
const staffSchema = z.object({
  STAFF_PASSWORD: z.preprocess(empty, z.string().optional()),
});

const authSchema = z.object({
  SESSION_TTL_HOURS: z.preprocess(empty, z.coerce.number().int().min(1).max(168).default(12)),
  // Povolené Origin pro zápisy, oddělené čárkou. Bez nastavení platí doména, na kterou požadavek přišel.
  APP_ORIGIN: z.preprocess(empty, z.string().optional()),
  // Za reverzní proxy (Azure App Service) je IP klienta v X-Forwarded-For. Bez proxy hlavičce nevěříme.
  TRUST_PROXY: flag,
  // Neúspěšné pokusy o přihlášení na jeden účet za 15 minut (na IP desetkrát víc). Zatím záměrně hodně vysoko.
  LOGIN_MAX_ATTEMPTS: z.preprocess(empty, z.coerce.number().int().min(1).default(1000)),
});

// Bank iD (OpenID Connect). Sandbox: https://developer.bankid.cz, issuer https://oidc.sandbox.bankid.cz.
// Bez nastavení se přihlášení přes Bank iD jen nenabídne, nic jiného nespadne.
const bankidSchema = z.object({
  BANKID_ISSUER: z.preprocess(empty, z.url().default("https://oidc.sandbox.bankid.cz")),
  BANKID_CLIENT_ID: z.string().min(1),
  BANKID_CLIENT_SECRET: z.string().min(1),
  // Přesně jak je zapsaná v portálu Bank iD. Bez ní se odvodí z adresy, na kterou přišel požadavek.
  BANKID_REDIRECT_URI: z.preprocess(empty, z.url().optional()),
});

const blobSchema = z
  .object({
    // Lokálně connection string. V Azure raději jen URL účtu: přihlásí se managed identity, žádný klíč.
    AZURE_STORAGE_CONNECTION_STRING: z.preprocess(empty, z.string().optional()),
    AZURE_STORAGE_ACCOUNT_URL: z.preprocess(empty, z.url().optional()),
    AZURE_STORAGE_CONTAINER: z.preprocess(empty, z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/).default("documents")),
  })
  .refine((env) => env.AZURE_STORAGE_CONNECTION_STRING || env.AZURE_STORAGE_ACCOUNT_URL, {
    message: "Chybí AZURE_STORAGE_CONNECTION_STRING nebo AZURE_STORAGE_ACCOUNT_URL.",
    path: ["AZURE_STORAGE_CONNECTION_STRING"],
  });

// Čtení lékařských zpráv modelem z portálu Microsoftu s označením EU Data Zone. Klíč jen v .env.local / Key Vault.
const aiSchema = z.object({
  AZURE_OPENAI_API_KEY: z.preprocess(empty, z.string().min(1, "chybí klíč")),
  AZURE_OPENAI_BASE_URL: z.preprocess(empty, z.url().default("https://apim-rakathon-q7146n.azure-api.net/openai/v1")),
  AZURE_OPENAI_MODEL: z.preprocess(empty, z.string().min(1).default("gpt-6-1-sol-dz-eu")),
});

function requiresTls(url: string) {
  if (process.env.NODE_ENV !== "production") return false;
  try {
    const { hostname, searchParams } = new URL(url);
    if (hostname === "localhost" || hostname === "127.0.0.1") return false;
    return !["verify-full", "verify-ca"].includes(searchParams.get("sslmode") ?? "");
  } catch {
    return true;
  }
}

function lazy<T>(name: string, schema: z.ZodType<T>) {
  let cached: T | undefined;
  return (): T => {
    if (cached === undefined) {
      const result = schema.safeParse(process.env);
      if (!result.success) {
        const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        throw new Error(`Neplatná konfigurace (${name}): ${issues}`);
      }
      cached = result.data;
    }
    return cached;
  };
}

export const databaseEnv = lazy("databáze", databaseSchema);
export const authEnv = lazy("přihlášení", authSchema);
export const staffEnv = lazy("přihlášení AA", staffSchema);
export const blobEnv = lazy("úložiště souborů", blobSchema);
export const bankidEnv = lazy("Bank iD", bankidSchema);
/** Je Bank iD nastavené? (bez výjimky, pro rozhodnutí, jestli tlačítko nabídnout) */
export const bankidConfigured = () => bankidSchema.safeParse(process.env).success;
export const aiEnv = lazy("čtení dokumentů (AI)", aiSchema);
