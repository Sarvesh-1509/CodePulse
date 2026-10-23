import { RECOMMENDATIONS_CATALOG } from "./recommendationsCatalog";
import type { PlatformId } from "@codepulse/shared";

/**
 * Personalized problem recommendations (standalone module).
 *
 * A pure, reusable, rule-based recommendation engine. It reads a
 * `RecommendationProfile` (real signals gathered from the user's synced
 * activity, ratings and solved counts) and turns it into problem picks.
 *
 * Design rules honoured here:
 * - No LLM / paid API / ML — plain deterministic rules only.
 * - No fabricated data: everything is derived from the supplied profile.
 * - Solved problems are excluded via `${platform}::${problemIdentifier}` keys
 *   that match the keys used elsewhere in CodePulse (see backend analytics).
 * - Missing statistics degrade gracefully to beginner-friendly picks.
 */

export const RECOMMENDATION_TOPICS = [
  "Dynamic Programming",
  "Graphs",
  "Trees",
  "Greedy Algorithms",
  "Binary Search",
  "Two Pointers",
  "Sorting",
  "Strings",
] as const;

export type RecommendationTopic = (typeof RECOMMENDATION_TOPICS)[number];

export type RecommendationDifficulty = "Easy" | "Medium" | "Hard";

export type RecommendationRationale = "weak-topic" | "level" | "fallback";

export interface RecommendedProblem {
  id: string;
  platform: PlatformId;
  platformLabel: string;
  title: string;
  difficulty: RecommendationDifficulty;
  topics: RecommendationTopic[];
  url: string;
  reason: string;
  rationale: RecommendationRationale;
}

export type DifficultyBand = "beginner" | "intermediate" | "advanced" | "expert";

export type LevelSource = "rating" | "solved-count" | "none";

export interface RecommendationLevel {
  band: DifficultyBand;
  source: LevelSource;
  label: string;
}

export interface SolvedRef {
  platform: PlatformId;
  problemIdentifier: string;
  difficulty: string | null;
  occurredAt: string;
}

export interface RecommendationProfile {
  solvedRefs: SolvedRef[];
  solvedCountsByPlatform: Partial<Record<PlatformId, number>>;
  ratingsByPlatform: Partial<Record<PlatformId, number>>;
  cprRating: number | null;
  streakCurrent: number;
  activeDays: number;
  hasSyncedData: boolean;
}

export interface RecommendationInput {
  profile: RecommendationProfile;
  /** Changing this regenerates the picks (refresh). */
  refreshKey?: number;
  limit?: number;
}

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  CODEFORCES: "Codeforces",
  LEETCODE: "LeetCode",
  CODECHEF: "CodeChef",
  GEEKSFORGEEKS: "GeeksforGeeks",
  HACKERRANK: "HackerRank",
};

const DEFAULT_LIMIT = 5;

const BAND_INDEX: Record<DifficultyBand, number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
  expert: 3,
};

const BAND_OF_DIFFICULTY: Record<RecommendationDifficulty, DifficultyBand> = {
  Easy: "beginner",
  Medium: "intermediate",
  Hard: "advanced",
};

const DIFFICULTY_ORDER: Record<RecommendationDifficulty, number> = {
  Easy: 0,
  Medium: 1,
  Hard: 2,
};

const BAND_LABELS: Record<DifficultyBand, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  expert: "Expert",
};

/**
 * Per-platform rating band lower bounds: values below `intermediate` are
 * "Beginner", [intermediate, advanced) are "Intermediate", [advanced, expert)
 * are "Advanced" and ratings >= `expert` are "Expert".
 */
const PLATFORM_RATING_BANDS: Record<
  PlatformId,
  { beginner: number; intermediate: number; advanced: number; expert: number }
> = {
  CODEFORCES: { beginner: 0, intermediate: 1200, advanced: 1800, expert: 2600 },
  LEETCODE: { beginner: 0, intermediate: 1000, advanced: 1800, expert: 2600 },
  CODECHEF: { beginner: 0, intermediate: 1000, advanced: 1500, expert: 2200 },
  GEEKSFORGEEKS: { beginner: 0, intermediate: 1000, advanced: 1500, expert: 2200 },
  HACKERRANK: { beginner: 0, intermediate: 800, advanced: 1400, expert: 2000 },
};

export function bandFromSolvedCount(count: number): DifficultyBand {
  if (count <= 10) return "beginner";
  if (count <= 30) return "intermediate";
  if (count <= 60) return "advanced";
  return "expert";
}

export function ratingToBand(platform: PlatformId, rating: number): DifficultyBand {
  const bands = PLATFORM_RATING_BANDS[platform];
  if (rating < bands.intermediate) return "beginner";
  if (rating < bands.advanced) return "intermediate";
  if (rating < bands.expert) return "advanced";
  return "expert";
}

