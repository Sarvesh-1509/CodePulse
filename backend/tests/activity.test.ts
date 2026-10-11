import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import type {
  PlatformAdapter,
  SyncBundle,
} from "../src/modules/platforms/adapters";
import type { PlatformId } from "@codepulse/shared";
import {
  cleanupUsers,
  databaseAvailable,
  uniqueEmail,
  uniqueUsername,
} from "./db";

const hasDb = await databaseAvailable();
const trackedEmails: string[] = [];

afterAll(async () => {
  await cleanupUsers(trackedEmails);
});

function bundle(
  username: string,
  overrides: Partial<SyncBundle> = {}
): SyncBundle {
  return {
    canonicalUsername: username,
    stats: {
      totalSolved: 10,
      contestRating: 1500,
      contestsAttended: 2,
      currentStreak: null,
      longestStreak: null,
      extra: {},
    },
    activities: [],
    contests: [],
    ...overrides,
  };
}

function activity(
  externalId: string,
  occurredAt: Date,
  problemId = "1A"
): SyncBundle["activities"][number] {
  return {
    externalId,
    type: "PROBLEM_SOLVED",
    problemId,
    difficulty: null,
    occurredAt,
  };
}

/** Events on the N most recent UTC days ending today (distinct days). */
function recentDays(n: number, prefix: string): SyncBundle["activities"][number][] {
  const now = Date.now();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now - (n - 1 - i) * 86_400_000);
    return activity(`${prefix}-${i}`, d, `P${i}`);
  });
}

function mockAdapters(
  fetchAll: (username: string) => Promise<SyncBundle>
): Record<PlatformId, PlatformAdapter> {
  const adapter = (platform: PlatformId): PlatformAdapter => ({ platform, fetchAll });
  return {
    CODEFORCES: adapter("CODEFORCES"),
    LEETCODE: adapter("LEETCODE"),
    CODECHEF: adapter("CODECHEF"),
    GEEKSFORGEEKS: adapter("GEEKSFORGEEKS"),
    HACKERRANK: adapter("HACKERRANK"),
  };
}

function testApp(fetchAll: (username: string) => Promise<SyncBundle>) {
  return createApp({ platformAdapters: mockAdapters(fetchAll) });
}

async function registerAgent(app: ReturnType<typeof createApp>, prefix = "mod9") {
  const agent = request.agent(app);
  const email = uniqueEmail(prefix);
  trackedEmails.push(email);
  const res = await agent.post("/api/auth/register").send({
    username: uniqueUsername(`${prefix}user`),
    email,
    password: "validpassword123",
  });
  expect(res.status).toBe(201);
  return agent;
}

async function connect(agent: Awaited<ReturnType<typeof registerAgent>>, platform: string, username: string) {
  const res = await agent.post(`/api/platform-accounts/${platform}/connect`).send({ username });
  expect(res.status).toBe(201);
}

describe.skipIf(!hasDb)("activity authentication", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const app = testApp(async (u) => bundle(u));
    expect((await request(app).get("/api/activity/streak")).status).toBe(401);
    expect((await request(app).get("/api/activity/days")).status).toBe(401);
    expect((await request(app).get("/api/activity/recent")).status).toBe(401);
  });

  it("isolates users: one user cannot see another's activity", async () => {
    const app = testApp(async (u) =>
      bundle(u, { activities: recentDays(3, "iso") })
    );
    const alice = await registerAgent(app, "mod9a");
    const bob = await registerAgent(app, "mod9b");
    await connect(alice, "CODEFORCES", "alicecf01");
    const bobStreak = await bob.get("/api/activity/streak");
    expect(bobStreak.status).toBe(200);
    expect(bobStreak.body.data.streak.totalActiveDays).toBe(0);
    expect(bobStreak.body.data.coverage.connectedPlatforms).toEqual([]);
    const bobRecent = await bob.get("/api/activity/recent");
    expect(bobRecent.body.data.pagination.total).toBe(0);
  });
});

