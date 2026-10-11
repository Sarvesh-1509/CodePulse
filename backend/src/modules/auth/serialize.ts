import type { User } from "@prisma/client";

/** Public profile shape. passwordHash is NEVER included. */
export interface SafeUser {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  timezone: string;
  /** Global leaderboard visibility. Defaults to hidden (opt-in). */
  showOnLeaderboard: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    timezone: user.timezone,
    showOnLeaderboard: user.showOnLeaderboard,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
