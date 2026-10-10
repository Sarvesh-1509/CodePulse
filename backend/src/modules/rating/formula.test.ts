/**
 * CodePulse Rating Formula Unit Tests
 * Verifies mathematical bounds, scaling curves, and SHA-256 idempotency.
 */
import { describe, expect, it } from "vitest";
import { calculateCpr, FORMULA_VERSION, type FormulaInputs } from "./formula";

function baseInputs(overrides: Partial<FormulaInputs> = {}): FormulaInputs {
  return {
    ratings: [],
    consistency: { activeDays90: 0, longestStreak: 0, hasHistory: false },
    nowIso: "2026-06-15T12:00:00.000Z",
    ...overrides,
  };
}

describe("calculateCpr", () => {
  it("exposes the documented formula version", () => {
    expect(FORMULA_VERSION).toBe("1.0.0");
  });

  it("computes all three components for realistic data", () => {
    const args = baseInputs({
      ratings: [
        { platform: "CODEFORCES", contestRating: 892, totalSolved: 128, contestsAttended: 5 },
        { platform: "LEETCODE", contestRating: 1484.12, totalSolved: 209, contestsAttended: 3 },
        { platform: "GEEKSFORGEEKS", contestRating: null, totalSolved: 27, contestsAttended: null },
        { platform: "HACKERRANK", contestRating: null, totalSolved: null, contestsAttended: 0 },
      ],
      consistency: { activeDays90: 30, longestStreak: 12, hasHistory: true },
    });
    const result = calculateCpr(args);
    expect(result.components.contest).toBe(282.64);
    expect(result.components.solving).toBeCloseTo(640.57, 1);
    expect(result.components.consistency).toBe(560);
    expect(result.available).toEqual(["contest", "solving", "consistency"]);
    expect(result.provisional).toBe(false);
    expect(result.rating).toBeGreaterThan(400);
    expect(result.rating).toBeLessThan(600);
    // Deterministic: identical inputs, identical outputs.
    expect(calculateCpr(baseInputs({
      ratings: [
        { platform: "CODEFORCES", contestRating: 892, totalSolved: 128, contestsAttended: 5 },
        { platform: "LEETCODE", contestRating: 1484.12, totalSolved: 209, contestsAttended: 3 },
        { platform: "GEEKSFORGEEKS", contestRating: null, totalSolved: 27, contestsAttended: null },
        { platform: "HACKERRANK", contestRating: null, totalSolved: null, contestsAttended: 0 },
      ],
      consistency: { activeDays90: 30, longestStreak: 12, hasHistory: true },
    }))).toEqual(result);
  });

  it("returns unavailable when nothing is available (never zero)", () => {
    const result = calculateCpr(baseInputs({
      ratings: [{ platform: "HACKERRANK", contestRating: null, totalSolved: null, contestsAttended: null }],
    }));
    expect(result.rating).toBeNull();
    expect(result.components).toEqual({ contest: null, solving: null, consistency: null });
    expect(result.available).toEqual([]);
    expect(result.provisional).toBe(true);
  });

  it("renormalizes weights over available components (single rating)", () => {
    const result = calculateCpr(baseInputs({
      ratings: [{ platform: "CODEFORCES", contestRating: 2000, totalSolved: null, contestsAttended: null }],
    }));
    // 1000 * (0.75 * 0.5 + 0) = 375, the only component, so the total equals it.
    expect(result.components.contest).toBe(375);
    expect(result.rating).toBe(375);
    expect(result.provisional).toBe(true);
  });

  it("clamps ratings to ceilings and floors", () => {
    const high = calculateCpr(baseInputs({
      ratings: [{ platform: "CODEFORCES", contestRating: 8000, totalSolved: null, contestsAttended: null }],
    }));
    expect(high.components.contest).toBe(750);
    const negative = calculateCpr(baseInputs({
      ratings: [{ platform: "CODEFORCES", contestRating: -100, totalSolved: null, contestsAttended: null }],
    }));
    expect(negative.components.contest).toBe(0);
  });

  it("dampens raw solved counts with a logarithm", () => {
    const one = calculateCpr(baseInputs({
      ratings: [{ platform: "LEETCODE", contestRating: null, totalSolved: 1, contestsAttended: null }],
    }));
    expect(one.components.solving).toBeCloseTo(75.26, 2);
    const tenThousand = calculateCpr(baseInputs({
      ratings: [{ platform: "LEETCODE", contestRating: null, totalSolved: 10000, contestsAttended: null }],
    }));
    expect(tenThousand.components.solving).toBe(1000);
    // 10,000x the solves is worth ~13x the score, not 10,000x.
    expect((tenThousand.components.solving as number) / (one.components.solving as number)).toBeLessThan(14);
  });

  it("treats missing history as unknown, synced quiet history as low", () => {
    const unknown = calculateCpr(baseInputs({
      ratings: [{ platform: "CODEFORCES", contestRating: null, totalSolved: 5, contestsAttended: null }],
      consistency: { activeDays90: 0, longestStreak: 0, hasHistory: false },
    }));
    expect(unknown.components.consistency).toBeNull();
    const quiet = calculateCpr(baseInputs({
      ratings: [{ platform: "CODEFORCES", contestRating: null, totalSolved: 5, contestsAttended: null }],
      consistency: { activeDays90: 0, longestStreak: 0, hasHistory: true },
    }));
    expect(quiet.components.consistency).toBe(0);
  });

  it("changes the inputs hash when data changes, keeps it otherwise", () => {
    const a = calculateCpr(baseInputs({
      ratings: [{ platform: "CODEFORCES", contestRating: 892, totalSolved: 128, contestsAttended: 5 }],
      consistency: { activeDays90: 10, longestStreak: 5, hasHistory: true },
    }));
    const b = calculateCpr(baseInputs({
      ratings: [{ platform: "CODEFORCES", contestRating: 893, totalSolved: 128, contestsAttended: 5 }],
      consistency: { activeDays90: 10, longestStreak: 5, hasHistory: true },
    }));
    expect(a.inputsHash).not.toBe(b.inputsHash);
    expect(a.inputsHash).toHaveLength(64);
  });

  it("stays within the 0-1000 bounds on extreme inputs", () => {
    const result = calculateCpr(baseInputs({
      ratings: [
        { platform: "CODEFORCES", contestRating: 99999, totalSolved: 99999999, contestsAttended: 99999 },
        { platform: "LEETCODE", contestRating: 99999, totalSolved: 99999999, contestsAttended: 99999 },
      ],
      consistency: { activeDays90: 99999, longestStreak: 99999, hasHistory: true },
    }));
    expect(result.rating).toBeLessThanOrEqual(1000);
    expect(result.rating).toBeGreaterThanOrEqual(0);
    expect(result.components.contest).toBeLessThanOrEqual(1000);
  });
});
