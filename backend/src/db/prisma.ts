import { PrismaClient } from "@prisma/client";
import { HttpError } from "../utils/httpError";

// Reuse a single Prisma Client instance during development (tsx watch / Next
// dev reloads would otherwise exhaust the PostgreSQL connection pool).
declare global {
  // eslint-disable-next-line no-var
  var __codepulsePrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__codepulsePrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__codepulsePrisma = prisma;
}

/**
 * Fail fast with an actionable error when no database is configured.
 * Prisma otherwise resolves env("DATABASE_URL") lazily at the first query
 * and throws a cryptic get-config/validation error. Every DB-touching
 * service calls this first so clients get a clear 503 instead.
 */
export function assertDatabaseConfigured(): void {
  if (!process.env.DATABASE_URL) {
    throw new HttpError(
      503,
      "Database is not configured. Set the DATABASE_URL environment variable " +
        "to your PostgreSQL connection string (see .env.example)."
    );
  }
}

export interface DatabaseStatus {
  database: "connected" | "disconnected";
  latencyMs: number | null;
}

/** Connectivity check used by GET /api/health/db and scripts/db-check. */
export async function checkDatabase(): Promise<DatabaseStatus> {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { database: "connected", latencyMs: Date.now() - started };
  } catch {
    return { database: "disconnected", latencyMs: null };
  }
}
