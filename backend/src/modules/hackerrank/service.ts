import type {
  FetchOptions,
  PlatformAdapter,
  SyncBundle,
} from "../platforms/adapters";
import { fetchHackerrankProfile, type HackerrankHttpDeps } from "./client";

/**
 * HackerRank adapter (Module 8): maps the best-effort profile document to
 * a normalized sync bundle.
 *
 * Honesty rules enforced here:
 * - Domain points and badge stars are SCORES, surfaced labeled in extras —
 *   never in `contestRating` (HackerRank exposes no contest rating here).
 * - Per-badge `solved` counts overlap across badges, so no total is summed:
 *   `totalSolved` stays null rather than double-counting.
 * - `contestsAttended` is HackerRank's own contest counter, or null.
 * - No activity events and no contest records: the observed payloads carry
 *   no reliable per-item timestamps, and gaps are never filled in.
 */
export interface HackerrankAdapterDeps extends HackerrankHttpDeps {}

const PROFILE_URL_BASE = "https://www.hackerrank.com/profile/";

export function createHackerrankAdapter(
  deps: HackerrankAdapterDeps
): PlatformAdapter {
  return {
    platform: "HACKERRANK",
    async fetchAll(username: string, _options?: FetchOptions): Promise<SyncBundle> {
      const bundle = await fetchHackerrankProfile(username, deps);
      return {
        canonicalUsername: bundle.username,
        stats: {
          totalSolved: null,
          contestRating: null,
          contestsAttended: bundle.contestsAttended,
          currentStreak: null,
          longestStreak: null,
          extra: {
            username: bundle.username,
            displayName: bundle.displayName,
            country: bundle.country,
            level: bundle.level,
            followersCount: bundle.followersCount,
            badgesCount: bundle.badges.length,
            badges: bundle.badges,
            domains: bundle.domains,
            contestTotal: bundle.contestTotal,
            profileUrl: `${PROFILE_URL_BASE}${encodeURIComponent(bundle.username)}`,
            source: "best-effort-profile-page",
          },
        },
        activities: [],
        contests: [],
      };
    },
  };
}
