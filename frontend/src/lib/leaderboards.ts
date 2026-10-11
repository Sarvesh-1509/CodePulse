import type {
  LeaderboardEntryDto,
  LeaderboardMetric,
  LeaderboardPeriod,
} from "@codepulse/shared";
import { formatRating } from "./dashboard";

/**
 * Pure leaderboard helpers (Module 14). No DOM, no fetch: safe to unit test
 * in the node environment and safe to use from client components.
 */

export const LEADERBOARD_METRICS: readonly LeaderboardMetric[] = [
  "cpr",
  "activity",
  "solved",
  "streak",
];

export const LEADERBOARD_PERIODS: readonly LeaderboardPeriod[] = ["7d", "30d", "90d"];

export const METRIC_LABELS: Record<LeaderboardMetric, string> = {
  cpr: "CodePulse Rating",
  activity: "Active days",
  solved: "Problems solved",
  streak: "Current streak",
};

export const METRIC_DESCRIPTIONS: Record<LeaderboardMetric, string> = {
  cpr: "Latest CodePulse Rating snapshots. Only members who opted in appear; provisional rows have limited coverage.",
  activity: "Distinct active days in the trailing window (UTC).",
  solved: "Distinct verified solved problems in the trailing window (UTC).",
  streak: "Current daily streaks, best known from the trailing year of verified activity.",
};

/** CPR and streak boards rank all-time snapshots, so no trailing window applies. */
export function usesPeriod(metric: LeaderboardMetric): boolean {
  return metric === "activity" || metric === "solved";
}

/** Primary score cell text, with units. Scores are verified counts/ratings, never invented. */
export function formatScore(metric: LeaderboardMetric, score: number): string {
  if (metric === "cpr") return formatRating(score);
  if (metric === "activity" || metric === "streak") return score === 1 ? "1 day" : `${score} days`;
  return String(score);
}

/** Supporting numbers for the detail column; null when the board has none. */
export function entryDetailText(metric: LeaderboardMetric, entry: LeaderboardEntryDto): string | null {
  const d = entry.detail;
  if (metric === "cpr") {
    return entry.provisional ? "Provisional coverage" : null;
  }
  if (metric === "activity") {
    return d.events !== undefined && d.events !== null ? `${d.events} events` : null;
  }
  if (metric === "solved") {
    return d.events !== undefined && d.events !== null ? `${d.events} events` : null;
  }
  return d.activeDays !== undefined && d.activeDays !== null
    ? `${d.activeDays} active days (1y)`
    : null;
}

/** Display name with username fallback. Mirrors the rooms helper contract. */
export function leaderboardDisplayName(entry: LeaderboardEntryDto): string {
  return entry.user.displayName ?? entry.user.username;
}

/** Total pages for a pagination footer; at least 1 so the label never reads "Page 1 of 0". */
export function pageCount(total: number, limit: number): number {
  if (limit <= 0) return 1;
  return Math.max(1, Math.ceil(total / limit));
}
