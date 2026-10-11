import { Prisma } from "@prisma/client";
import { assertDatabaseConfigured, prisma } from "../../db/prisma";
import { toSafeUser, type SafeUser } from "../auth/serialize";
import type { UpdateProfileInput } from "./schemas";
import { conflict } from "../../utils/httpError";

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput
): Promise<SafeUser> {
  assertDatabaseConfigured();
  // Mass-assignment guard: only the five whitelisted fields can reach Prisma.
  const data: {
    username?: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    timezone?: string;
    showOnLeaderboard?: boolean;
  } = {};
  if (input.username !== undefined) data.username = input.username;
  if (input.displayName !== undefined) data.displayName = input.displayName;
  if (input.avatarUrl !== undefined) {
    data.avatarUrl = input.avatarUrl === "" ? null : input.avatarUrl;
  }
  if (input.timezone !== undefined) data.timezone = input.timezone;
  if (input.showOnLeaderboard !== undefined) data.showOnLeaderboard = input.showOnLeaderboard;
  if (input.username !== undefined) data.username = input.username;
  if (input.displayName !== undefined) data.displayName = input.displayName;
  if (input.avatarUrl !== undefined) {
    data.avatarUrl = input.avatarUrl === "" ? null : input.avatarUrl;
  }
  if (input.timezone !== undefined) data.timezone = input.timezone;

  try {
    const user = await prisma.user.update({ where: { id: userId }, data });
    return toSafeUser(user);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw conflict("This username is already taken.");
    }
    throw err;
  }
}
