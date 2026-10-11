/**
 * Shared API contracts for CodePulse (Modules 1-2).
 *
 * These types describe what travels over HTTP. They must stay free of
 * server-only imports (Prisma, JWT, hashing) so the frontend can use them.
 */

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

export interface AuthData {
  user: SafeUser;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  displayName?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface UpdateProfileRequest {
  username?: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  timezone?: string;
  showOnLeaderboard?: boolean;
}
