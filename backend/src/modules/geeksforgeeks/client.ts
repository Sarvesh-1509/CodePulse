import { z } from "zod";
import { fetchUpstream } from "../platforms/http";
import {
  invalidResponse,
  profileNotFound,
} from "../platforms/errors";

/**
 * GeeksforGeeks adapter data source (Module 7) — BEST EFFORT, explicitly
 * NOT official.
 *
 * GFG offers no public profile API, so this adapter reads the public
 * profile page (`https://www.geeksforgeeks.org/user/{slug}/`) with a single
 * plain GET and decodes the embedded profile-stats object (score, monthly
 * score, total solved, institute rank, Problem-of-the-Day streaks). The
 * object is doubly-encoded JSON inside the page, so it is unescaped and
 * parsed as a whole — individual fields are never regex-sliced out of
 * unrelated page regions.
 *
 * Consequences, handled here:
 * - No login, no auth bypass, no CAPTCHA solving, no credentials. One
 *   request per fetch; a single retry on transient failures only.
 * - GFG redirects EVERYTHING (even bogus slugs, always HTTP 200), so the
 *   verification gate is the presence of the stats object itself — bogus
 *   slugs render a shell page without it. A missing object is not-found;
 *   a corrupt one is invalid-response. Both fail closed.
 * - No difficulty splits, contest ratings, or per-problem timestamps exist
 *   in this source: streak columns stay null (POD streaks are a different
 *   metric and live labeled in extras), contests/activity lists stay empty.
 */

export const GEEKSFORGEEKS_PROFILE_BASE = "https://www.geeksforgeeks.org/user/";

export interface GeeksforgeeksHttpDeps {
  timeoutMs: number;
}

export interface GeeksforgeeksProfileBundle {
  username: string;
  displayName: string | null;
  /** Overall coding score. A score, NOT a rating — labeled as such upstream. */
  score: number | null;
  monthlyScore: number | null;
  totalSolved: number | null;
  instituteRank: string | null;
  podCurrentStreak: number | null;
  podLongestStreak: number | null;
}

/**
 * GFG serializes absent profile fields as JSON null (observed in the wild:
 * e.g. `"designation":null` inside this very object), so every optional
 * field is nullish. Null normalizes to null downstream via asInt/nonEmpty
 * — identical to a missing key, never to zero or a fabricated value.
 *
 * `institute_rank` is polymorphic upstream: a string (`"42"`, `""`) on some
 * profiles and a bare number (`190`) on others (verified live 2026-10-11:
 * user `santhoshau1fy` carries `"institute_rank":190`, which the old
 * string-only schema rejected with invalid-response/HTTP 502). Both shapes
 * normalize to a display string; anything else stays a validation failure.
 */
const profileObjectSchema = z
  .object({
    name: z.string().nullish(),
    score: z.number().nullish(),
    monthly_score: z.number().nullish(),
    total_problems_solved: z.number().nullish(),
    institute_rank: z.union([z.string(), z.number()]).nullish(),
    pod_solved_current_streak: z.number().nullish(),
    pod_solved_longest_streak: z.number().nullish(),
  })
  .passthrough();

type ValidatedStats = z.infer<typeof profileObjectSchema>;

function asInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Institute rank arrives as a string, a bare number, null, or missing. */
function rankToString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return nonEmpty(value);
}

/**
 * The stats object is embedded doubly-encoded (`{\"key\":...}`). Unescape
 * the window, then extract the object that carries the anchor key.
 *
 * The page holds many JSON-like objects (author sidebars, app state), and
 * page variants may order keys differently, pad whitespace, or omit the
 * name — so candidates are found by structure (`{` + quoted key), not by a
 * literal `{"name"` prefix. Brace balancing respects JSON string boundaries
 * (a `}` inside a name or bio must not truncate the scan) and corrupt
 * candidates are skipped, never fatal: only the absence of any valid
 * stat-bearing object fails the extraction.
 *
 * Bounds: a fixed window around the anchor plus a cap on inspected
 * candidates, so hostile or bloated pages cannot cause unbounded work.
 * A name bearing a literal quote degrades to a skipped candidate rather
 * than a misparse — never a wrong value.
 */
interface StatsExtraction {
  data: ValidatedStats | null;
  /** Safe internal diagnosis: stage + counts + field paths, no page content. */
  diagnosis: string;
}

const SEARCH_BACK_CHARS = 8000;
const SEARCH_FORWARD_CHARS = 2000;
const MAX_CANDIDATE_SCANS = 400;