describe.skipIf(!hasDb)("activity empty states", () => {
  it("returns zeros and honest coverage for a fresh user", async () => {
    const app = testApp(async (u) => bundle(u));
    const agent = await registerAgent(app, "mod9e");
    const streak = await agent.get("/api/activity/streak");
    expect(streak.status).toBe(200);
    expect(streak.body.data.streak).toMatchObject({
      current: 0, longest: 0, totalActiveDays: 0, todayActive: false,
    });
    expect(streak.body.data.coverage.complete).toBe(false);
    expect(streak.body.data.coverage.connectedPlatforms).toEqual([]);
    expect(streak.body.data.totals.total).toBe(0);
    const days = await agent.get("/api/activity/days?days=7");
    expect(days.status).toBe(200);
    expect(days.body.data.days).toHaveLength(7);
    expect(days.body.data.days.every((d: { count: number }) => d.count === 0)).toBe(true);
    const recent = await agent.get("/api/activity/recent");
    expect(recent.body.data.items).toEqual([]);
    expect(recent.body.data.pagination.total).toBe(0);
  });
});

describe.skipIf(!hasDb)("activity streaks from synced data", () => {
  it("computes a live current streak from activity today", async () => {
    const app = testApp(async (u) =>
      bundle(u, { activities: recentDays(4, "live") })
    );
    const agent = await registerAgent(app, "mod9c");
    await connect(agent, "CODEFORCES", "livecf01");
    const res = await agent.get("/api/activity/streak");
    expect(res.status).toBe(200);
    expect(res.body.data.streak.current).toBe(4);
    expect(res.body.data.streak.longest).toBe(4);
    expect(res.body.data.streak.totalActiveDays).toBe(4);
    expect(res.body.data.streak.todayActive).toBe(true);
    expect(res.body.data.coverage.platformsWithHistory).toEqual(["CODEFORCES"]);
  });

  it("reports an expired streak with the longest run intact", async () => {
    const old = [
      new Date("2024-03-01T10:00:00Z"),
      new Date("2024-03-02T10:00:00Z"),
      new Date("2024-03-03T10:00:00Z"),
    ];
    const app = testApp(async (u) =>
      bundle(u, { activities: old.map((d, i) => activity(`old-${i}`, d, `O${i}`)) })
    );
    const agent = await registerAgent(app, "mod9x");
    await connect(agent, "LEETCODE", "expiredlc01");
    const res = await agent.get("/api/activity/streak");
    expect(res.body.data.streak.current).toBe(0);
    expect(res.body.data.streak.longest).toBe(3);
    expect(res.body.data.streak.totalActiveDays).toBe(3);
    expect(res.body.data.streak.todayActive).toBe(false);
  });

  it("merges two platforms active on the same day without double counting", async () => {
    const day = new Date();
    const app = testApp(async (u) =>
      bundle(u, { activities: [activity(`m-${u}`, day, "SHARED1")] })
    );
    const agent = await registerAgent(app, "mod9m");
    await connect(agent, "CODEFORCES", "multicf01");
    await connect(agent, "LEETCODE", "multilc01");
    const res = await agent.get("/api/activity/streak");
    expect(res.body.data.streak.totalActiveDays).toBe(1);
    expect(res.body.data.streak.current).toBe(1);
    const days = await agent.get("/api/activity/days?days=1");
    expect(days.body.data.days[0].count).toBe(2);
    expect(days.body.data.days[0].platforms).toEqual(["CODEFORCES", "LEETCODE"]);
  });
});

describe.skipIf(!hasDb)("activity coverage honesty", () => {
  it("marks non-activity platforms as unavailable, not empty", async () => {
    const app = testApp(async (u) => bundle(u));
    const agent = await registerAgent(app, "mod9g");
    await connect(agent, "GEEKSFORGEEKS", "gfguser01");
    const res = await agent.get("/api/activity/streak");
    const gfg = res.body.data.coverage.platforms.find(
      (p: { platform: string }) => p.platform === "GEEKSFORGEEKS"
    );
    expect(gfg.history).toBe("unavailable");
    expect(res.body.data.coverage.complete).toBe(false);
  });

  it("keeps serving stored data after a failed sync, flagged stale", async () => {
    let calls = 0;
    const app = testApp(async (u) => {
      calls += 1;
      if (calls === 1) return bundle(u, { activities: recentDays(2, "flaky") });
      throw new Error("upstream exploded");
    });
    const agent = await registerAgent(app, "mod9f");
    await connect(agent, "CODEFORCES", "flakycf01");
    const failed = await agent.post("/api/platform-accounts/CODEFORCES/sync");
    expect(failed.status).toBe(502);
    const res = await agent.get("/api/activity/streak");
    expect(res.body.data.streak.totalActiveDays).toBe(2);
    const cf = res.body.data.coverage.platforms.find(
      (p: { platform: string }) => p.platform === "CODEFORCES"
    );
    expect(cf.history).toBe("error");
  });
});

