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

function solved(
  externalId: string,
  occurredAt: Date,
  problemId: string
): SyncBundle["activities"][number] {
  return { externalId, type: "PROBLEM_SOLVED", problemId, difficulty: null, occurredAt };
}

function contest(
  externalId: string,
  contestedAt: Date,
  ratingAfter: number | null = null
): SyncBundle["contests"][number] {
  return {
    externalId,
    name: `Contest ${externalId}`,
    contestedAt,
    ratingBefore: ratingAfter !== null ? ratingAfter - 50 : null,
    ratingChange: ratingAfter !== null ? 50 : null,
    ratingAfter,
    rank: 100,
  };
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

async function registerAgent(app: ReturnType<typeof createApp>, prefix = "mod12") {
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

// Fixed history: June 2026, UTC. Deterministic regardless of wall-clock time.
const D = (day: number, hour = 12) => new Date(Date.UTC(2026, 5, day, hour));

function historyBundle(): SyncBundle["activities"] {
  return [
    solved("h-1", D(1), "P1"),
    solved("h-2", D(1), "P1"), // duplicate problem, distinct submission
    solved("h-3", D(2), "P2"),
    solved("h-4", D(5), "P3"),
    solved("h-5", D(5), "P4"),
    solved("h-6", D(5), "P5"),
  ];
}

function historyContests(): SyncBundle["contests"] {
  return [
    contest("hc-1", D(3), 1600),
    contest("hc-2", D(10), 1650),
  ];
}

describe.skipIf(!hasDb)("analytics authentication", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const app = testApp(async (u) => bundle(u));
    for (const path of [
      "/api/analytics/summary?range=30d",
      "/api/analytics/trends?range=7d",
      "/api/analytics/compare?range=30d",
      "/api/analytics/platforms?range=30d",
      "/api/analytics/contests",
      "/api/analytics/ratings",
    ]) {
      expect((await request(app).get(path)).status).toBe(401);
    }
  });

  it("isolates users: one user cannot see another's analytics", async () => {
    const app = testApp(async (u) => bundle(u, { activities: historyBundle() }));
    const alice = await registerAgent(app, "mod12a");
    const bob = await registerAgent(app, "mod12b");
    await connect(alice, "CODEFORCES", "alicecf12");
    const res = await bob.get("/api/analytics/summary?range=30d&timezone=UTC");
    expect(res.status).toBe(200);
    expect(res.body.data.totals.events).toBe(0);
    expect(res.body.data.perPlatform).toEqual([]);
  });
});

describe.skipIf(!hasDb)("analytics validation", () => {
  it("rejects bad ranges, dates, timezones, and pagination", async () => {
    const app = testApp(async (u) => bundle(u));
    const agent = await registerAgent(app, "mod12v");
    expect((await agent.get("/api/analytics/trends?range=9d")).status).toBe(400);
    expect((await agent.get("/api/analytics/trends?range=30d&start=2026-06-01")).status).toBe(400);
    expect((await agent.get("/api/analytics/trends?start=2026-06-10&end=2026-06-01")).status).toBe(400);
    expect((await agent.get("/api/analytics/trends?start=2026-06-01&end=2020-01-01")).status).toBe(400);
    expect((await agent.get("/api/analytics/trends?start=2026-13-01&end=2026-13-02")).status).toBe(400);
    expect((await agent.get("/api/analytics/trends?start=2020-01-01&end=2025-01-01")).status).toBe(400);
    expect((await agent.get("/api/analytics/trends?range=30d&timezone=Nope")).status).toBe(400);
    expect((await agent.get("/api/analytics/contests?limit=0")).status).toBe(400);
    expect((await agent.get("/api/analytics/contests?limit=500")).status).toBe(400);
  });
});

