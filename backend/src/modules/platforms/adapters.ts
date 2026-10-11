import type { PlatformId } from "@codepulse/shared";

/**
 * Adapter contract for platform integrations (Modules 3-5).
 *
 * Each adapter owns ALL network access for its platform and returns plain
 * normalized data. Database writes live in the platforms service, which runs
 * them inside short transactions only after the fetch completes — no
 * long-running transaction ever waits on a third-party HTTP request.
 */
export type NormalizedActivityType = "PROBLEM_SOLVED" | "CONTEST_PARTICIPATION" | "SUBMISSION";

export interface NormalizedStats {
  totalSolved: number | null;
  contestRating: number | null;
  contestsAttended: number | null;
  currentStreak: number | null;
  longestStreak: number | null;
  /** Platform-specific extras (ranks, difficulty splits, handles, ...). */
  extra: Record<string, unknown>;
  /** True when an upstream cap cut the import short (documented, not hidden). */
  truncated?: boolean;
}

export interface NormalizedActivity {
  /** Stable upstream identifier, e.g. `cf-123456789`. */
  externalId: string;
  type: NormalizedActivityType;
  /** Stable problem identifier, e.g. `1791F` or a problem slug. */
  problemId: string | null;
  /** Difficulty when reliably available, else null (never fabricated). */
  difficulty: string | null;
  occurredAt: Date;
}

export interface NormalizedContest {
  /** Stable upstream identifier, e.g. `cf-1790`. */
  externalId: string;
  name: string;
  contestedAt: Date;
  ratingBefore: number | null;
  ratingChange: number | null;
  ratingAfter: number | null;
  rank: number | null;
}

export interface SyncBundle {
  /** Canonical username as returned by the platform (display case). */
  canonicalUsername: string;
  stats: NormalizedStats;
  activities: NormalizedActivity[];
  contests: NormalizedContest[];
  /**
   * Day-level aggregates (e.g. LeetCode submission calendar): one entry per
   * UTC calendar day with that day's verified submission count. Counts carry
   * NO problem attribution and must never become PROBLEM_SOLVED rows.
   * Absent when the platform/fetch has no daily import. `complete` is true
   * only when the import covers the full upstream range (single complete
   * map), so persistence may treat it as authoritative for covered days.
   */
  dailyActivity?: {
    days: Array<{ date: Date; submissions: number }>;
    complete: boolean;
  };
}

export interface FetchOptions {
  /**
   * Highest upstream numeric id already imported (e.g. max Codeforces
   * submission id). Adapters that support it stop early once they reach
   * known data; others ignore it. Idempotent upserts remain the backstop.
   */
  sinceId?: number;
}

export interface PlatformAdapter {
  readonly platform: PlatformId;
  /**
   * Fetch + validate everything needed for connect AND sync in one bounded
   * operation. Throws PlatformError on any failure. Must never return
   * fabricated data: unavailable pieces stay empty/null.
   */
  fetchAll(username: string, options?: FetchOptions): Promise<SyncBundle>;
}