function isObjectStart(windowText: string, index: number): boolean {
  // A JSON object starts with `{` followed by optional whitespace and a
  // quoted key. This rejects JS blocks, CSS, and template braces.
  let i = index + 1;
  while (i < windowText.length && /\s/.test(windowText[i]!)) i += 1;
  return windowText[i] === '"';
}

/** Balance-brace scan from `start`, respecting strings and `\` escapes. */
function findObjectEnd(windowText: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < windowText.length; i += 1) {
    const ch = windowText[i];
    if (inString) {
      // Skip escaped characters so an escaped quote (`\"`, e.g. from a
      // name containing a literal quote) cannot end the string early.
      if (ch === "\\") i += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseStatsObject(html: string): StatsExtraction {
  const anchor = html.indexOf("total_problems_solved");
  if (anchor < 0) return { data: null, diagnosis: "no-anchor" };
  const windowText = html
    .slice(Math.max(0, anchor - SEARCH_BACK_CHARS), anchor + SEARCH_FORWARD_CHARS)
    .split('\\"')
    .join('"');
  // The profile object is the one carrying the anchor key: there may be
  // many other JSON-like objects in the page (author sidebars, app state),
  // so verify each candidate actually holds the anchor key AND passes
  // schema validation before accepting it.
  let from = 0;
  let scanned = 0;
  let parsedCount = 0;
  let keyedCount = 0;
  let schemaRejected: string[] = [];
  for (;;) {
    const brace = windowText.indexOf("{", from);
    if (brace < 0 || scanned >= MAX_CANDIDATE_SCANS) break;
    if (!isObjectStart(windowText, brace)) {
      from = brace + 1;
      continue;
    }
    scanned += 1;
    const closedAt = findObjectEnd(windowText, brace);
    if (closedAt < 0) {
      // Unbalanced inside the window (cut off at the window edge): step
      // past this brace so nested content still gets its own chance.
      from = brace + 1;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(windowText.slice(brace, closedAt + 1));
    } catch {
      // Corrupt candidate (page-variant markup, truncated strings): keep
      // looking instead of failing the whole page.
      from = brace + 1;
      continue;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      from = brace + 1;
      continue;
    }
    parsedCount += 1;
    if (!("total_problems_solved" in parsed)) {
      from = brace + 1;
      continue;
    }
    keyedCount += 1;
    const validated = profileObjectSchema.safeParse(parsed);
    if (!validated.success) {
      schemaRejected = validated.error.issues.map((issue) => issue.path.join(".") || "(root)");
      from = brace + 1;
      continue;
    }
    return { data: validated.data, diagnosis: `ok(scanned=${scanned})` };
  }
  if (keyedCount > 0) {
    const fields = [...new Set(schemaRejected)].slice(0, 5).join(",");
    return {
      data: null,
      diagnosis: `schema-rejected(candidates=${scanned},keyed=${keyedCount},fields=${fields})`,
    };
  }
  return {
    data: null,
    diagnosis: `no-candidate(scanned=${scanned},parsed=${parsedCount})`,
  };
}

export async function fetchGeeksforgeeksProfile(
  username: string,
  deps: GeeksforgeeksHttpDeps
): Promise<GeeksforgeeksProfileBundle> {
  // Fixed trusted base; the slug travels as an encoded path segment only.
  const url = `${GEEKSFORGEEKS_PROFILE_BASE}${encodeURIComponent(username)}/`;
  const res = await fetchUpstream(url, { timeoutMs: deps.timeoutMs, maxRetries: 1 });
  const html = await res.text();

  // The stats object is the profile signal: bogus slugs render a shell
  // page without it (verified empirically — always HTTP 200 either way).
  const extraction = parseStatsObject(html);
  if (!extraction.data) {
    if (extraction.diagnosis === "no-anchor") {
      throw profileNotFound(
        `GeeksforGeeks user "${username}" was not found.`,
        "gfg.parse=no-anchor"
      );
    }
    throw invalidResponse(
      "GeeksforGeeks returned an unreadable response. The integration may have changed.",
      `gfg.parse=${extraction.diagnosis}`
    );
  }
  const s = extraction.data;

  return {
    username,
    displayName: nonEmpty(s.name),
    score: asInt(s.score),
    monthlyScore: asInt(s.monthly_score),
    totalSolved: asInt(s.total_problems_solved),
    instituteRank: rankToString(s.institute_rank),
    podCurrentStreak: asInt(s.pod_solved_current_streak),
    podLongestStreak: asInt(s.pod_solved_longest_streak),
  };
}
