import bcrypt from "bcryptjs";

// bcryptjs (pure JS, no native build) with cost factor 12.
// Argon2id was considered but needs a native binding that fails on some
// Windows/CI toolchains; bcrypt-12 remains a suitable, maintained choice.
const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  passwordHash: string
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}