describe.skipIf(!hasDb)("activity query validation", () => {
  it("rejects bad days, ranges, timezones, and pagination", async () => {
    const app = testApp(async (u) => bundle(u));
    const agent = await registerAgent(app, "mod9v");
    expect((await agent.get("/api/activity/days?days=0")).status).toBe(400);
    expect((await agent.get("/api/activity/days?days=9999")).status).toBe(400);
    expect((await agent.get("/api/activity/days?timezone=Mars%2FOlympus")).status).toBe(400);
    expect((await agent.get("/api/activity/streak?timezone=nope")).status).toBe(400);
    expect((await agent.get("/api/activity/recent?limit=0")).status).toBe(400);
    expect((await agent.get("/api/activity/recent?limit=500")).status).toBe(400);
    expect((await agent.get("/api/activity/recent?platform=STEAM")).status).toBe(400);
    expect((await agent.get("/api/activity/recent?type=BOGUS")).status).toBe(400);
  });

  it("clamps future end dates to today instead of failing", async () => {
    const app = testApp(async (u) => bundle(u));
    const agent = await registerAgent(app, "mod9w");
    const res = await agent.get("/api/activity/days?days=3&end=2999-01-01");
    expect(res.status).toBe(200);
    expect(res.body.data.days).toHaveLength(3);
    expect(new Date(res.body.data.range.end) <= new Date()).toBe(true);
  });

  it("buckets events by the requested timezone", async () => {
    const app = testApp(async (u) =>
      bundle(u, {
        // 00:30 UTC Jan 2 = Dec 31 in New York, Jan 2 in UTC.
        activities: [activity("tz-1", new Date("2026-01-02T00:30:00Z"), "TZ1")],
      })
    );
    const agent = await registerAgent(app, "mod9t");
    await connect(agent, "CODEFORCES", "tzcf001");
    const ny = await agent.get("/api/activity/days?days=2&end=2026-01-02&timezone=America%2FNew_York");
    expect(ny.body.data.days).toEqual([
      { date: "2026-01-01", count: 1, platforms: ["CODEFORCES"] },
      { date: "2026-01-02", count: 0, platforms: [] },
    ]);
    const utc = await agent.get("/api/activity/days?days=2&end=2026-01-02&timezone=UTC");
    expect(utc.body.data.days).toEqual([
      { date: "2026-01-01", count: 0, platforms: [] },
      { date: "2026-01-02", count: 1, platforms: ["CODEFORCES"] },
    ]);
  });
});

describe.skipIf(!hasDb)("activity unique solved totals", () => {
  function solved(
    externalId: string,
    occurredAt: Date,
    problemId: string | null,
    type: "PROBLEM_SOLVED" | "CONTEST_PARTICIPATION" = "PROBLEM_SOLVED"
  ): SyncBundle["activities"][number] {
    return { externalId, type, problemId, difficulty: null, occurredAt };
  }

  it("deduplicates repeat solves and excludes contests and null identifiers", async () => {
    const day = new Date("2026-04-01T12:00:00Z");
    const app = testApp(async (u) =>
      bundle(u, {
        activities: [
          solved("dup-1", day, "DUP"),
          solved("dup-2", day, "DUP"),
          solved("dup-3", day, "DUP"),
          solved("other-1", day, "OTHER"),
          solved("contest-1", day, "Round 9", "CONTEST_PARTICIPATION"),
          solved("noid-1", day, null),
        ],
      })
    );
    const agent = await registerAgent(app, "mod9d");
    await connect(agent, "CODEFORCES", "dupcf001");
    const res = await agent.get("/api/activity/streak");
    expect(res.status).toBe(200);
    // 3 submissions, 1 distinct problem: only unique solves count.
    expect(res.body.data.totals.uniqueSolvedByPlatform).toEqual({ CODEFORCES: 2 });
    // Official platform-reported totals ride alongside tracked solves.
    expect(res.body.data.totals.officialSolvedByPlatform).toEqual({ CODEFORCES: 10 });
    // Raw event counts are unchanged (backward compatible).
    expect(res.body.data.totals.total).toBe(6);
    expect(res.body.data.totals.byPlatform).toEqual({ CODEFORCES: 6 });
    expect(res.body.data.totals.byType).toEqual({ PROBLEM_SOLVED: 5, CONTEST_PARTICIPATION: 1 });
  });

  it("counts per platform without a date filter and omits empty platforms", async () => {
    // GFG-style adapters import no activity: the mock returns rows only
    // for CF/LC so the test mirrors real adapter behavior.
    const withActivity = (platform: PlatformId): PlatformAdapter => ({
      platform,
      fetchAll: async (u) =>
        bundle(u, { activities: [solved(`old-${platform}-${u}`, new Date("2020-01-05T12:00:00Z"), "OLD")] }),
    });
    const quiet = (platform: PlatformId): PlatformAdapter => ({
      platform,
      fetchAll: async (u) => bundle(u),
    });
    const app = createApp({
      platformAdapters: {
        CODEFORCES: withActivity("CODEFORCES"),
        LEETCODE: withActivity("LEETCODE"),
        GEEKSFORGEEKS: quiet("GEEKSFORGEEKS"),
      },
    });
    const agent = await registerAgent(app, "mod9o");
    await connect(agent, "CODEFORCES", "oldcf001");
    await connect(agent, "LEETCODE", "oldlc001");
    await connect(agent, "GEEKSFORGEEKS", "oldgfg001");
    const res = await agent.get("/api/activity/streak");
    const unique = res.body.data.totals.uniqueSolvedByPlatform;
    // A 2020 event still counts: the metric has no date filter.
    expect(unique).toEqual({ CODEFORCES: 1, LEETCODE: 1 });
    // GFG has no solved rows: absent, never a fabricated zero.
    expect("GEEKSFORGEEKS" in unique).toBe(false);
  });
});

