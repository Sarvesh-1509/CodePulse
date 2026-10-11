import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEADERBOARD_METRICS,
  LEADERBOARD_PERIODS,
  METRIC_LABELS,
  entryDetailText,
  formatScore,
  leaderboardDisplayName,
  pageCount,
  usesPeriod,
} from "./leaderboards";
import { ApiError, getGlobalLeaderboard, getRoomLeaderboard } from "./api";
import type { LeaderboardEntryDto } from "@codepulse/shared";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function entry(overrides: Partial<LeaderboardEntryDto> = {}): LeaderboardEntryDto {
  return {
    rank: 1,
    user: { id: "u1", username: "alice", displayName: null, avatarUrl: null },
    score: 100,
    detail: {},
    ...overrides,
  };
}

describe("leaderboard metadata", () => {
  it("covers every supported metric and period", () => {
    expect([...LEADERBOARD_METRICS].sort()).toEqual(["activity", "cpr", "solved", "streak"]);
    expect([...LEADERBOARD_PERIODS]).toEqual(["7d", "30d", "90d"]);
    for (const metric of LEADERBOARD_METRICS) {
      expect(METRIC_LABELS[metric].length).toBeGreaterThan(0);
    }
  });

  it("applies trailing windows only to activity-family boards", () => {
    expect(usesPeriod("activity")).toBe(true);
    expect(usesPeriod("solved")).toBe(true);
    expect(usesPeriod("cpr")).toBe(false);
    expect(usesPeriod("streak")).toBe(false);
  });
});

describe("formatScore", () => {
  it("formats CPR as a whole rating and counts with units", () => {
    expect(formatScore("cpr", 443.92)).toBe("444");
    expect(formatScore("activity", 1)).toBe("1 day");
    expect(formatScore("activity", 12)).toBe("12 days");
    expect(formatScore("streak", 3)).toBe("3 days");
    expect(formatScore("solved", 7)).toBe("7");
  });
});

describe("entryDetailText", () => {
  it("flags provisional CPR rows and stays quiet otherwise", () => {
    expect(entryDetailText("cpr", entry({ provisional: true }))).toBe("Provisional coverage");
    expect(entryDetailText("cpr", entry({ provisional: false }))).toBeNull();
  });

  it("surfaces supporting counts where the board provides them", () => {
    expect(entryDetailText("activity", entry({ detail: { activeDays: 5, events: 9 } }))).toBe(
      "9 events"
    );
    expect(entryDetailText("solved", entry({ detail: { solved: 4, events: 6 } }))).toBe("6 events");
    expect(entryDetailText("streak", entry({ detail: { streak: 2, activeDays: 40 } }))).toBe(
      "40 active days (1y)"
    );
    expect(entryDetailText("activity", entry())).toBeNull();
  });
});

describe("leaderboardDisplayName and pageCount", () => {
  it("prefers display names and never invents one", () => {
    expect(leaderboardDisplayName(entry())).toBe("alice");
    expect(
      leaderboardDisplayName(entry({ user: { id: "u2", username: "bob", displayName: "Bob", avatarUrl: null } }))
    ).toBe("Bob");
  });

  it("counts pages with a floor of one", () => {
    expect(pageCount(0, 20)).toBe(1);
    expect(pageCount(40, 20)).toBe(2);
    expect(pageCount(41, 20)).toBe(3);
    expect(pageCount(10, 0)).toBe(1);
  });
});

describe("leaderboards api client", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { success: true, data: {} }))
    );
  });

  it("fetches the global board with metric, period, and pagination params", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        expect(String(url)).toContain("/api/leaderboards/global?metric=solved&period=7d&page=2&limit=20");
        return jsonResponse(200, { success: true, data: { entries: [] } });
      })
    );
    await getGlobalLeaderboard({ metric: "solved", period: "7d", page: 2, limit: 20 });
  });

  it("fetches room boards from the membership-enforced path with an encoded id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init: unknown) => {
        expect(String(url)).toContain("/api/leaderboards/rooms/room%201?metric=cpr");
        expect((init as RequestInit).credentials).toBe("include");
        return jsonResponse(200, { success: true, data: { entries: [] } });
      })
    );
    await getRoomLeaderboard("room 1", { metric: "cpr" });
  });

  it("surfaces leaderboard errors with status instead of mock rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(404, { success: false, message: "Room not found." }))
    );
    const err = await getRoomLeaderboard("missing").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
  });
});
