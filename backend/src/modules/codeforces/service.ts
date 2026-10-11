import type {
  FetchOptions,
  NormalizedActivity,
  NormalizedContest,
  PlatformAdapter,
  SyncBundle,
} from "../platforms/adapters";
import {
  assertValidHandle,
  fetchAllSubmissions,
  fetchContestHistory,
  fetchUserProfile,
  type CodeforcesHttpDeps,
} from "./client";

/**
 * Codeforces adapter (Module 4): maps official API data to normalized sync
 * bundles. Verification = successful user.info lookup (the handle exists and
 * is retrievable — not proof of ownership).
 *
 * Statistics limitations (documented, not hidden):
 * - `totalSolved` counts unique problems with a final OK verdict, keyed by
 *   contestId+index. If the bounded import hit its page cap, the count is a
 *   lower bound and `truncated` is set in stats.extra.
 * - `contestsAttended` counts rated participations from user.rating.
 * - Streaks are unsupported (null) — Codeforces exposes no streak API.
 */
export interface CodeforcesAdapterDeps extends CodeforcesHttpDeps {}

export function problemKey(
  contestId: number | null,
  index: string,
  name: string
): string {
  return contestId !== null && Number.isFinite(contestId)
    ? `${contestId}${index}`
    : `ps-${index}-${name}`;
}

export function createCodeforcesAdapter(
  deps: CodeforcesAdapterDeps
): PlatformAdapter {
  return {
    platform: "CODEFORCES",
    async fetchAll(username: string, options?: FetchOptions): Promise<SyncBundle> {
      assertValidHandle(username);

      // Verification gate FIRST: a bogus handle must deterministically
      // become not-found. (Codeforces answers unknown handles with HTTP 400
      // on some endpoints and 200+FAILED on others; racing all three made
      // the error flaky.) Enrichment fetches run only for verified handles.
      const profile = await fetchUserProfile(username, deps);
      const [contests, submissionResult] = await Promise.all([
        fetchContestHistory(username, deps),
        fetchAllSubmissions(username, { ...deps, sinceId: options?.sinceId }),
      ]);

      const solvedKeys = new Set<string>();
      const activities: NormalizedActivity[] = [];
      for (const s of submissionResult.submissions) {
        // Only final accepted verdicts count as solved. Anything else
        // (WRONG_ANSWER, TIME_LIMIT_EXCEEDED, ...) is practice, not a solve.
        if (s.verdict !== "OK") continue;
        const key = problemKey(s.problemContestId, s.problemIndex, s.problemName);
        solvedKeys.add(key);
        activities.push({
          externalId: `cf-${s.id}`,
          type: "PROBLEM_SOLVED",
          problemId: key,
          difficulty:
            s.problemRating !== null ? String(s.problemRating) : null,
          occurredAt: s.occurredAt,
        });
      }

      const contestDtos: NormalizedContest[] = contests.map((c) => ({
        externalId: `cf-${c.contestId}`,
        name: c.contestName,
        contestedAt: c.contestedAt,
        ratingBefore: c.oldRating,
        ratingChange: c.newRating - c.oldRating,
        ratingAfter: c.newRating,
        rank: c.rank,
      }));

      return {
        canonicalUsername: profile.handle,
        stats: {
          totalSolved: solvedKeys.size,
          contestRating: profile.rating,
          contestsAttended: contests.length,
          currentStreak: null,
          longestStreak: null,
          extra: {
            handle: profile.handle,
            rank: profile.rank,
            maxRank: profile.maxRank,
            maxRating: profile.maxRating,
            truncated: submissionResult.truncated,
          },
          truncated: submissionResult.truncated,
        },
        activities,
        contests: contestDtos,
      };
    },
  };
}
