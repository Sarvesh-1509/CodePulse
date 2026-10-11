import type {
  FetchOptions,
  PlatformAdapter,
  SyncBundle,
} from "../platforms/adapters";
import { fetchGeeksforgeeksProfile, type GeeksforgeeksHttpDeps } from "./client";

/**
 * GeeksforGeeks adapter (Module 7): maps the best-effort profile bundle to
 * a normalized sync bundle.
 *
 * Honesty rules enforced here:
 * - `score` is GFG's coding SCORE, surfaced as `extra.score` labeled
 *   "Coding score" upstream — it is never placed in `contestRating`.
 * - `totalSolved` is GFG's own total; missing stays null.
 * - Problem-of-the-Day streaks are a different metric from coding streaks
 *   and stay labeled in extras; the streak columns remain null so no future
 *   unified-streak logic can mistake them.
 * - No contests, no activity events: the source exposes no contest history
 *   and no per-problem timestamps, and dates are never inferred.
 */
export interface GeeksforgeeksAdapterDeps extends GeeksforgeeksHttpDeps {}

const PROFILE_URL_BASE = "https://www.geeksforgeeks.org/user/";

export function createGeeksforgeeksAdapter(
  deps: GeeksforgeeksAdapterDeps
): PlatformAdapter {
  return {
    platform: "GEEKSFORGEEKS",
    async fetchAll(username: string, _options?: FetchOptions): Promise<SyncBundle> {
      const bundle = await fetchGeeksforgeeksProfile(username, deps);
      return {
        canonicalUsername: bundle.username,
        stats: {
          totalSolved: bundle.totalSolved,
          contestRating: null,
          contestsAttended: null,
          currentStreak: null,
          longestStreak: null,
          extra: {
            username: bundle.username,
            displayName: bundle.displayName,
            score: bundle.score,
            monthlyScore: bundle.monthlyScore,
            instituteRank: bundle.instituteRank,
            podCurrentStreak: bundle.podCurrentStreak,
            podLongestStreak: bundle.podLongestStreak,
            profileUrl: `${PROFILE_URL_BASE}${encodeURIComponent(bundle.username)}/`,
            source: "best-effort-profile-page",
          },
        },
        activities: [],
        contests: [],
      };
    },
  };
}
