import { z } from "zod";
import { fetchUpstream, parseJsonSafe } from "../platforms/http";
import {
  invalidResponse,
  profileNotFound,
} from "../platforms/errors";

/**
 * LeetCode profile adapter (Module 5) — BEST EFFORT, explicitly NOT official.
 *
 * LeetCode offers no broadly supported official public profile API, so this
 * adapter uses the same public GraphQL endpoint the LeetCode website itself
 * calls. That endpoint is undocumented, may change without notice, requires
 * browser-like headers, and is rate-limited. Consequences, handled here:
 *
 * - Every response is validated at runtime; shape drift fails closed with a
 *   clear error instead of fabricated data.
 * - Each data selection (profile / stats / contest / recent activity /
 *   calendar / contest history) degrades independently: a drifting optional
 *   selection yields nulls and empties, never zeros, while the verified
 *   profile still syncs.
 * - Transient failures (timeout / network / rate limit / 5xx) abort the
 *   whole fetch so the service preserves the last known good statistics.
 * - Three bounded sequential requests per fetch (profile, calendar,
 *   contest history); no retries on 4xx or shape errors.
 * - No scraping, no auth bypass, no credentials: only public profile data.
 */

export const LEETCODE_GRAPHQL_URL = "https://leetcode.com/graphql";
export const LEETCODE_REFERER = "https://leetcode.com";
/**
 * Bounded recent-AC window. The upstream field accepts no cursor and caps
 * results server-side (verified live: limit 50/100 still returns 20), so
 * per-problem events genuinely cover only this window. Daily activity and
 * contest history come from the calendar/history selections below instead.
 */
export const LEETCODE_RECENT_LIMIT = 20;
/**
 * Sanity cap on submissions attributed to a single calendar day. Real
 * calendars stay far below this; it only bounds corrupt-data expansion
 * (one row is stored per submission, so an absurd count must not explode
 * the import). Excess beyond the cap is dropped, never invented elsewhere.
 */
export const LEETCODE_MAX_SUBMISSIONS_PER_DAY = 1000;
/** Earliest plausible LeetCode activity (platform launched 2015, margin kept). */
export const LEETCODE_EARLIEST_DAY_MS = Date.UTC(2013, 0, 1);

export interface LeetCodeHttpDeps {
  timeoutMs: number;
}

const PROFILE_QUERY = `
  query leetcodeProfile($username: String!) {
    matchedUser(username: $username) {
      username
      profile { realName userAvatar }
      submitStatsGlobal { acSubmissionNum { difficulty count } }
    }
    userContestRanking(username: $username) {
      attendedContestsCount
      rating
    }
    recentAcSubmissionList(username: $username, limit: ${LEETCODE_RECENT_LIMIT}) {
      id
      title
      titleSlug
      timestamp
    }
  }
`;

/**
 * Complete daily submission history. `submissionCalendar` is a JSON-encoded
 * map of UTC day-start epoch seconds to that day's submission count,
 * spanning every active year. Counts cover ALL submissions (any verdict),
 * so days become SUBMISSION events with no problem attribution — never
 * PROBLEM_SOLVED rows, which require a verified accepted problem id.
 */
const CALENDAR_QUERY = `
  query leetcodeCalendar($username: String!) {
    matchedUser(username: $username) {
      username
      userCalendar {
        activeYears
        streak
        totalActiveDays
        submissionCalendar
      }
    }
  }
`;

/**
 * Full attended contest history (oldest available first upstream, sorted
 * again locally by startTime before chaining ratings). Unattended entries
 * carry no participation and are skipped, never stored.
 */
const CONTEST_HISTORY_QUERY = `
  query leetcodeContestHistory($username: String!) {
    userContestRankingHistory(username: $username) {
      attended
      rating
      trendDirection
      contest { title titleSlug startTime }
    }
  }
`;

const acEntrySchema = z
  .object({ difficulty: z.string(), count: z.number() })
  .passthrough();

