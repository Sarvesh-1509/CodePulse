/**
 * Shared platform contracts for CodePulse (Modules 3-5).
 *
 * Serializable DTOs shared by the backend API and the Next.js frontend.
 * No server-only imports here: the frontend must be able to use them.
 */

export type PlatformId =
  | "CODEFORCES"
  | "LEETCODE"
  | "CODECHEF"
  | "GEEKSFORGEEKS"
  | "HACKERRANK";

export type PlatformCapability =
  | "profile"
  | "stats"
  | "activity"
  | "contests"
  | "sync";

export interface PlatformInfo {
  id: PlatformId;
  displayName: string;
  /** False for planned integrations (CodeChef, GeeksforGeeks, HackerRank). */
  available: boolean;
  capabilities: PlatformCapability[];
  /** Short hint shown in the connect form, e.g. an example username. */
  usernameHint: string;
}

export type ConnectionStatusDto =
  | "PENDING"
  | "CONNECTED"
  | "SYNCING"
  | "DISCONNECTED"
  | "ERROR";

/** Nullable by design: unavailable metrics stay null, never zero. */
export interface PlatformStatsDto {
  totalSolved: number | null;
  contestRating: number | null;
  contestsAttended: number | null;
  currentStreak: number | null;
  longestStreak: number | null;
  /** Platform-specific extras (ranks, difficulty splits, ...). */
  additional: Record<string, unknown>;
  fetchedAt: string | null;
}

export interface LinkedAccountDto {
  platform: PlatformId;
  platformUsername: string;
  connectionStatus: ConnectionStatusDto;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  /** True when the integration is down but cached data is still shown. */
  stale: boolean;
  stats: PlatformStatsDto | null;
}

export interface ConnectAccountRequest {
  username: string;
}
