import { config as loadEnvFile } from "dotenv";
import fs from "fs";
import path from "path";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Environment loading: `import "dotenv/config"` only reads cwd/.env, but npm
// workspace scripts run with cwd=backend/, so a root .env would be missed.
// Load cwd/.env first, then the repository root one directory up.
// Precedence: shell environment > backend/.env > root .env (dotenv never
// overrides variables that are already set).
// ---------------------------------------------------------------------------
for (const file of [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../.env"),
]) {
  if (fs.existsSync(file)) {
    const result = loadEnvFile({ path: file });
    if (result.error) {
      console.warn(`[env] Could not parse ${file}:`, result.error.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Environment validation. Only NODE_ENV, PORT and FRONTEND_URL are strictly
// required to boot (Module 0 contract). DATABASE_URL is required for any
// database-backed operation; JWT_SECRET must be strong outside development.
// ---------------------------------------------------------------------------

const DEV_ONLY_JWT_SECRET = "dev-only-insecure-secret-do-not-use-in-production";

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(5000),
    FRONTEND_URL: z.string().url().default("http://localhost:3000"),
    DATABASE_URL: z.string().min(1).optional(),
    JWT_SECRET: z.string().min(1).optional(),
    // Platform sync HTTP timeouts (ms). Bounded defaults keep syncs from
    // hanging; override per deployment if upstream latency demands it.
    CODEFORCES_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
    LEETCODE_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
    CODECHEF_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
    GEEKSFORGEEKS_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
    HACKERRANK_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  })
  .superRefine((val, ctx) => {
    if (
      val.NODE_ENV === "production" &&
      (!val.JWT_SECRET || val.JWT_SECRET.length < 32)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["JWT_SECRET"],
        message:
          "JWT_SECRET must be set to a strong value (at least 32 characters) in production.",
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "Invalid environment configuration:",
    parsed.error.flatten().fieldErrors
  );
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;
export type Env = typeof env;

export const isProduction = env.NODE_ENV === "production";

/**
 * Secret used to sign session JWTs. In development/test a fixed insecure
 * default is used (with a warning) so the app boots without extra setup;
 * production refuses to start without a strong secret (see schema above).
 */
function resolveJwtSecret(): string {
  if (env.JWT_SECRET) return env.JWT_SECRET;
  if (!isProduction) {
    console.warn(
      "[auth] JWT_SECRET is not set - using a dev-only insecure secret. Set a strong JWT_SECRET before deploying."
    );
    return DEV_ONLY_JWT_SECRET;
  }
  // Unreachable: schema validation already threw in production.
  throw new Error("JWT_SECRET is required in production.");
}

export const jwtSecret = resolveJwtSecret();