const matchedUserSchema = z
  .object({
    username: z.string(),
    profile: z
      .object({ realName: z.string().optional(), userAvatar: z.string().optional() })
      .passthrough()
      .nullable()
      .optional(),
    submitStatsGlobal: z
      .object({ acSubmissionNum: z.array(acEntrySchema).optional() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const contestRankingSchema = z
  .object({
    attendedContestsCount: z.number().int().optional(),
    rating: z.number().optional(),
  })
  .passthrough();

const recentSubmissionSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    titleSlug: z.string(),
    timestamp: z.string(),
  })
  .passthrough();

const responseSchema = z
  .object({
    data: z
      .object({
        matchedUser: matchedUserSchema.nullable().optional(),
        userContestRanking: contestRankingSchema.nullable().optional(),
        // Unknown first: a drifted non-array value must degrade the
        // activity selection, not fail the entire response validation.
        recentAcSubmissionList: z.unknown().nullable().optional(),
      })
      .passthrough()
      .nullable(),
  })
  .passthrough();

export interface LeetCodeSolvedSplits {
  total: number | null;
  easy: number | null;
  medium: number | null;
  hard: number | null;
}

export interface LeetCodeRecentSubmission {
  id: string;
  titleSlug: string;
  occurredAt: Date;
}

export interface LeetCodeCalendarDay {
  /** UTC midnight of an active day; the count is that day's submissions. */
  occurredAt: Date;
  submissions: number;
}

export interface LeetCodeContestEntry {
  title: string;
  titleSlug: string;
  contestedAt: Date;
  /** Post-contest rating; null when upstream omits it (never guessed). */
  ratingAfter: number | null;
}

export interface LeetCodeProfileBundle {
  username: string;
  realName: string | null;
  avatar: string | null;
  solved: LeetCodeSolvedSplits;
  contestsAttended: number | null;
  contestRating: number | null;
  recentSubmissions: LeetCodeRecentSubmission[];
  /** True when the activity selection drifted; detailed activity unsupported. */
  activityUnsupported: boolean;
  /** Complete daily submission history from the submission calendar. */
  calendarDays: LeetCodeCalendarDay[];
  /** True when the calendar selection drifted; daily history unsupported. */
  calendarUnsupported: boolean;
  /** Attended contests, oldest first (ratings chained locally). */
  contestHistory: LeetCodeContestEntry[];
}

function asInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const calendarSchema = z
  .object({
    activeYears: z.array(z.number()).optional(),
    streak: z.number().optional(),
    totalActiveDays: z.number().optional(),
    submissionCalendar: z.string().optional(),
  })
  .passthrough();

const calendarResponseSchema = z
  .object({
    data: z
      .object({
        matchedUser: z
          .object({
            username: z.string(),
            // Unknown first (same rule as recentAcSubmissionList): a
            // drifted calendar must degrade to unsupported, not fail the
            // whole response validation. Content is validated separately.
            userCalendar: z.unknown().nullable().optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
      })
      .passthrough()
      .nullable(),
  })
  .passthrough();

/**
 * Parse the submission-calendar map into validated active days. Keys are
 * UTC day-start epoch seconds; values are that day's submission counts.
 * Corrupt entries are skipped individually; only a structurally drifted
 * calendar (present but unusable) marks history unsupported.
 */
function parseCalendarDays(
  raw: unknown
): { days: LeetCodeCalendarDay[]; unsupported: boolean } {
  if (raw === null || raw === undefined) return { days: [], unsupported: false };
  const parsed = calendarSchema.safeParse(raw);
  if (!parsed.success) return { days: [], unsupported: true };
  const encoded = parsed.data.submissionCalendar;
  if (typeof encoded !== "string" || encoded === "") {
    return { days: [], unsupported: false };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(encoded);
  } catch {
    return { days: [], unsupported: true };
  }
  if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) {
    return { days: [], unsupported: true };
  }
  const nowLimit = Date.now() + 86_400_000;
  const days: LeetCodeCalendarDay[] = [];
  for (const [key, value] of Object.entries(decoded)) {
    const dayMs = Number(key) * 1000;
    const count = typeof value === "number" ? Math.trunc(value) : NaN;
    if (!Number.isFinite(dayMs) || dayMs < LEETCODE_EARLIEST_DAY_MS || dayMs > nowLimit) continue;
    if (!Number.isInteger(count) || count < 1) continue;
    days.push({
      occurredAt: new Date(dayMs),
      submissions: Math.min(count, LEETCODE_MAX_SUBMISSIONS_PER_DAY),
    });
  }
  days.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  return { days, unsupported: false };
}

const contestHistoryEntrySchema = z
  .object({
    attended: z.boolean().optional(),
    rating: z.number().nullish(),
    contest: z
      .object({
        title: z.string(),
        titleSlug: z.string(),
        startTime: z.number(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const contestHistoryResponseSchema = z
  .object({
    data: z
      .object({
        // Unknown first: drift must degrade the selection, not the sync.
        userContestRankingHistory: z.unknown().nullable().optional(),
      })
      .passthrough()
      .nullable(),
  })
  .passthrough();

/**
 * Keep attended contests with a usable contest block, oldest first.
 * Unattended rows are not participation and are skipped; entries missing
 * their contest block or startTime are skipped, never fabricated.
 */
function parseContestHistory(raw: unknown): LeetCodeContestEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: LeetCodeContestEntry[] = [];
  for (const item of raw) {
    const parsed = contestHistoryEntrySchema.safeParse(item);
    if (!parsed.success) continue;
    const e = parsed.data;
    if (e.attended !== true) continue;
    const contest = e.contest;
    if (!contest || !Number.isFinite(contest.startTime)) continue;
    entries.push({
      title: contest.title,
      titleSlug: contest.titleSlug,
      contestedAt: new Date(Math.trunc(contest.startTime) * 1000),
      ratingAfter: asFiniteNumber(e.rating),
    });
  }
  entries.sort((a, b) => a.contestedAt.getTime() - b.contestedAt.getTime());
  return entries;
}

async function postGraphql(
  operationName: string,
  query: string,
  username: string,
  deps: LeetCodeHttpDeps
): Promise<unknown> {
  const res = await fetchUpstream(LEETCODE_GRAPHQL_URL, {
    timeoutMs: deps.timeoutMs,
    maxRetries: 2,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "CodePulse/0.1 (profile sync)",
        Referer: LEETCODE_REFERER,
        Origin: LEETCODE_REFERER,
      },
      body: JSON.stringify({ query, variables: { username }, operationName }),
    },
  });
  return parseJsonSafe(res);
}

export async function fetchLeetCodeProfile(
  username: string,
  deps: LeetCodeHttpDeps
): Promise<LeetCodeProfileBundle> {
  // Fixed trusted endpoint; the username travels in the POST body only.
  // Three sequential selections (profile, calendar, contest history):
  // sequential, not parallel, to stay gentle on upstream rate limits.
  const json = await postGraphql("leetcodeProfile", PROFILE_QUERY, username, deps);
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success || !parsed.data.data) {
    throw invalidResponse(
      "LeetCode returned an unreadable response. The integration may have changed."
    );
  }
  const data = parsed.data.data;

  // Verification gate: no matched user, or a mismatched one, rejects.
  if (!data.matchedUser || typeof data.matchedUser.username !== "string") {
    throw profileNotFound(`LeetCode user "${username}" was not found.`);
  }
  if (data.matchedUser.username.toLowerCase() !== username.toLowerCase()) {
    throw profileNotFound(`LeetCode user "${username}" was not found.`);
  }

  // Optional selections degrade independently (nulls, never zeros).
  let solved: LeetCodeSolvedSplits = { total: null, easy: null, medium: null, hard: null };
  const acList = data.matchedUser.submitStatsGlobal?.acSubmissionNum;
  if (Array.isArray(acList)) {
    const byDifficulty = new Map<string, number>();
    for (const entry of acList) {
      const count = asInt(entry.count);
      if (count !== null) byDifficulty.set(entry.difficulty, count);
    }
    const easy = byDifficulty.get("Easy") ?? null;
    const medium = byDifficulty.get("Medium") ?? null;
    const hard = byDifficulty.get("Hard") ?? null;
    const total = byDifficulty.get("All") ?? null;
    solved = {
      total: total ?? (easy !== null || medium !== null || hard !== null
        ? (easy ?? 0) + (medium ?? 0) + (hard ?? 0)
        : null),
      easy,
      medium,
      hard,
    };
  }

  const contest = data.userContestRanking ?? null;
  const contestsAttended = contest ? (asInt(contest.attendedContestsCount) ?? null) : null;
  const contestRating = contest ? (asFiniteNumber(contest.rating) ?? null) : null;

  let recentSubmissions: LeetCodeRecentSubmission[] = [];
  let activityUnsupported = false;
  const recentRaw = data.recentAcSubmissionList;
  if (Array.isArray(recentRaw)) {
    for (const raw of recentRaw) {
      const item = recentSubmissionSchema.safeParse(raw);
      if (!item.success) continue;
      const millis = Number(item.data.timestamp) * 1000;
      if (!Number.isFinite(millis)) continue;
      recentSubmissions.push({
        id: item.data.id,
        titleSlug: item.data.titleSlug,
        occurredAt: new Date(millis),
      });
    }
  } else if (recentRaw !== null && recentRaw !== undefined) {
    // Selection present but structurally drifted: mark detailed activity
    // unsupported rather than failing the whole sync or inventing data.
    activityUnsupported = true;
  }
  // Note: a null recentAcSubmissionList (no recent public activity) simply
  // yields zero events — also honest, no fabrication either way.

  // Full daily history and contest history ride separate selections because
  // the recent-submission window cannot paginate. They run only after the
  // verification gate above, so invalid usernames cost one request, not
  // three. Any transient failure here aborts the whole fetch (same rule as
  // the profile selection) so a partial sync never masquerades as complete.
  const calendarJson = await postGraphql("leetcodeCalendar", CALENDAR_QUERY, username, deps);
  const calendarParsed = calendarResponseSchema.safeParse(calendarJson);
  let calendar: { days: LeetCodeCalendarDay[]; unsupported: boolean };
  if (!calendarParsed.success) {
    // Unreadable calendar response: history presence cannot be determined.
    calendar = { days: [], unsupported: true };
  } else {
    const calendarUser = calendarParsed.data.data?.matchedUser ?? null;
    if (calendarUser === null) {
      calendar = { days: [], unsupported: false };
    } else if (calendarUser.username.toLowerCase() !== username.toLowerCase()) {
      // Identity fail-closed: another user's days are never imported.
      calendar = { days: [], unsupported: false };
    } else {
      calendar = parseCalendarDays(calendarUser.userCalendar ?? null);
    }
  }

  const historyJson = await postGraphql(
    "leetcodeContestHistory",
    CONTEST_HISTORY_QUERY,
    username,
    deps
  );
  const historyParsed = contestHistoryResponseSchema.safeParse(historyJson);
  const contestHistory =
    historyParsed.success && historyParsed.data.data
      ? parseContestHistory(historyParsed.data.data.userContestRankingHistory ?? null)
      : [];

  return {
    username: data.matchedUser.username,
    realName: data.matchedUser.profile?.realName ?? null,
    avatar: data.matchedUser.profile?.userAvatar ?? null,
    solved,
    contestsAttended,
    contestRating,
    recentSubmissions,
    activityUnsupported,
    calendarDays: calendar.days,
    calendarUnsupported: calendar.unsupported,
    contestHistory,
  };
}
