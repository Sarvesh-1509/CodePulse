import { z } from "zod";
import { fetchUpstream, parseJsonSafe } from "../platforms/http";
import {
  invalidResponse,
  profileNotFound,
  rateLimited,
  upstreamFailure,
} from "../platforms/errors";

/**
 * Codeforces public API client (Module 4).
 *
 * Uses ONLY official endpoints (https://codeforces.com/api/*):
 * - user.info    → profile + current/max rating + ranks
 * - user.rating  → rated contest history
 * - user.status  → submission history (paged, bounded)
 *
 * No HTML scraping. The base URL is fixed; usernames travel as encoded query
 * parameters, so callers cannot steer requests to arbitrary hosts (SSRF-safe).
 */

export const CODEFORCES_API_BASE = "https://codeforces.com/api";
const SUBMISSIONS_PAGE_SIZE = 1000;
/** Upper bound per sync: 10 pages. Documented, never unbounded. */
export const CODEFORCES_MAX_PAGES = 10;
/** Courtesy delay between paged requests (CF enforces call limits). */
const PAGE_DELAY_MS = 350;
/** Max CF handle length guarded at the registry layer as well. */
const MAX_HANDLE_LENGTH = 24;

export interface CodeforcesHttpDeps {
  timeoutMs: number;
}

// --- Response validation (runtime checks on all untrusted data) ---

const userInfoResultSchema = z
  .object({
    handle: z.string(),
    rating: z.number().int().optional(),
    maxRating: z.number().int().optional(),
    rank: z.string().optional(),
    maxRank: z.string().optional(),
  })
  .passthrough();

const ratingEntrySchema = z
  .object({
    contestId: z.number().int(),
    contestName: z.string(),
    rank: z.number().int(),
    ratingUpdateTimeSeconds: z.number().int(),
    oldRating: z.number().int(),
    newRating: z.number().int(),
  })
  .passthrough();