describe.skipIf(!hasDb)("analytics summary", () => {
  it("aggregates totals, platforms, streak, CPR, and coverage honestly", async () => {
    const app = testApp(async (u) => bundle(u, { activities: historyBundle(), contests: historyContests() }));
    const agent = await registerAgent(app, "mod12s");
    await connect(agent, "CODEFORCES", "sumcf12");
    const res = await agent.get("/api/analytics/summary?start=2026-06-01&end=2026-06-30&timezone=UTC");
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.range).toMatchObject({ start: "2026-06-01", end: "2026-06-30" });
    expect(data.timezone).toBe("UTC");
    expect(data.totals.events).toBe(6);
    expect(data.totals.activeDays).toBe(3);
    expect(data.totals.solved).toBe(5);
    expect(data.perPlatform).toHaveLength(1);
    expect(data.perPlatform[0]).toMatchObject({
      platform: "CODEFORCES",
      events: 6,
      solved: 5,
      contests: 0,
      activeDays: 3,
      currentRating: 1500,
    });
    expect(data.streak).toMatchObject({ current: 0, longest: 2 });
    expect(data.contestsAttended).toBe(2);
    expect(Array.isArray(data.coverageNotes)).toBe(true);
  });

  it("reports empty states without inventing history", async () => {
    const app = testApp(async (u) => bundle(u));
    const agent = await registerAgent(app, "mod12e");
    const res = await agent.get("/api/analytics/summary?range=30d&timezone=UTC");
    expect(res.status).toBe(200);
    expect(res.body.data.totals).toMatchObject({ events: 0, activeDays: 0, solved: 0, contests: 0 });
    expect(res.body.data.perPlatform).toEqual([]);
    expect(res.body.data.cpr.rating).toBeNull();
  });
});

describe.skipIf(!hasDb)("analytics trends", () => {
  it("buckets daily for short ranges", async () => {
    const app = testApp(async (u) => bundle(u, { activities: historyBundle() }));
    const agent = await registerAgent(app, "mod12t");
    await connect(agent, "CODEFORCES", "trendcf12");
    const res = await agent.get("/api/analytics/trends?start=2026-06-01&end=2026-06-07&timezone=UTC");
    expect(res.status).toBe(200);
    expect(res.body.data.kind).toBe("daily");
    expect(res.body.data.buckets).toHaveLength(7);
    expect(res.body.data.buckets[0]).toMatchObject({ start: "2026-06-01", events: 2, solved: 1 });
    expect(res.body.data.buckets[4]).toMatchObject({ start: "2026-06-05", events: 3, solved: 3 });
  });

  it("buckets weekly for 90d spans and monthly for 1y spans", async () => {
    const app = testApp(async (u) => bundle(u, { activities: historyBundle(), contests: historyContests() }));
    const agent = await registerAgent(app, "mod12w");
    await connect(agent, "CODEFORCES", "trendcf90");
    // 92-day custom span -> weekly buckets; June events land in one bucket.
    const w = await agent.get("/api/analytics/trends?start=2026-05-01&end=2026-07-31&timezone=UTC");
    expect(w.body.data.kind).toBe("weekly");
    const totalEvents = w.body.data.buckets.reduce((n: number, b: { events: number }) => n + b.events, 0);
    expect(totalEvents).toBe(6);
    // 366-day custom span -> monthly buckets.
    const m = await agent.get("/api/analytics/trends?start=2025-10-01&end=2026-10-01&timezone=UTC");
    expect(m.body.data.kind).toBe("monthly");
    const june = m.body.data.buckets.find((b: { start: string }) => b.start === "2026-06");
    expect(june.events).toBe(6);
    expect(june.contests).toBe(0);
  });

  it("keeps weekday alignment across gaps", async () => {
    const app = testApp(async (u) =>
      bundle(u, {
        activities: [
          solved("g-1", D(7), "G1"), // Sunday 2026-06-07
          solved("g-2", D(13), "G2"), // Saturday 2026-06-13
        ],
      })
    );
    const agent = await registerAgent(app, "mod12g");
    await connect(agent, "CODEFORCES", "gapcf12");
    const res = await agent.get("/api/analytics/trends?start=2026-06-07&end=2026-06-13&timezone=UTC");
    expect(res.body.data.buckets).toHaveLength(7);
    expect(res.body.data.buckets[0].events).toBe(1);
    expect(res.body.data.buckets[6].events).toBe(1);
    expect(res.body.data.buckets.slice(1, 6).every((b: { events: number }) => b.events === 0)).toBe(true);
  });
});

