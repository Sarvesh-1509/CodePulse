import { Prisma } from "@prisma/client";
import { assertDatabaseConfigured, prisma } from "../../db/prisma";
import { conflict, HttpError } from "../../utils/httpError";
import { normalizeEmail } from "./email";
import { hashPassword, verifyPassword } from "./password";
import { toSafeUser, type SafeUser } from "./serialize";
import type { LoginInput, RegisterInput } from "./schemas";

const INVALID_CREDENTIALS = "Invalid email or password.";

function toConflictError(err: unknown): HttpError | null {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    const targets = (err.meta?.target as string[] | undefined) ?? [];
    if (targets.includes("email")) {
      return conflict("An account with this email already exists.");
    }
    if (targets.includes("username")) {
      return conflict("This username is already taken.");
    }
    return conflict("An account with these details already exists.");
  }
  return null;
}

export async function registerUser(input: RegisterInput): Promise<SafeUser> {
  assertDatabaseConfigured();
  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);

  try {
    const user = await prisma.user.create({
      data: {
        username: input.username,
        email,
        passwordHash,
        displayName: input.displayName,
      },
    });
    return toSafeUser(user);
  } catch (err) {
    // Database-level unique constraints make concurrent duplicate
    // registrations safe: exactly one insert wins, the rest land here.
    const conflictError = toConflictError(err);
    if (conflictError) throw conflictError;
    throw err;
  }
}

export async function authenticateUser(input: LoginInput): Promise<SafeUser> {
  assertDatabaseConfigured();
  const email = normalizeEmail(input.email);
  const user = await prisma.user.findUnique({ where: { email } });

  // Generic error for unknown accounts AND wrong passwords so callers cannot
  // probe which email addresses are registered.
  if (!user) throw new HttpError(401, INVALID_CREDENTIALS);

  const matches = await verifyPassword(input.password, user.passwordHash);
  if (!matches) throw new HttpError(401, INVALID_CREDENTIALS);

  return toSafeUser(user);
}

export async function getUserById(id: string): Promise<SafeUser | null> {
  assertDatabaseConfigured();
  const user = await prisma.user.findUnique({ where: { id } });
  return user ? toSafeUser(user) : null;
}