const submissionSchema = z
  .object({
    id: z.number().int(),
    creationTimeSeconds: z.number().int(),
    verdict: z.string().optional(),
    problem: z
      .object({
        contestId: z.number().int().optional(),
        index: z.string(),
        name: z.string(),
        rating: z.number().int().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const okEnvelope = <T extends z.ZodTypeAny>(result: T) =>
  z.object({ status: z.literal("OK"), result });

const failedEnvelope = z.object({
  status: z.literal("FAILED"),
  comment: z.string().optional(),
});

export interface CodeforcesProfile {
  handle: string;
  rating: number | null;
  maxRating: number | null;
  rank: string | null;
  maxRank: string | null;
}

export interface CodeforcesContestEntry {
  contestId: number;
  contestName: string;
  rank: number;
  contestedAt: Date;
  oldRating: number;
  newRating: number;
}

export interface CodeforcesSubmission {
  id: number;
  occurredAt: Date;
  verdict: string | null;
  problemIndex: string;
  problemName: string;
  problemContestId: number | null;
  problemRating: number | null;
}

function handleCfFailed(comment: string | undefined, handle: string): never {
  const text = comment ?? "";
  // Codeforces uses several not-found wordings across endpoints
  // (user.info, user.status, user.rating) — match them all so bogus
  // handles deterministically become validation errors, never 502s.
  if (
    /user with handle .* not found|handles.*not found|handle: user .* not found/i.test(
      text
    )
  ) {
    throw profileNotFound(`Codeforces handle "${handle}" was not found.`);
  }
  if (/call limit exceeded/i.test(text)) {
    throw rateLimited(
      "Codeforces is rate-limiting requests. Please try again in a minute."
    );
  }
  throw upstreamFailure("Codeforces returned an error. Please try again later.");
}

async function getJson(
  path: string,
  params: Record<string, string>,
  deps: CodeforcesHttpDeps
): Promise<unknown> {
  const query = new URLSearchParams(params).toString();
  const url = `${CODEFORCES_API_BASE}${path}?${query}`;
  // fetchUpstream uses the global fetch; tests swap it via withFetchStub.
  // The URL is always built from the fixed base above.
  // passBadRequestThrough: Codeforces answers unknown handles with HTTP 400
  // carrying the FAILED envelope — the envelope (not the status) decides.
  const res = await fetchUpstream(url, { timeoutMs: deps.timeoutMs, passBadRequestThrough: true });
  return parseJsonSafe(res);
}

/**
 * Test seam: swap the global fetch used by fetchUpstream within `fn`.
 * Production code always uses the real global fetch.
 * (Re-exported here for backward compatibility; prefer platforms/http.)
 */
export async function withFetchStub<T>(
  stub: typeof fetch,
  fn: () => Promise<T>
): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
}

export function assertValidHandle(handle: string): void {
  if (
    handle.length < 3 ||
    handle.length > MAX_HANDLE_LENGTH ||
    !/^[A-Za-z0-9_]+$/.test(handle)
  ) {
    throw profileNotFound(`Codeforces handle "${handle}" was not found.`);
  }
}

export async function fetchUserProfile(
  handle: string,
  deps: CodeforcesHttpDeps
): Promise<CodeforcesProfile> {
  const json = await getJson(
    "/user.info",
    { handles: handle },
    deps
  );
  const failed = failedEnvelope.safeParse(json);
  if (failed.success) throw handleCfFailed(failed.data.comment, handle);

  const parsed = okEnvelope(z.array(userInfoResultSchema).min(1)).safeParse(json);
  if (!parsed.success) {
    throw invalidResponse("Codeforces returned an unexpected profile response.");
  }
  const [user] = parsed.data.result;
  return {
    handle: user.handle,
    rating: user.rating ?? null,
    maxRating: user.maxRating ?? null,
    rank: user.rank ?? null,
    maxRank: user.maxRank ?? null,
  };
}

export async function fetchContestHistory(
  handle: string,
  deps: CodeforcesHttpDeps
): Promise<CodeforcesContestEntry[]> {
  const json = await getJson("/user.rating", { handle }, deps);
  const failed = failedEnvelope.safeParse(json);
  if (failed.success) throw handleCfFailed(failed.data.comment, handle);

  const parsed = okEnvelope(z.array(z.unknown())).safeParse(json);
  if (!parsed.success) {
    throw invalidResponse("Codeforces returned an unexpected contest response.");
  }
  // Per-entry leniency: one malformed entry must not kill the whole sync.
  const entries: CodeforcesContestEntry[] = [];
  for (const raw of parsed.data.result) {
    const entry = ratingEntrySchema.safeParse(raw);
    if (!entry.success) continue;
    const e = entry.data;
    entries.push({
      contestId: e.contestId,
      contestName: e.contestName,
      rank: e.rank,
      contestedAt: new Date(e.ratingUpdateTimeSeconds * 1000),
      oldRating: e.oldRating,
      newRating: e.newRating,
    });
  }
  return entries;
}

export interface SubmissionPage {
  submissions: CodeforcesSubmission[];
  /** True when the API returned a full page (more may exist). */
  hasMore: boolean;
}

async function fetchSubmissionPage(
  handle: string,
  from: number,
  deps: CodeforcesHttpDeps
): Promise<SubmissionPage> {
  const json = await getJson(
    "/user.status",
    { handle, from: String(from), count: String(SUBMISSIONS_PAGE_SIZE) },
    deps
  );
  const failed = failedEnvelope.safeParse(json);
  if (failed.success) throw handleCfFailed(failed.data.comment, handle);

  const parsed = okEnvelope(z.array(z.unknown())).safeParse(json);
  if (!parsed.success) {
    throw invalidResponse("Codeforces returned an unexpected submission response.");
  }
  const submissions: CodeforcesSubmission[] = [];
  for (const raw of parsed.data.result) {
    const s = submissionSchema.safeParse(raw);
    if (!s.success) continue;
    const occurredAt = new Date(s.data.creationTimeSeconds * 1000);
    if (!Number.isFinite(occurredAt.getTime())) continue;
    submissions.push({
      id: s.data.id,
      occurredAt,
      verdict: s.data.verdict ?? null,
      problemIndex: s.data.problem.index,
      problemName: s.data.problem.name,
      problemContestId: s.data.problem.contestId ?? null,
      problemRating:
        typeof s.data.problem.rating === "number" ? s.data.problem.rating : null,
    });
  }
  return {
    submissions,
    hasMore: parsed.data.result.length >= SUBMISSIONS_PAGE_SIZE,
  };
}

export interface SubmissionFetchOptions extends CodeforcesHttpDeps {
  /**
   * Stop after ingesting a page whose smallest id is at or below this value.
   * Relies on user.status returning newest submissions first (observed
   * behavior, not contractual) — the DB uniqueness constraint is the
   * backstop, so over-fetching is harmless and idempotent.
   */
  sinceId?: number;
  maxPages?: number;
}

export interface SubmissionFetchResult {
  submissions: CodeforcesSubmission[];
  /** True when the page cap stopped the import (counts are lower bounds). */
  truncated: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchAllSubmissions(
  handle: string,
  options: SubmissionFetchOptions
): Promise<SubmissionFetchResult> {
  const maxPages = options.maxPages ?? CODEFORCES_MAX_PAGES;
  const all: CodeforcesSubmission[] = [];
  let truncated = false;

  for (let page = 0; page < maxPages; page += 1) {
    if (page > 0) await sleep(PAGE_DELAY_MS);
    const { submissions, hasMore } = await fetchSubmissionPage(
      handle,
      page * SUBMISSIONS_PAGE_SIZE + 1,
      options
    );
    all.push(...submissions);

    if (!hasMore) break;
    if (
      options.sinceId !== undefined &&
      submissions.length > 0 &&
      Math.min(...submissions.map((s) => s.id)) <= options.sinceId
    ) {
      break;
    }
    if (page === maxPages - 1) truncated = true;
  }

  return { submissions: all, truncated };
}
