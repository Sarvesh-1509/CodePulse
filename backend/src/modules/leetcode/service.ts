import type {
  FetchOptions,
  PlatformAdapter,
  SyncBundle,
} from "../platforms/adapters";
import { fetchLeetCodeProfile, type LeetCodeHttpDeps } from "./client";

/**
 * LeetCode adapter (Module 5): maps the best-effort GraphQL bundle to a
 * normalized sync bundle.
 *
 * Honesty rules enforced here:
 * - Aggregate totals are synced; per-problem events come ONLY from the
 *   bounded recent-submission window (≤20, upstream-capped, no pagination
 *   exists), keyed by upstream id.
 * - Daily submission counts from the full submission calendar are stored
 *   as day-level aggregates (UTC day granularity, no problem attribution),
 *   NOT as individual ActivityEvent rows. They count toward active
 *   days/streaks/trends and NEVER toward solved counts, which require
 *   PROBLEM_SOLVED plus a non-null problem identifier.
 * - Attended contests from the contest-history selection become contest
 *   rows with locally chained integer ratings; rank is not provided
 *   upstream and stays null.
 * - No streaks are derived (null) — streaks cannot be computed from totals.
 * - No dates are invented: aggregates carry upstream UTC days or nothing.
 * - When a selection drifts, flags surface in stats.extra so clients can
 *   say so instead of showing an incomplete history as if it were complete.
 */
export interface LeetCodeAdapterDeps extends LeetCodeHttpDeps {}

export function createLeetCodeAdapter(deps: LeetCodeAdapterDeps): PlatformAdapter {
  return {
    platform: "LEETCODE",
    async fetchAll(username: string, _options?: FetchOptions): Promise<SyncBundle> {
      const bundle = await fetchLeetCodeProfile(username, deps);

      // Calendar days persist as day-level aggregates (see SyncBundle),
      // never expanded into per-submission ActivityEvent rows: expansion
      // would fabricate problem-less events and double-count against the
      // recent window on shared days. `complete` mirrors the client's
      // drift flag so persistence only treats covered days as authoritative
      // after a fully parsed, username-matched calendar map.
      const dailyActivity = {
        days: bundle.calendarDays.map((day) => ({
          date: day.occurredAt,
          submissions: day.submissions,
        })),
        complete: !bundle.calendarUnsupported,
      };

      // Chain integer ratings across attended contests, oldest first.
      // Rank is not exposed upstream and stays null rather than guessed.
      let previousRating: number | null = null;
      const contests = bundle.contestHistory.map((entry) => {
        const ratingAfter = entry.ratingAfter === null ? null : Math.round(entry.ratingAfter);
        const ratingBefore = previousRating;
        if (ratingAfter !== null) previousRating = ratingAfter;
        return {
          externalId: `lc-${entry.titleSlug}`,
          name: entry.title,
          contestedAt: entry.contestedAt,
          ratingBefore,
          ratingChange:
            ratingAfter !== null && ratingBefore !== null ? ratingAfter - ratingBefore : null,
          ratingAfter,
          rank: null,
        };
      });

      return {
        canonicalUsername: bundle.username,
        stats: {
          totalSolved: bundle.solved.total,
          contestRating: bundle.contestRating,
          contestsAttended: bundle.contestsAttended,
          currentStreak: null,
          longestStreak: null,
          extra: {
            username: bundle.username,
            realName: bundle.realName,
            avatar: bundle.avatar,
            easySolved: bundle.solved.easy,
            mediumSolved: bundle.solved.medium,
            hardSolved: bundle.solved.hard,
            activityUnsupported: bundle.activityUnsupported,
            calendarUnsupported: bundle.calendarUnsupported,
            calendarActiveDays: bundle.calendarDays.length,
            source: "best-effort-graphql",
          },
        },
        activities: bundle.recentSubmissions.map((s) => ({
          externalId: `lc-${s.id}`,
          type: "PROBLEM_SOLVED" as const,
          problemId: s.titleSlug,
          difficulty: null,
          occurredAt: s.occurredAt,
        })),
        dailyActivity,
        contests,
      };
    },
  };
}
