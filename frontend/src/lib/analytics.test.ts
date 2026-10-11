import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_PRESETS,
  DEFAULT_SELECTION,
  bucketSpanLabel,
  formatDelta,
  shortBucketLabel,
  toQuery,
  toQueryString,
  validateCustomRange,
  validateSelection,
} from "./analytics";
import {
  getAnalyticsCompare,
  getAnalyticsContests,
  getAnalyticsPlatforms,
  getAnalyticsRatings,
  getAnalyticsSummary,
  getAnalyticsTrends,
  ApiError,
} from "./api";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("validateCustomRange", () => {
  it("accepts a well-formed past range", () => {
    expect(validateCustomRange("2026-06-01", "2026-06-30")).toBeNull();
  });

  it("requires both dates", () => {
    expect(validateCustomRange("", "2026-06-30")).toMatch(/both/i);
    expect(validateCustomRange("2026-06-01", "")).toMatch(/both/i);
  });

  it("rejects malformed or impossible dates", () => {
    expect(validateCustomRange("06/01/2026", "2026-06-30")).toMatch(/YYYY-MM-DD/);
    expect(validateCustomRange("2026-13-01", "2026-13-02")).toMatch(/YYYY-MM-DD/);
    expect(validateCustomRange("2026-02-30", "2026-03-01")).toMatch(/YYYY-MM-DD/);
  });

  it("rejects a start after the end", () => {
    expect(validateCustomRange("2026-06-10", "2026-06-01")).toMatch(/start date/i);
  });

  it("caps custom spans at 366 days", () => {
    expect(validateCustomRange("2020-01-01", "2025-01-01")).toMatch(/366/);
    expect(validateCustomRange("2025-01-01", "2025-12-31")).toBeNull();
  });

  it("rejects an end date in the future", () => {
    expect(validateCustomRange("2998-12-30", "2999-01-01")).toMatch(/future/i);
  });
});

describe("validateSelection", () => {
  it("always accepts presets without a server round-trip", () => {
    for (const preset of ANALYTICS_PRESETS) {
      expect(validateSelection({ ...DEFAULT_SELECTION, mode: "preset", preset })).toBeNull();
    }
  });

  it("validates custom selections", () => {
    expect(
      validateSelection({ ...DEFAULT_SELECTION, mode: "custom", start: "2026-06-01", end: "" })
    ).not.toBeNull();
    expect(
      validateSelection({ ...DEFAULT_SELECTION, mode: "custom", start: "2026-06-01", end: "2026-06-30" })
    ).toBeNull();
  });
});

describe("toQuery / toQueryString", () => {
  it("sends a preset alone, never mixed with dates", () => {
    expect(toQuery({ ...DEFAULT_SELECTION, mode: "preset", preset: "7d" })).toEqual({ range: "7d" });
    expect(toQueryString(toQuery({ ...DEFAULT_SELECTION, mode: "preset", preset: "7d" }))).toBe(
      "?range=7d"
    );
    expect(toQueryString({})).toBe("");
  });

  it("sends a custom pair alone", () => {
    const query = toQuery({ ...DEFAULT_SELECTION, mode: "custom", start: "2026-06-01", end: "2026-06-07" });
    expect(query).toEqual({ start: "2026-06-01", end: "2026-06-07" });
    expect("range" in query).toBe(false);
    expect(toQueryString(query)).toBe("?start=2026-06-01&end=2026-06-07");
  });

  it("trims the timezone and omits it when blank (server falls back to profile)", () => {
    expect(toQuery({ ...DEFAULT_SELECTION, timezone: "  " })).toEqual({ range: "30d" });
    expect(
      toQuery({ ...DEFAULT_SELECTION, mode: "preset", preset: "90d", timezone: "Europe/Berlin" })
    ).toEqual({ range: "90d", timezone: "Europe/Berlin" });
  });
});

describe("formatDelta", () => {
  it("renders null as n/a, never as 0% or infinity", () => {
    expect(formatDelta(null)).toBe("n/a");
    expect(formatDelta(NaN)).toBe("n/a");
  });

  it("signs positive deltas and keeps negatives", () => {
    expect(formatDelta(100)).toBe("+100%");
    expect(formatDelta(-25.5)).toBe("-25.5%");
    expect(formatDelta(0)).toBe("0%");
  });
});

describe("bucket labels", () => {
  it("shortens daily/weekly starts to MM-DD and keeps YYYY-MM months", () => {
    expect(shortBucketLabel({ start: "2026-06-05", end: "2026-06-05" })).toBe("06-05");
    expect(shortBucketLabel({ start: "2026-06", end: "2026-06" })).toBe("2026-06");
  });

  it("collapses single-day spans and joins multi-day spans", () => {
    expect(bucketSpanLabel({ start: "2026-06-05", end: "2026-06-05" })).toBe("2026-06-05");
    expect(bucketSpanLabel({ start: "2026-06-01", end: "2026-06-07" })).toBe(
      "2026-06-01 – 2026-06-07"
    );
    expect(bucketSpanLabel({ start: "2026-06", end: "2026-06" })).toBe("2026-06");
  });
});

describe("analytics api client", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { success: true, data: {} }))
    );
  });

  it("defaults to the 30d preset and never sends an empty query", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        expect(String(url)).toContain("/api/analytics/summary?range=30d");
        return jsonResponse(200, { success: true, data: { totals: {} } });
      })
    );
    await getAnalyticsSummary();
  });

  it("calls trends/compare/platforms with the same range params", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        seen.push(String(url));
        return jsonResponse(200, { success: true, data: {} });
      })
    );
    await getAnalyticsTrends({ range: "7d", timezone: "UTC" });
    await getAnalyticsCompare({ start: "2026-06-01", end: "2026-06-07" });
    await getAnalyticsPlatforms({ range: "90d" });
    expect(seen[0]).toContain("/api/analytics/trends?range=7d&timezone=UTC");
    expect(seen[1]).toContain("/api/analytics/compare?start=2026-06-01&end=2026-06-07");
    expect(seen[1]).not.toContain("range=");
    expect(seen[2]).toContain("/api/analytics/platforms?range=90d");
  });

  it("paginates contests with limit/offset and fetches ratings without params", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        seen.push(String(url));
        return jsonResponse(200, { success: true, data: {} });
      })
    );
    await getAnalyticsContests({ limit: 10, offset: 20 });
    await getAnalyticsRatings();
    expect(seen[0]).toContain("/api/analytics/contests?limit=10&offset=20");
    expect(seen[1].endsWith("/api/analytics/ratings")).toBe(true);
  });

  it("surfaces analytics errors with status instead of mock data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(400, { success: false, message: "Invalid analytics query." }))
    );
    const err = await getAnalyticsTrends({ range: "30d" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
  });
});