/** Estimate the user's current difficulty band from real signals only. */
export function assessLevel(profile: RecommendationProfile): RecommendationLevel {
  const rated = Object.entries(profile.ratingsByPlatform).filter(
    (entry): entry is [PlatformId, number] => typeof entry[1] === "number"
  );
  let band: DifficultyBand | null = null;
  for (const [platform, rating] of rated) {
    const candidate = ratingToBand(platform, rating);
    if (band === null || BAND_INDEX[candidate] > BAND_INDEX[band]) band = candidate;
  }
  if (band !== null) {
    return { band, source: "rating", label: BAND_LABELS[band] };
  }
  const solvedCounts = Object.values(profile.solvedCountsByPlatform).filter(
    (count): count is number => typeof count === "number" && count > 0
  );
  if (solvedCounts.length > 0) {
    const estimated = bandFromSolvedCount(Math.max(...solvedCounts));
    return { band: estimated, source: "solved-count", label: BAND_LABELS[estimated] };
  }
  return { band: "beginner", source: "none", label: BAND_LABELS.beginner };
}

/**
 * Difficulty bands recommendations are allowed to draw from:
 * - beginner  -> Easy (+ Medium as the first step up)
 * - intermediate -> Medium (+ Hard as the first step up)
 * - advanced/expert -> Hard
 * Users without any signal fall back to Easy/Medium (fundamentals).
 */
function acceptableBands(level: RecommendationLevel): Set<DifficultyBand> {
  switch (level.band) {
    case "beginner":
      return new Set<DifficultyBand>(["beginner", "intermediate"]);
    case "intermediate":
      return new Set<DifficultyBand>(["intermediate", "advanced"]);
    case "advanced":
    case "expert":
      return new Set<DifficultyBand>(["advanced"]);
  }
}

/** Topics with no solved coverage in the recommendation catalog. */
export function computeWeakTopics(profile: RecommendationProfile): RecommendationTopic[] {
  const catalogByKey = new Map(RECOMMENDATIONS_CATALOG.map((p) => [p.key, p]));
  const coverage = new Map<RecommendationTopic, number>();
  const seen = new Set<RecommendationTopic>();
  for (const ref of profile.solvedRefs) {
    const problem = catalogByKey.get(`${ref.platform}::${ref.problemIdentifier}`);
    if (!problem) continue;
    for (const topic of problem.topics) {
      seen.add(topic);
      coverage.set(topic, (coverage.get(topic) ?? 0) + 1);
    }
  }
  const catalogTopics = new Set<RecommendationTopic>();
  for (const problem of RECOMMENDATIONS_CATALOG) {
    for (const topic of problem.topics) catalogTopics.add(topic);
  }
  return RECOMMENDATION_TOPICS.filter(
    (topic) => catalogTopics.has(topic) && (coverage.get(topic) ?? 0) === 0
  );
}

function seededShuffle<T>(items: T[], seed: number): T[] {
  const arr = [...items];
  let state = seed >>> 0;
  const rand = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

export function generateRecommendations(input: RecommendationInput): RecommendedProblem[] {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const refreshKey = input.refreshKey ?? 0;
  const level = assessLevel(input.profile);
  const solvedKeys = new Set(
    input.profile.solvedRefs.map((r) => `${r.platform}::${r.problemIdentifier}`)
  );
  const weakTopics = new Set(computeWeakTopics(input.profile));
  const allowedBands = acceptableBands(level);

  const scored = RECOMMENDATIONS_CATALOG.map((problem, index) => ({ problem, index }))
    .filter(
      ({ problem }) =>
        allowedBands.has(BAND_OF_DIFFICULTY[problem.difficulty]) && !solvedKeys.has(problem.key)
    )
    .map(({ problem, index }) => ({
      problem,
      index,
      weak: problem.topics.some((topic) => weakTopics.has(topic)),
    }))
    .sort((a, b) => {
      if (a.weak !== b.weak) return a.weak ? -1 : 1;
      const diff = DIFFICULTY_ORDER[a.problem.difficulty] - DIFFICULTY_ORDER[b.problem.difficulty];
      if (diff !== 0) return diff;
      return a.index - b.index;
    });

  const pool = refreshKey > 0 ? seededShuffle(scored, refreshKey) : scored;

  return pool.slice(0, limit).map(({ problem, weak }) => {
    const problemLevel = BAND_OF_DIFFICULTY[problem.difficulty];
    const bandDiff = BAND_INDEX[problemLevel] - BAND_INDEX[level.band];
    const rationale: RecommendationRationale =
      level.source === "none" ? "fallback" : weak ? "weak-topic" : "level";
    const reason = weak && level.source !== "none"
      ? `You have little ${problem.topics[0]} practice in your solved history — ${problem.title} is a good next step.`
      : level.source === "none"
        ? `No solved history yet, so here is a beginner-friendly pick: ${problem.title} (${problem.difficulty}).`
        : `Picked around ${problem.difficulty} to sit just above your ${level.label.toLowerCase()} level (difficulty gap ${bandDiff < 0 ? "below" : "above"} comfort).`;
    return {
      id: problem.id,
      platform: problem.platform,
      platformLabel: PLATFORM_LABELS[problem.platform],
      title: problem.title,
      difficulty: problem.difficulty,
      topics: problem.topics,
      url: problem.url,
      reason,
      rationale,
    };
  });
}
