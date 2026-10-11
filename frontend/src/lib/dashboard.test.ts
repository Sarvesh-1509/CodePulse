import { describe, expect, it } from "vitest";
import {
  activitySummary,
  buildHeatmapWeeks,
  formatCount,
  formatDayLabel,
  formatRating,
  intensityLevel,
  toSolvedChartData,
} from "./dashboard";
import type { ActivityDayDto, ActivityTotalsDto } from "@codepulse/shared";

function day(date: string, count: number): ActivityDayDto {
  return { date, count, platforms: count > 0 ? ["CODEFORCES"] : [] };
}

describe("intensityLevel", () => {
  it("returns 0 for empty days or empty ranges", () => {
    expect(intensityLevel(0, 10)).toBe(0);
    expect(intensityLevel(5, 0)).toBe(0);
    expect(intensityLevel(-1, 10)).toBe(0);
  });

  it("buckets counts into quartiles of the observed max", () => {
    expect(intensityLevel(1, 8)).toBe(1);
    expect(intensityLevel(2, 8)).toBe(1);
    expect(intensityLevel(3, 8)).toBe(2);
    expect(intensityLevel(4, 8)).toBe(2);
    expect(intensityLevel(5, 8)).toBe(3);
    expect(intensityLevel(7, 8)).toBe(4);
    expect(intensityLevel(8, 8)).toBe(4);
    expect(intensityLevel(99, 8)).toBe(4);
  });
});

describe("buildHeatmapWeeks", () => {
  it("returns no weeks for empty input (never invents days)", () => {
    expect(buildHeatmapWeeks([])).toEqual([]);
  });

  it("lays a full Sunday-to-Saturday week without padding", () => {
    // 2026-06-14 is a Sunday.
    const days = [
      "2026-06-14", "2026-06-15", "2026-06-16", "2026-06-17",
      "2026-06-18", "2026-06-19", "2026-06-20",
    ].map((date, i) => day(date, i));
    const weeks = buildHeatmapWeeks(days);
    expect(weeks).toHaveLength(1);
    expect(weeks[0].map((c) => c?.date ?? null)).toEqual(days.map((d) => d.date));
    expect(weeks[0][0]).toMatchObject({ date: "2026-06-14", count: 0, level: 0 });
  });

  it("pads leading and trailing cells with null (not zeroes)", () => {
    // Wednesday 2026-06-17 through Friday 2026-06-19.
    const weeks = buildHeatmapWeeks([day("2026-06-17", 2), day("2026-06-18", 0), day("2026-06-19", 5)]);
    expect(weeks).toHaveLength(1);
    expect(weeks[0].slice(0, 3)).toEqual([null, null, null]);
    expect(weeks[0][3]).toMatchObject({ date: "2026-06-17", count: 2 });
    expect(weeks[0].slice(6)).toEqual([null]);
  });

  it("keeps weekday columns aligned across gaps", () => {
    // Sunday then the following Saturday: two columns apart in one row each.
    const weeks = buildHeatmapWeeks([day("2026-06-14", 1), day("2026-06-20", 3)]);
    expect(weeks).toHaveLength(1);
    expect(weeks[0][0]).toMatchObject({ date: "2026-06-14" });
    expect(weeks[0][6]).toMatchObject({ date: "2026-06-20" });
    expect(weeks[0].slice(1, 6)).toEqual([null, null, null, null, null]);
  });

  it("splits across week boundaries correctly", () => {
    // Saturday 2026-06-20 then Sunday 2026-06-21.
    const weeks = buildHeatmapWeeks([day("2026-06-20", 1), day("2026-06-21", 1)]);
    expect(weeks).toHaveLength(2);
    expect(weeks[0][6]).toMatchObject({ date: "2026-06-20" });
    expect(weeks[1][0]).toMatchObject({ date: "2026-06-21" });
  });

  it("sorts unordered input and drops duplicates", () => {
    const weeks = buildHeatmapWeeks([day("2026-06-16", 1), day("2026-06-14", 2), day("2026-06-16", 9)]);
    const dates = weeks.flat().filter((c) => c !== null).map((c) => c!.date);
    expect(dates).toEqual(["2026-06-14", "2026-06-16"]);
  });
});

describe("formatters", () => {  it("formats counts, ratings, and day labels", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatRating(null)).toBe("—");
    expect(formatRating(1484.12)).toBe("1,484");
    expect(formatDayLabel("2026-06-15")).toContain("2026");
    expect(formatDayLabel("not-a-date")).toBe("not-a-date");
  });

  it("summarizes activity accessibly", () => {
    expect(activitySummary(0, 0)).toBe("No recorded coding activity yet.");
    expect(activitySummary(1, 1)).toBe("1 active day, 1 activity total.");
    expect(activitySummary(12, 150)).toBe("12 active days, 150 activities total.");
  });
});

describe("toSolvedChartData", () => {
  function totals(
    uniqueSolvedByPlatform: Record<string, number>,
    officialSolvedByPlatform: Record<string, number> = {}
  ): ActivityTotalsDto {
    return {
      total: 0,
      byPlatform: {},
      byType: {},
      uniqueSolvedByPlatform: uniqueSolvedByPlatform as ActivityTotalsDto["uniqueSolvedByPlatform"],
      officialSolvedByPlatform:
        officialSolvedByPlatform as ActivityTotalsDto["officialSolvedByPlatform"],
    };
  }

  it("returns rows sorted descending by solved count", () => {
    expect(
      toSolvedChartData(totals({ LEETCODE: 18, CODEFORCES: 128 }))
    ).toEqual([
      { platform: "CODEFORCES", solved: 128, official: null },
      { platform: "LEETCODE", solved: 18, official: null },
    ]);
  });

  it("attaches official totals without inventing them", () => {
    expect(
      toSolvedChartData(totals({ LEETCODE: 20 }, { LEETCODE: 164 }))
    ).toEqual([{ platform: "LEETCODE", solved: 20, official: 164 }]);
  });

  it("returns no rows without totals (never invents zeroes)", () => {
    expect(toSolvedChartData(null)).toEqual([]);
    expect(toSolvedChartData(totals({}))).toEqual([]);
  });

  it("omits platforms without solved rows instead of showing zero", () => {
    const rows = toSolvedChartData(totals({ CODEFORCES: 5 }));
    expect(rows).toEqual([{ platform: "CODEFORCES", solved: 5, official: null }]);
    expect(rows.some((r) => r.platform === "LEETCODE")).toBe(false);
  });
});
