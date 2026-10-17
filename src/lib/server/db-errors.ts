// Chyby PostgreSQL. Drizzle obaluje chybu ovladače, původní je v `cause`.

type PgError = { code?: string; constraint?: string };

function pgError(error: unknown): PgError | null {
  if (typeof error !== "object" || error === null) return null;
  const direct = error as PgError & { cause?: unknown };
  if (direct.code) return direct;
  return typeof direct.cause === "object" && direct.cause !== null ? (direct.cause as PgError) : null;
}

export function isUniqueViolation(error: unknown, constraint?: string) {
  const pg = pgError(error);
  return pg?.code === "23505" && (!constraint || pg.constraint === constraint);
}

export function uniqueConstraint(error: unknown) {
  return isUniqueViolation(error) ? (pgError(error)?.constraint ?? null) : null;
}
