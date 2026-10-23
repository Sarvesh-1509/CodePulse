import { describe, expect, it } from "vitest";
import {
  assessLevel,
  computeWeakTopics,
  generateRecommendations,
  type RecommendationProfile,
} from "./recommendations";

function emptyProfile(): RecommendationProfile {
  return {
    solvedRefs: [],
    solvedCountsByPlatform: {},
    ratingsByPlatform: {},
    cprRating: null,
    streakCurrent: 0,
    activeDays: 0,
    hasSyncedData: false,
  };
}

function solvedRef(problemIdentifier: string) {
  return {
    platform: "LEETCODE" as const,
    problemIdentifier,
    difficulty: "Medium",
    occurredAt: "2026-01-05T00:00:00.000Z",
  };
}

describe("assessLevel", () => {
  it("defaults to a beginner level with no data and never crashes", () => {
    expect(assessLevel(emptyProfile())).toEqual({ band: "beginner", source: "none", label: "Beginner" });
  });

  it("derives the level from a real platform rating", () => {
    const level = assessLevel({
      ...emptyProfile(),
      ratingsByPlatform: { LEETCODE: 1500 },
    });
    expect(level).toEqual({ band: "intermediate", source: "rating", label: "Intermediate" });
  });

  it("derives the level from solved counts when no rating is available", () => {
    const level = assessLevel({
      ...emptyProfile(),
      solvedCountsByPlatform: { LEETCODE: 20 },
    });
    expect(level).toEqual({ band: "intermediate", source: "solved-count", label: "Intermediate" });
  });
});

describe("computeWeakTopics", () => {
  it("marks topics the user has not solved as weak", () => {
    const weak = computeWeakTopics({
      ...emptyProfile(),
      solvedRefs: [solvedRef("number-of-islands")],
      ratingsByPlatform: { LEETCODE: 1700 },
    });
    expect(weak).not.toContain("Graphs");
    expect(weak).toContain("Dynamic Programming");
  });
});

describe("generateRecommendations", () => {
  it("returns beginner-friendly fallback picks when the user has no solved history", () => {
    const picks = generateRecommendations({ profile: emptyProfile(), limit: 3 });
    expect(picks).toHaveLength(3);
    for (const pick of picks) {
      expect(["Easy", "Medium"]).toContain(pick.difficulty);
      expect(pick.rationale).toBe("fallback");
      expect(pick.reason).toContain("No solved history yet");
      expect(pick.url).toMatch(/^https:\/\/(leetcode|codeforces)\.com\//);
    }
  });

  it("excludes problems the user already solved", () => {
    const picks = generateRecommendations({
      profile: {
        ...emptyProfile(),
        solvedRefs: [solvedRef("coin-change")],
        ratingsByPlatform: { LEETCODE: 1500 },
      },
    });
    const ids = picks.map((pick) => pick.id);
    expect(ids).not.toContain("coin-change");
    for (const pick of picks) {
      expect(["Medium", "Hard"]).toContain(pick.difficulty);
    }
  });

  it("respects the limit and only returns valid problem links", () => {
    const picks = generateRecommendations({ profile: emptyProfile(), limit: 4 });
    expect(picks).toHaveLength(4);
    const ids = new Set(picks.map((pick) => pick.id));
    expect(ids.size).toBe(picks.length);
    for (const pick of picks) {
      expect(pick.platformLabel.length).toBeGreaterThan(0);
      expect(pick.topics.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic for a given refresh key", () => {
    const options = { profile: emptyProfile(), limit: 3 };
    expect(generateRecommendations({ ...options, refreshKey: 0 })).toEqual(
      generateRecommendations({ ...options, refreshKey: 0 })
    );
    expect(generateRecommendations({ ...options, refreshKey: 2 })).toEqual(
      generateRecommendations({ ...options, refreshKey: 2 })
    );
  });
});
