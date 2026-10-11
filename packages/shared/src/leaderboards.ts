/**
 * Shared leaderboard contracts for CodePulse (Module 14).
 *
 * Leaderboards rank trusted persisted values only. Clients never submit
 * scores. Ties share a rank (1,2,2,4); secondary sort is username ascending
 * so ordering is deterministic across pages and reloads.
 */

export type LeaderboardMetric = "cpr" | "activity" | "solved" | "streak";
export type LeaderboardPeriod = "7d" | "30d" | "90d";

/** Public identity fragment: never email, platform logins, or secrets. */
export interface LeaderboardUserDto {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface LeaderboardEntryDto {
  rank: number;
  user: LeaderboardUserDto;
  /** Primary score for the selected metric (metric-specific units). */
  score: number;
  /** True when the CPR behind this row has limited coverage. */
  provisional?: boolean;
  /** Metric-specific supporting numbers (all verified, null when absent). */
  detail: {
    rating?: number | null;
    activeDays?: number | null;
    events?: number | null;
    solved?: number | null;
    streak?: number | null;
  };
}

export interface LeaderboardPageDto {
  metric: LeaderboardMetric;
  period: LeaderboardPeriod | null;
  formulaVersion: string | null;
  entries: LeaderboardEntryDto[];
  pagination: { page: number; limit: number; total: number };
  /** The caller's own row, or null when ineligible/not ranked. */
  me: LeaderboardEntryDto | null;
  note: string | null;
}
