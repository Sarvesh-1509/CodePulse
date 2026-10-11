import type {
  FetchOptions,
  PlatformAdapter,
  SyncBundle,
} from "../platforms/adapters";
import { fetchCodechefProfile, type CodechefHttpDeps } from "./client";

/**
 * CodeChef adapter (Module 6): maps the best-effort profile page bundle to
 * a normalized sync bundle.
 *
 * Honesty rules enforced here:
 * - The native CodeChef rating stays in `contestRating`; stars, division,
 *   and ranks are labeled extras — never confused with the rating itself.
 * - `totalSolved` is CodeChef's own "Total Problems Solved" aggregate, not
 *   a count of submissions. Missing stays null.
 * - Contest history comes from the embedded `all_rating` array; rating
 *   changes are chained chronologically (previous entry's rating), with
 *   nulls wherever a link in the chain is missing.
 * - No activity events: the source exposes no per-problem timestamps, and
 *   solving dates are never inferred from aggregates.
 */
export interface CodechefAdapterDeps extends CodechefHttpDeps {}

const PROFILE_URL_BASE = "https://www.codechef.com/users/";

export function createCodechefAdapter(deps: CodechefAdapterDeps): PlatformAdapter {
  return {
    platform: "CODECHEF",
    async fetchAll(username: string, _options?: FetchOptions): Promise<SyncBundle> {
      const bundle = await fetchCodechefProfile(username, deps);
      return {
        canonicalUsername: bundle.username,
        stats: {
          totalSolved: bundle.totalSolved,
          contestRating: bundle.rating,
          contestsAttended: bundle.contests.length,
          currentStreak: null,
          longestStreak: null,
          extra: {
            username: bundle.username,
            division: bundle.division,
            stars: bundle.stars,
            maxRating: bundle.maxRating,
            globalRank: bundle.globalRank,
            countryRank: bundle.countryRank,
            profileUrl: `${PROFILE_URL_BASE}${encodeURIComponent(bundle.username)}`,
            source: "best-effort-profile-page",
          },
        },
        activities: [],
        contests: bundle.contests.map((c, index, list) => {
          const previous = index > 0 ? list[index - 1].rating : null;
          return {
            externalId: `cc-${c.code}`,
            name: c.name,
            contestedAt: c.contestedAt,
            ratingBefore: previous,
            ratingChange:
              previous !== null && c.rating !== null ? c.rating - previous : null,
            ratingAfter: c.rating,
            rank: c.rank,
          };
        }),
      };
    },
  };
}
