import { z } from "zod";
import { fetchUpstream } from "../platforms/http";
import {
  invalidResponse,
  profileNotFound,
} from "../platforms/errors";

/**
 * CodeChef adapter data source (Module 6) — BEST EFFORT, explicitly NOT official.
 *
 * CodeChef offers no public profile API usable without OAuth client
 * credentials, so this adapter reads the public profile page
 * (`https://www.codechef.com/users/{handle}`) with a single plain GET and
 * parses its server-rendered profile header plus the embedded `all_rating`
 * contest-history array. Consequences, handled here:
 *
 * - No login, no auth bypass, no CAPTCHA solving, no credentials: only the
 *   same public page any browser receives. One request per fetch; gentle
 *   retry policy (a single retry on transient failures only).
 * - Every extracted field is validated; markup drift fails closed with a
 *   clear error instead of fabricated data.
 * - Verification = final URL stays under /users/ AND the profile header
 *   marker is present AND its canonical username matches (case-insensitive).
 *   Unknown handles redirect to the homepage, which has no markers.
 * - No per-problem timestamps exist in this source, so CodeChef never
 *   produces activity events — only profile stats + contest history.
 */

export const CODECHEF_PROFILE_BASE = "https://www.codechef.com/users/";

export interface CodechefHttpDeps {
  timeoutMs: number;
}

export interface CodechefContestEntry {
  code: string;
  name: string;
  contestedAt: Date;
  rating: number | null;
  rank: number | null;
}

export interface CodechefProfileBundle {
  username: string;
  rating: number | null;
  maxRating: number | null;
  division: string | null;
  stars: number | null;
  globalRank: number | null;
  countryRank: number | null;
  totalSolved: number | null;
  contests: CodechefContestEntry[];
}

const ratingEntrySchema = z.object({
  code: z.string(),
  name: z.string(),
  end_date: z.string(),
  rating: z.union([z.string(), z.number()]),
  rank: z.union([z.string(), z.number()]),
});

function parseIntOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value === "string") {
    const n = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  return null;
}

function firstGroup(html: string, pattern: RegExp): string | null {
  const m = pattern.exec(html);
  return m ? m[1].trim() : null;
}

/**
 * CodeChef publishes `end_date` as "YYYY-MM-DD HH:mm:ss" with no timezone.
 * Interpreted as UTC and documented as an assumption (display/order
 * precision only; off by at most hours, never fabricated).
 */
function parseEndDate(raw: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const date = new Date(
    Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
  );
  return Number.isFinite(date.getTime()) ? date : null;
}

export async function fetchCodechefProfile(
  username: string,
  deps: CodechefHttpDeps
): Promise<CodechefProfileBundle> {
  // Fixed trusted base; the handle travels as an encoded path segment only.
  const url = `${CODECHEF_PROFILE_BASE}${encodeURIComponent(username)}`;
  const res = await fetchUpstream(url, { timeoutMs: deps.timeoutMs, maxRetries: 1 });
  const html = await res.text();

  // Unknown handles redirect to the homepage: when the final URL is known
  // (real fetches always set it), it must still point at a /users/ page.
  // (Stubbed Responses in tests carry an empty url; marker checks decide.)
  let onProfilePage = true;
  let finalSlug: string | null = null;
  try {
    const pathname = new URL(res.url).pathname.toLowerCase();
    onProfilePage = pathname.startsWith("/users/");
    const match = /^\/users\/([^/]+)\/?$/.exec(pathname);
    finalSlug = match ? decodeURIComponent(match[1]) : null;
  } catch {
    onProfilePage = true;
    finalSlug = null;
  }
  if (!onProfilePage) {
    throw profileNotFound(`CodeChef user "${username}" was not found.`);
  }
  const canonical = firstGroup(html, /m-username--link['"]?\s*>([^<]+)</);
  if (canonical === null) {
    throw profileNotFound(`CodeChef user "${username}" was not found.`);
  }
  if (canonical.toLowerCase() !== username.toLowerCase()) {
    // Accept only platform-side alias redirects (e.g. /users/tourist lands
    // on another handle's profile): the final slug must differ from what
    // was requested, proving CodeChef itself resolved the alias.
    const redirected =
      finalSlug !== null && finalSlug.toLowerCase() !== username.toLowerCase();
    if (!redirected) {
      throw profileNotFound(`CodeChef user "${username}" was not found.`);
    }
  }

  const rating = parseIntOrNull(
    firstGroup(html, /<div class="rating-number">\s*([^<]+?)\s*</)
  );
  const maxRating = parseIntOrNull(firstGroup(html, /\(Highest Rating\s*([^)]+)\)/));
  const division = firstGroup(html, /<div>\(Div\s*([^)]+)\)<\/div>/) ?? null;
  const starBlock = firstGroup(html, /<div class="rating-star">([\s\S]*?)<\/div>/);
  const stars = starBlock !== null ? (starBlock.match(/&#9733;|★/g) ?? []).length : null;

  const rankOf = (label: "Global Rank" | "Country Rank"): number | null => {
    const raw = firstGroup(
      html,
      new RegExp(`<strong>\\s*([^<]+?)\\s*</strong>\\s*</a>\\s*${label}`)
    );
    return raw === null ? null : parseIntOrNull(raw);
  };

  const totalSolved = parseIntOrNull(
    firstGroup(html, /Total Problems Solved:\s*([\d,]+)/)
  );

  // Contest history: embedded `var all_rating = [...];` (chronological).
  const contests: CodechefContestEntry[] = [];
  const historyRaw = firstGroup(html, /var all_rating = (\[[\s\S]*?\]);/);
  if (historyRaw !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(historyRaw);
    } catch {
      throw invalidResponse(
        "CodeChef returned an unreadable response. The integration may have changed."
      );
    }
    if (!Array.isArray(parsed)) {
      throw invalidResponse(
        "CodeChef returned an unreadable response. The integration may have changed."
      );
    }
    for (const raw of parsed) {
      const entry = ratingEntrySchema.safeParse(raw);
      if (!entry.success) continue;
      const contestedAt = parseEndDate(entry.data.end_date);
      if (!contestedAt) continue;
      contests.push({
        code: entry.data.code,
        name: entry.data.name,
        contestedAt,
        rating: parseIntOrNull(entry.data.rating),
        rank: parseIntOrNull(entry.data.rank),
      });
    }
    contests.sort((a, b) => a.contestedAt.getTime() - b.contestedAt.getTime());
  }

  return {
    username: canonical,
    rating,
    maxRating,
    division: division ? `Div ${division}` : null,
    stars,
    globalRank: rankOf("Global Rank"),
    countryRank: rankOf("Country Rank"),
    totalSolved,
    contests,
  };
}
