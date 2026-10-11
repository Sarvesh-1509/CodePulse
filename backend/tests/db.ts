import { randomUUID } from "crypto";
import { checkDatabase, prisma } from "../src/db/prisma";

/**
 * Test-database helpers (Modules 1-2).
 *
 * Run the backend suite against an isolated database:
 *   DATABASE_URL=postgresql://codepulse:codepulse_dev_pw@localhost:5432/codepulse_test
 *
 * Tests only insert uniquely-suffixed rows and delete them afterwards; they
 * never truncate tables or touch real user data.
 */

export async function databaseAvailable(): Promise<boolean> {
  const status = await checkDatabase();
  return status.database === "connected";
}

let counter = 0;

export function uniqueEmail(prefix = "mod12"): string {
  counter += 1;
  return `${prefix}+${Date.now()}_${counter}_${randomUUID().slice(0, 8)}@example.com`;
}

export function uniqueUsername(prefix = "mod12user"): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}_${randomUUID().slice(0, 6)}`;
}

/** Remove every user created through these helpers (cascades to children). */
export async function cleanupUsers(emails: string[]): Promise<void> {
  if (emails.length === 0) return;
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
}