describe.skipIf(!hasDb)("analytics compare", () => {
  it("compares equal periods with safe percentages", async () => {
    const app = testApp(async (u) =>
      bundle(u, {
        activities: [
          solved("c-1", D(28), "C1"),
          solved("c-2", D(29), "C2"),
          solved("c-3", D(30), "C3"),
          solved("c-4", D(15), "C0"),
        ],
      })
    );
    const agent = await registerAgent(app, "mod12p");
    await connect(agent, "CODEFORCES", "cmpcf12");
    // Custom 3-day window ending June 30: current Jun 28-30 (3 events),
    // previous Jun 25-27 (0 events) -> null deltas, honest note.
    const res = await agent.get("/api/analytics/compare?start=2026-06-28&end=2026-06-30&timezone=UTC");
    expect(res.status).toBe(200);
    expect(res.body.data.current).toMatchObject({ events: 3, activeDays: 3 });
    expect(res.body.data.previous).toBeNull();
    expect(res.body.data.deltaPct).toEqual({ events: null, activeDays: null, solved: null, contests: null });
    expect(typeof res.body.data.previousNote).toBe("string");
  });

  it("computes deltas when both periods have data", async () => {
    const app = testApp(async (u) =>
      bundle(u, {
        activities: [
          solved("d-1", D(29), "D1"),
          solved("d-2", D(30), "D2"),
          solved("d-3", D(27), "D0"),
        ],
      })
    );
    const agent = await registerAgent(app, "mod12q");
    await connect(agent, "CODEFORCES", "deltacf12");
    const res = await agent.get("/api/analytics/compare?start=2026-06-29&end=2026-06-30&timezone=UTC");
    // Current Jun 29-30: 2 events/2 days; previous Jun 27-28: 1 event/1 day.
    expect(res.body.data.deltaPct.events).toBe(100);
    expect(res.body.data.deltaPct.activeDays).toBe(100);
    expect(res.body.data.previousNote).toBeNull();
  });
});

describe.skipIf(!hasDb)("analytics contests and ratings", () => {
  it("paginates contest history newest-first with platform usernames", async () => {
    const app = testApp(async (u) => bundle(u, { contests: historyContests() }));
    const agent = await registerAgent(app, "mod12h");
    await connect(agent, "CODEFORCES", "contestcf12");
    const page = await agent.get("/api/analytics/contests?limit=1&offset=0");
    expect(page.status).toBe(200);
    expect(page.body.data.pagination).toMatchObject({ limit: 1, offset: 0, total: 2 });
    expect(page.body.data.items[0]).toMatchObject({
      platform: "CODEFORCES",
      platformUsername: "contestcf12",
      contestName: "Contest hc-2",
      ratingAfter: 1650,
    });
  });

  it("returns native rating points and CPR snapshots", async () => {
    const app = testApp(async (u) => bundle(u, { contests: historyContests() }));
    const agent = await registerAgent(app, "mod12r");
    await connect(agent, "CODEFORCES", "ratingcf12");
    await agent.post("/api/rating/recalculate");
    const res = await agent.get("/api/analytics/ratings");
    expect(res.status).toBe(200);
    expect(res.body.data.ratings).toHaveLength(2);
    expect(res.body.data.ratings[0]).toMatchObject({
      platform: "CODEFORCES",
      contestName: "Contest hc-1",
      ratingAfter: 1600,
    });
    expect(res.body.data.cpr.length).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.data.cpr[0].rating).toBe("number");
  });
});

describe.skipIf(!hasDb)("analytics platforms breakdown", () => {
  it("reports per-platform rows with ratings and sync times", async () => {
    const app = testApp(async (u) => bundle(u, { activities: historyBundle() }));
    const agent = await registerAgent(app, "mod12b");
    await connect(agent, "CODEFORCES", "breakcf12");
    await connect(agent, "LEETCODE", "breaklc12");
    const res = await agent.get("/api/analytics/platforms?range=30d&timezone=UTC");
    expect(res.status).toBe(200);
    expect(res.body.data.platforms).toHaveLength(2);
    const cf = res.body.data.platforms.find((p: { platform: string }) => p.platform === "CODEFORCES");
    expect(cf.currentRating).toBe(1500);
    expect(typeof cf.lastSyncedAt).toBe("string");
    // Official platform-reported totals ride alongside windowed metrics.
    expect(cf.totalSolvedAllTime).toBe(10);
    const lc = res.body.data.platforms.find((p: { platform: string }) => p.platform === "LEETCODE");
    expect(lc.totalSolvedAllTime).toBe(10);
  });
});