describe.skipIf(!hasDb)("activity recent feed", () => {
  it("paginates newest-first with platform and type filters", async () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      activity(`pg-${i}`, new Date(Date.UTC(2026, 0, 10 - i, 12)), `PG${i}`)
    );
    const app = testApp(async (u) => bundle(u, { activities: events }));
    const agent = await registerAgent(app, "mod9p");
    await connect(agent, "CODEFORCES", "pagecf01");
    const page1 = await agent.get("/api/activity/recent?limit=2&offset=0");
    expect(page1.status).toBe(200);
    expect(page1.body.data.pagination).toMatchObject({ limit: 2, offset: 0, total: 5 });
    expect(page1.body.data.items.map((x: { problemIdentifier: string }) => x.problemIdentifier)).toEqual([
      "PG0",
      "PG1",
    ]);
    expect(page1.body.data.items[0].platformUsername).toBe("pagecf01");
    const page2 = await agent.get("/api/activity/recent?limit=2&offset=2");
    expect(page2.body.data.items.map((x: { problemIdentifier: string }) => x.problemIdentifier)).toEqual([
      "PG2",
      "PG3",
    ]);
    const filtered = await agent.get("/api/activity/recent?platform=LEETCODE");
    expect(filtered.body.data.pagination.total).toBe(0);
    const typed = await agent.get("/api/activity/recent?type=CONTEST_PARTICIPATION");
    expect(typed.body.data.pagination.total).toBe(0);
  });
});

