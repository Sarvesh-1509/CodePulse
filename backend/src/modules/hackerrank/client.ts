import { z } from "zod";
import { fetchUpstream } from "../platforms/http";
import {
  invalidResponse,
  profileNotFound,
} from "../platforms/errors";

/**
 * HackerRank adapter data source (Module 8) — BEST EFFORT, explicitly NOT official.
 *
 * HackerRank offers no public profile API, so this adapter reads the public
 * profile page (`https://www.hackerrank.com/profile/{username}`) with a
 * single plain GET and decodes the embedded `#initialData` JSON document
 * (URL-encoded), using the `community.viewProfiles.{username}` model —
 * the same data the page itself renders (badges, domain scores, contest
 * totals). Consequences, handled here:
 *
 * - No login, no auth bypass, no CAPTCHA solving, no credentials. One
 *   request per fetch; a single retry on transient failures only.
 * - Unknown usernames return HTTP 200 WITHOUT the data document, so the
 *   verification gate is the presence of `viewProfiles[username]` with a
 *   matching `username` field — never the status code.
 * - Every field is optional and validated; drift fails closed.
 * - Domain points are SCORES, not ratings: they live labeled in extras,
 *   never in `contestRating`. Per-badge solved counts overlap across
 *   badges, so no total is summed — `totalSolved` stays null.
 * - `recentChallenges`/`submissionHistory` carry no reliable timestamps in
 *   the observed payloads, so HackerRank produces no activity events and
 *   no contest records. Absence is reported, never filled in.
 */

export const HACKERRANK_PROFILE_BASE = "https://www.hackerrank.com/profile/";

export interface HackerrankHttpDeps {
  timeoutMs: number;
}

export interface HackerrankBadge {
  name: string;
  stars: number | null;
  solved: number | null;
  points: number | null;
}

export interface HackerrankDomainScore {
  slug: string;
  name: string;
  score: number | null;
  rank: number | null;
}

export interface HackerrankProfileBundle {
  username: string;
  displayName: string | null;
  country: string | null;
  level: number | null;
  followersCount: number | null;
  badges: HackerrankBadge[];
  domains: HackerrankDomainScore[];
  contestsAttended: number | null;
  contestTotal: number | null;
}

const badgeSchema = z
  .object({
    badge_name: z.string(),
    stars: z.number().optional(),
    solved: z.number().optional(),
    current_points: z.number().optional(),
  })
  .passthrough();

const domainScoreSchema = z
  .object({
    slug: z.string().optional(),
    name: z.string(),
    practice: z
      .object({ score: z.number().optional(), rank: z.number().optional() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const viewProfileSchema = z
  .object({
    username: z.string(),
    name: z.string().optional(),
    country: z.string().optional(),
    level: z.number().optional(),
    followers_count: z.number().optional(),
    badges: z.array(badgeSchema).optional(),
    scores: z.record(z.unknown()).optional(),
    contestHistory: z
      .object({ total: z.number().optional() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

function asInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractInitialData(html: string): unknown {
  const m = /<script type="application\/json" id="initialData">\s*([\s\S]*?)\s*<\/script>/.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(decodeURIComponent(m[1]));
  } catch {
    return null;
  }
}

const MAX_BADGES = 10;
const MAX_DOMAINS = 12;

export async function fetchHackerrankProfile(
  username: string,
  deps: HackerrankHttpDeps
): Promise<HackerrankProfileBundle> {
  // Fixed trusted base; the handle travels as an encoded path segment only.
  const url = `${HACKERRANK_PROFILE_BASE}${encodeURIComponent(username)}`;
  const res = await fetchUpstream(url, { timeoutMs: deps.timeoutMs, maxRetries: 1 });
  const html = await res.text();

  const doc = extractInitialData(html);
  const viewProfiles =
    doc !== null && typeof doc === "object" && !Array.isArray(doc)
      ? (doc as { community?: unknown }).community
      : null;
  const profiles =
    viewProfiles !== null && typeof viewProfiles === "object"
      ? (viewProfiles as { viewProfiles?: unknown }).viewProfiles
      : null;
  if (profiles === null || typeof profiles !== "object" || Array.isArray(profiles)) {
    throw profileNotFound(`HackerRank user "${username}" was not found.`);
  }

  const key = Object.keys(profiles as Record<string, unknown>).find(
    (k) => k.toLowerCase() === username.toLowerCase()
  );
  const raw = key !== undefined ? (profiles as Record<string, unknown>)[key] : undefined;
  const parsed = raw === undefined ? null : viewProfileSchema.safeParse(raw);
  if (!parsed || !parsed.success) {
    throw profileNotFound(`HackerRank user "${username}" was not found.`);
  }
  const profile = parsed.data;
  if (profile.username.toLowerCase() !== username.toLowerCase()) {
    throw profileNotFound(`HackerRank user "${username}" was not found.`);
  }

  const badges: HackerrankBadge[] = (profile.badges ?? []).slice(0, MAX_BADGES).map((b) => ({
    name: b.badge_name,
    stars: asInt(b.stars),
    solved: asInt(b.solved),
    // Points keep their decimals: truncating would misreport the value.
    points: asNumber(b.current_points),
  }));

  const domains: HackerrankDomainScore[] = [];
  if (profile.scores && typeof profile.scores === "object") {
    for (const [slug, entry] of Object.entries(profile.scores)) {
      if (domains.length >= MAX_DOMAINS) break;
      const d = domainScoreSchema.safeParse({ slug, ...(entry as object) });
      if (!d.success) continue;
      domains.push({
        slug,
        name: d.data.name,
        score: asNumber(d.data.practice?.score),
        rank: asInt(d.data.practice?.rank),
      });
    }
  }

  const contestTotal = asInt(profile.contestHistory?.total);

  return {
    username: profile.username,
    displayName: profile.name ?? null,
    country: profile.country ?? null,
    level: asInt(profile.level),
    followersCount: asInt(profile.followers_count),
    badges,
    domains,
    contestsAttended: contestTotal,
    contestTotal,
  };
}