describe.skipIf(!hasDb)("analytics calendar history", () => {
  // Fixed UTC-midnight calendar days (deterministic regardless of wall clock).
  const cal = (entries: Array<[number, number, number, number]>) => ({
    days: entries.map(([y, m, d, count]) => ({
      date: new Date(Date.UTC(y, m - 1, d)),
      submissions: count,
    })),
    complete: true as const,
  });

  it("buckets calendar submissions across a year boundary without inventing solves", async () => {
    const app = testApp(async (u) =>
      bundle(u, {
        activities: [],
        dailyActivity: cal([
          [2024, 12, 28, 2],
          [2024, 12, 31, 1],
          [2025, 1, 2, 4],
          [2025, 1, 10, 1], // outside the custom window below
        ]),
      })
    );
    const agent = await registerAgent(app, "m12a");
    await connect(agent, "LEETCODE", "callc001");
    const res = await agent.get(
      "/api/analytics/trends?start=2024-12-28&end=2025-01-05&timezone=UTC"
    );
    expect(res.status).toBe(200);
    expect(res.body.data.kind).toBe("daily");
    const buckets = res.body.data.buckets as Array<{ start: string; events: number; solved: number }>;
    expect(buckets).toHaveLength(9);
    const byStart = Object.fromEntries(buckets.map((b) => [b.start, b]));
    expect(byStart["2024-12-28"].events).toBe(2);
    expect(byStart["2024-12-31"].events).toBe(1);
    expect(byStart["2025-01-02"].events).toBe(4);
    expect(byStart["2025-01-03"].events).toBe(0);
    // Calendar counts are activity, never unique solves.
    expect(buckets.every((b) => b.solved === 0)).toBe(true);
    expect(buckets.reduce((n, b) => n + b.events, 0)).toBe(7);
  });

  it("reports calendar submissions and days per platform without conflating solves", async () => {
    const app = testApp(async (u) =>
      bundle(u, {
        activities: [solved("r-1", D(15), "P1")],
        dailyActivity: cal([[2026, 6, 14, 3]]),
      })
    );
    const agent = await registerAgent(app, "m12b");
    await connect(agent, "LEETCODE", "cslc001");
    const res = await agent.get("/api/analytics/platforms?range=30d&timezone=UTC");
    expect(res.status).toBe(200);
    const lc = res.body.data.platforms.find((p: { platform: string }) => p.platform === "LEETCODE");
    // The June 14 calendar day falls outside the trailing 30d window;
    // assert types and consistency rather than fixed dates here.
    expect(typeof lc.calendarSubmissions).toBe("number");
    expect(typeof lc.calendarDays).toBe("number");
    expect(lc.solved).toBeLessThanOrEqual(1);
  });

  it("reports insufficient history when the previous window has no calendar data", async () => {
    // Calendar day lands in the current 3-day window only.
    const now = new Date();
    const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const app = testApp(async (u) =>
      bundle(u, {
        activities: [],
        dailyActivity: { days: [{ date: todayUTC, submissions: 2 }], complete: true },
      })
    );
    const agent = await registerAgent(app, "m12c");
    await connect(agent, "LEETCODE", "ihlc001");
    const start = new Date(todayUTC.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
    const end = todayUTC.toISOString().slice(0, 10);
    const res = await agent.get(
      `/api/analytics/compare?start=${start}&end=${end}&timezone=UTC`
    );
    expect(res.status).toBe(200);
    expect(res.body.data.current.events).toBe(2);
    // Previous 3-day window predates all history: null + explicit note.
    expect(res.body.data.previous).toBeNull();
    expect(res.body.data.previousNote).toMatch(/Insufficient history/);
    expect(res.body.data.deltaPct.events).toBeNull();
  });

  it("respects custom range boundaries for calendar rows", async () => {
    const app = testApp(async (u) =>
      bundle(u, {
        activities: [],
        dailyActivity: cal([
          [2026, 6, 10, 2],
          [2026, 6, 20, 3],
        ]),
      })
    );
    const agent = await registerAgent(app, "m12d");
    await connect(agent, "LEETCODE", "rglc001");
    const res = await agent.get("/api/analytics/summary?start=2026-06-01&end=2026-06-15&timezone=UTC");
    expect(res.status).toBe(200);
    expect(res.body.data.totals.events).toBe(2);
    expect(res.body.data.totals.activeDays).toBe(1);
    // Official totals still aggregate independently of the window.
    expect(res.body.data.totals.totalSolvedAllTime).toBe(10);
  });
});