describe.skipIf(!hasDb)("activity calendar merge", () => {
  /** UTC-midnight days ending today (consecutive). */
  function recentMidnights(n: number): Date[] {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    return Array.from({ length: n }, (_, i) => new Date(today.getTime() - (n - 1 - i) * 86_400_000));
  }

  function lcCalendarBundle(counts: number[]) {
    const days = recentMidnights(counts.length);
    return {
      activities: [] as SyncBundle["activities"],
      dailyActivity: {
        days: days.map((date, i) => ({ date, submissions: counts[i] })),
        complete: true as const,
      },
    };
  }

  it("counts calendar days toward totals, days, streaks, and coverage", async () => {
    const app = testApp(async (u) => bundle(u, lcCalendarBundle([2, 3, 1])));
    const agent = await registerAgent(app, "m9c");
    await connect(agent, "LEETCODE", "callc001");
    const res = await agent.get("/api/activity/streak");
    expect(res.status).toBe(200);
    // 2+3+1 submissions, no event rows at all.
    expect(res.body.data.totals.total).toBe(6);
    expect(res.body.data.totals.byPlatform).toEqual({ LEETCODE: 6 });
    expect(res.body.data.totals.byType).toEqual({ SUBMISSION: 6 });
    expect(res.body.data.streak.current).toBe(3);
    expect(res.body.data.streak.totalActiveDays).toBe(3);
    expect(res.body.data.streak.todayActive).toBe(true);
    // Individually tracked solves stay absent — never invented from counts.
    expect(res.body.data.totals.uniqueSolvedByPlatform).toEqual({});
    const coverage = res.body.data.coverage.platforms.find(
      (p: { platform: string }) => p.platform === "LEETCODE"
    );
    expect(coverage.calendarDays).toBe(3);
    expect(typeof coverage.calendarFrom).toBe("string");
    expect(typeof coverage.calendarTo).toBe("string");
    // Heatmap buckets carry the calendar counts per day.
    const days = await agent.get("/api/activity/days?days=3");
    expect(days.status).toBe(200);
    expect(days.body.data.days.map((d: { count: number }) => d.count)).toEqual([2, 3, 1]);
  });

  it("never double-counts recent rows on calendar-covered days", async () => {
    const [d0, d1] = recentMidnights(2);
    const app = testApp(async (u) =>
      bundle(u, {
        activities: [
          {
            externalId: "rc-1",
            type: "PROBLEM_SOLVED",
            problemId: "two-sum",
            difficulty: null,
            // Same UTC day as the calendar row below (also inside it).
            occurredAt: new Date(d0.getTime() + 15 * 3_600_000),
          },
        ],
        dailyActivity: {
          days: [
            { date: d0, submissions: 5 },
            { date: d1, submissions: 1 },
          ],
          complete: true,
        },
      })
    );
    const agent = await registerAgent(app, "m9d");
    await connect(agent, "LEETCODE", "dbllc001");
    const res = await agent.get("/api/activity/streak");
    expect(res.status).toBe(200);
    // 5 + 1 calendar submissions; the recent row is represented already.
    expect(res.body.data.totals.total).toBe(6);
    // ...but the identifiable solve survives in solved sets.
    expect(res.body.data.totals.uniqueSolvedByPlatform).toEqual({ LEETCODE: 1 });
  });

  it("counts uncovered recent rows normally and keeps timezone totals stable", async () => {
    const [d0] = recentMidnights(1);
    const app = testApp(async (u) =>
      bundle(u, {
        activities: [
          {
            externalId: "rc-new",
            type: "PROBLEM_SOLVED",
            problemId: "fresh-solve",
            difficulty: null,
            occurredAt: new Date(d0.getTime() + 2 * 3_600_000),
          },
        ],
        dailyActivity: { days: [], complete: true },
      })
    );
    const agent = await registerAgent(app, "m9u");
    await connect(agent, "LEETCODE", "unclc001");
    const utc = await agent.get("/api/activity/streak?timezone=UTC");
    expect(utc.status).toBe(200);
    expect(utc.body.data.totals.total).toBe(1);
    expect(utc.body.data.totals.uniqueSolvedByPlatform).toEqual({ LEETCODE: 1 });
    // Far-ahead timezone still sees the submission exactly once.
    const akl = await agent.get("/api/activity/streak?timezone=Pacific/Auckland");
    expect(akl.status).toBe(200);
    expect(akl.body.data.totals.total).toBe(1);
    expect(akl.body.data.streak.totalActiveDays).toBe(1);
  });

  it("drops legacy SUBMISSION rows on covered days but keeps stale-only days", async () => {
    const [d0] = recentMidnights(1);
    const stale = new Date(d0.getTime() - 30 * 86_400_000);
    const app = testApp(async (u) =>
      bundle(u, {
        activities: [
          {
            externalId: "legacy-covered",
            type: "SUBMISSION",
            problemId: null,
            difficulty: null,
            occurredAt: new Date(d0.getTime() + 3_600_000),
          },
          {
            externalId: "legacy-stale",
            type: "SUBMISSION",
            problemId: null,
            difficulty: null,
            occurredAt: stale,
          },
        ],
        dailyActivity: { days: [{ date: d0, submissions: 4 }], complete: true },
      })
    );
    const agent = await registerAgent(app, "m9l");
    await connect(agent, "LEETCODE", "leglc001");
    const res = await agent.get("/api/activity/streak");
    expect(res.status).toBe(200);
    // Covered day: calendar count 4 wins, legacy row dropped. Stale day:
    // no daily row covers it, so the legacy row still counts once.
    expect(res.body.data.totals.total).toBe(5);
    expect(res.body.data.totals.byType).toEqual({ SUBMISSION: 5 });
  });
});
