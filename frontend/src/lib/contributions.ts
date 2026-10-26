import type {
  AnalyticsPlatformsData,
  AnalyticsTrendsData,
} from "@/lib/api";
import type {
  ActivityCoverageDto,
  PlatformBreakdownDto,
  PlatformId,
} from "@codepulse/shared";

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  CODEFORCES: "Codeforces",
  LEETCODE: "LeetCode",
  CODECHEF: "CodeChef",
  GEEKSFORGEEKS: "GeeksforGeeks",
  HACKERRANK: "HackerRank",
};

export interface ContributionPlatformRow extends PlatformBreakdownDto {
  label: string;
  history: ActivityCoverageDto["platforms"][number]["history"] | "not-connected";
  historyNote: string;
}

export function contributionPlatformRows(
  data: AnalyticsPlatformsData | null,
  coverage: ActivityCoverageDto | null
): ContributionPlatformRow[] {
  if (!data) return [];
  return data.platforms.map((platform) => {
    const coverageRow = coverage?.platforms.find((item) => item.platform === platform.platform);
    return {
      ...platform,
      label: PLATFORM_LABELS[platform.platform],
      history: coverageRow?.history ?? "not-connected",
      historyNote: coverageRow?.historyNote ?? "No coverage information is available.",
    };
  });
}

export function chartableContributionRows(rows: ContributionPlatformRow[]): ContributionPlatformRow[] {
  return rows
    .filter((row) => row.history !== "unavailable" && row.history !== "never-synced")
    .filter((row) => row.events > 0 || row.history === "complete" || row.history === "empty")
    .sort((a, b) => b.events - a.events);
}

export function formatContributionDelta(delta: number | null): string {
  if (delta === null || Number.isNaN(delta)) return "n/a";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta}%`;
}

export function mostActivePlatform(rows: ContributionPlatformRow[]): ContributionPlatformRow | null {
  return rows.reduce<ContributionPlatformRow | null>(
    (best, row) => (row.events > 0 && (best === null || row.events > best.events) ? row : best),
    null
  );
}

export function mostActiveTrendDay(
  trends: AnalyticsTrendsData | null
): { start: string; events: number } | null {
  if (!trends) return null;
  return trends.buckets.reduce<{ start: string; events: number } | null>(
    (best, bucket) =>
      bucket.events > 0 && (best === null || bucket.events > best.events)
        ? { start: bucket.start, events: bucket.events }
        : best,
    null
  );
}
