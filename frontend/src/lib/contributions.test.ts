import { describe, expect, it } from "vitest";
import {
  chartableContributionRows,
  formatContributionDelta,
  mostActivePlatform,
  mostActiveTrendDay,
} from "./contributions";
import type { AnalyticsPlatformsData, AnalyticsTrendsData } from "./api";

const platformData: AnalyticsPlatformsData = {
  range: { range: "30d", start: "2026-01-01", end: "2026-01-30", timezone: "UTC" },
  platforms: [
    { platform: "CODEFORCES", events: 8, solved: 4, contests: 1, activeDays: 3, currentRating: 1200, totalSolvedAllTime: 50, lastSyncedAt: null },
    { platform: "LEETCODE", events: 0, solved: 0, contests: 0, activeDays: 0, currentRating: null, totalSolvedAllTime: 100, lastSyncedAt: null },
  ],
};

describe("contribution helpers", () => {
  it("formats unavailable percentage comparisons honestly", () => {
    expect(formatContributionDelta(null)).toBe("n/a");
    expect(formatContributionDelta(12.5)).toBe("+12.5%");
    expect(formatContributionDelta(-4)).toBe("-4%");
  });

  it("excludes platforms without dated history from contribution charts", () => {
    const rows = chartableContributionRows(
      [
        { ...platformData.platforms[0], label: "Codeforces", history: "complete", historyNote: "" },
        { ...platformData.platforms[1], label: "LeetCode", history: "unavailable", historyNote: "No activity API" },
      ]
    );
    expect(rows.map((row) => row.platform)).toEqual(["CODEFORCES"]);
  });

  it("finds the strongest supported platform and trend bucket", () => {
    const rows = chartableContributionRows([
      { ...platformData.platforms[0], label: "Codeforces", history: "complete", historyNote: "" },
      { ...platformData.platforms[1], label: "LeetCode", history: "empty", historyNote: "" },
    ]);
    expect(mostActivePlatform(rows)?.platform).toBe("CODEFORCES");
    const trends: AnalyticsTrendsData = {
      buckets: [
        { kind: "daily", start: "2026-01-01", end: "2026-01-01", events: 2, activeDays: 1, solved: 1, contests: 0 },
        { kind: "daily", start: "2026-01-02", end: "2026-01-02", events: 5, activeDays: 1, solved: 2, contests: 0 },
      ],
      kind: "daily",
      range: { start: "2026-01-01", end: "2026-01-02" },
      timezone: "UTC",
    };
    expect(mostActiveTrendDay(trends)).toEqual({ start: "2026-01-02", events: 5 });
  });
});
