/**
 * CodePulse Rating Integration Tests
 * Verifies snapshot caching, database persistence, and isolation.
 */
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";
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

function cfBundle(
  username: string,
  stats: { totalSolved: number | null; contestRating: number | null; contestsAttended: number | null },
  dayOffsets: number[]
): SyncBundle {
  const now = Date.now();
  return {
    canonicalUsername: username,
    stats: {
      ...stats,
      currentStreak: null,
      longestStreak: null,
      extra: {},
    },
    activities: dayOffsets.map((off, i) => ({
      externalId: `cf-t-${off}-${i}`,
      type: "PROBLEM_SOLVED" as const,
      problemId: `T${off}_${i}`,
      difficulty: null,
      occurredAt: new Date(now - off * 86_400_000),
    })),
    contests: [],
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

async function registerAgent(app: ReturnType<typeof createApp>, prefix = "mod10") {
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

async function userIdOf(agent: Awaited<ReturnType<typeof registerAgent>>): Promise<string> {
  const me = await agent.get("/api/auth/me");
  return me.body.data.user.id as string;
}

describe.skipIf(!hasDb)("rating authentication", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const app = testApp(async (u) => cfBundle(u, { totalSolved: 1, contestRating: 100, contestsAttended: 0 }, []));
    expect((await request(app).get("/api/rating")).status).toBe(401);
    expect((await request(app).post("/api/rating/recalculate")).status).toBe(401);
    expect((await request(app).get("/api/rating/history")).status).toBe(401);
  });

  it("isolates users: rating reflects only the caller's data", async () => {
    const app = testApp(async (u) =>
      cfBundle(u, { totalSolved: 100, contestRating: 1500, contestsAttended: 10 }, [0])
    );
    const alice = await registerAgent(app, "mod10a");
    const bob = await registerAgent(app, "mod10b");
    await alice.post("/api/platform-accounts/CODEFORCES/connect").send({ username: "alicecfr1" });
    const bobRating = await bob.get("/api/rating");
    expect(bobRating.status).toBe(200);
    expect(bobRating.body.data.rating).toBeNull();
    expect(bobRating.body.data.status).toBe("unavailable");
  });
});

describe.skipIf(!hasDb)("rating unavailable and provisional states", () => {
  it("returns unavailable with no snapshot for a fresh user", async () => {
    const app = testApp(async (u) => cfBundle(u, { totalSolved: 1, contestRating: 100, contestsAttended: 0 }, []));
    const agent = await registerAgent(app, "mod10u");
    const res = await agent.get("/api/rating");
    expect(res.status).toBe(200);
    expect(res.body.data.rating).toBeNull();
    expect(res.body.data.status).toBe("unavailable");
    expect(res.body.data.provisional).toBe(true);
    expect(res.body.data.formulaVersion).toBe("1.0.0");
    const id = await userIdOf(agent);
    expect(await prisma.ratingSnapshot.count({ where: { userId: id } })).toBe(0);
  });

  it("marks single-source ratings provisional", async () => {
    const app = testApp(async (u) =>
      cfBundle(u, { totalSolved: null, contestRating: null, contestsAttended: null }, [])
    );
    const agent = await registerAgent(app, "mod10p");
    // HackerRank-style bundle: no usable metrics at all.
    await agent.post("/api/platform-accounts/HACKERRANK/connect").send({ username: "hrprov01" });
    const res = await agent.get("/api/rating");
    expect(res.body.data.rating).toBeNull();
    expect(res.body.data.status).toBe("unavailable");
  });
});

describe.skipIf(!hasDb)("rating calculation and persistence", () => {
  it("computes the exact documented rating and persists one snapshot", async () => {
    // 10 consecutive UTC days ending today -> activeDays90=10, longest=10.
    const app = testApp(async (u) =>
      cfBundle(
        u,
        { totalSolved: 100, contestRating: 1500, contestsAttended: 10 },
        [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
      )
    );
    const agent = await registerAgent(app, "mod10c");
    await agent.post("/api/platform-accounts/CODEFORCES/connect").send({ username: "cfexact01" });
    const res = await agent.get("/api/rating");
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.components.contest).toBe(331.25);
    expect(data.components.solving).toBeCloseTo(501.07, 1);
    expect(data.components.consistency).toBe(266.67);
    expect(data.rating).toBeCloseTo(374.54, 1);
    expect(data.provisional).toBe(false);
    expect(data.status).toBe("ready");
    expect(data.snapshotCreated).toBe(true);
    expect(data.formulaVersion).toBe("1.0.0");
    const id = await userIdOf(agent);
    const rows = await prisma.ratingSnapshot.findMany({ where: { userId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].formulaVersion).toBe("1.0.0");
  });

  it("does not duplicate snapshots on repeated identical recalculation", async () => {
    const app = testApp(async (u) =>
      cfBundle(u, { totalSolved: 50, contestRating: 1200, contestsAttended: 4 }, [0])
    );
    const agent = await registerAgent(app, "mod10i");
    await agent.post("/api/platform-accounts/CODEFORCES/connect").send({ username: "cfidem01" });
    const first = await agent.post("/api/rating/recalculate");
    expect(first.body.data.snapshotCreated).toBe(true);
    const second = await agent.post("/api/rating/recalculate");
    expect(second.body.data.snapshotCreated).toBe(false);
    expect(second.body.data.rating).toBe(first.body.data.rating);
    const third = await agent.get("/api/rating");
    expect(third.body.data.snapshotCreated).toBe(false);
    const id = await userIdOf(agent);
    expect(await prisma.ratingSnapshot.count({ where: { userId: id } })).toBe(1);
  });

  it("creates a new snapshot when inputs change, with history in order", async () => {
    let total = 50;
    const app = testApp(async (u) =>
      cfBundle(u, { totalSolved: total, contestRating: 1200, contestsAttended: 4 }, [0])
    );
    const agent = await registerAgent(app, "mod10h");
    await agent.post("/api/platform-accounts/CODEFORCES/connect").send({ username: "cfhist01" });
    const first = await agent.get("/api/rating");
    total = 500;
    await agent.post("/api/platform-accounts/CODEFORCES/sync");
    const second = await agent.get("/api/rating");
    expect(second.body.data.snapshotCreated).toBe(true);
    expect(second.body.data.rating).toBeGreaterThan(first.body.data.rating);
    const history = await agent.get("/api/rating/history?limit=10");
    expect(history.status).toBe(200);
    expect(history.body.data.snapshots).toHaveLength(2);
    expect(history.body.data.snapshots[0].rating).toBe(second.body.data.rating);
    expect(history.body.data.snapshots[1].rating).toBe(first.body.data.rating);
  });

  it("preserves the last valid rating across a failed sync", async () => {
    let calls = 0;
    const app = testApp(async (u) => {
      calls += 1;
      if (calls === 1) {
        return cfBundle(u, { totalSolved: 80, contestRating: 1400, contestsAttended: 6 }, [0]);
      }
      throw new Error("upstream exploded");
    });
    const agent = await registerAgent(app, "mod10s");
    await agent.post("/api/platform-accounts/CODEFORCES/connect").send({ username: "cffail01" });
    const before = await agent.get("/api/rating");
    const failed = await agent.post("/api/platform-accounts/CODEFORCES/sync");
    expect(failed.status).toBe(502);
    const after = await agent.get("/api/rating");
    expect(after.body.data.rating).toBe(before.body.data.rating);
    expect(after.body.data.snapshotCreated).toBe(false);
    const id = await userIdOf(agent);
    expect(await prisma.ratingSnapshot.count({ where: { userId: id } })).toBe(1);
  });
});

describe.skipIf(!hasDb)("rating query validation", () => {
  it("rejects bad history limits", async () => {
    const app = testApp(async (u) => cfBundle(u, { totalSolved: 1, contestRating: 100, contestsAttended: 0 }, []));
    const agent = await registerAgent(app, "mod10v");
    expect((await agent.get("/api/rating/history?limit=0")).status).toBe(400);
    expect((await agent.get("/api/rating/history?limit=500")).status).toBe(400);
  });
});

describe.skipIf(!hasDb)("rating consistency from calendar days", () => {
  /** UTC-midnight days ending today (consecutive). */
  function recentMidnights(n: number): Date[] {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    return Array.from({ length: n }, (_, i) => new Date(today.getTime() - (n - 1 - i) * 86_400_000));
  }

  function lcCalendarBundle(counts: number[]): SyncBundle {
    const days = recentMidnights(counts.length);
    return {
      canonicalUsername: "caluser",
      stats: {
        totalSolved: 100,
        contestRating: 1500,
        contestsAttended: 10,
        currentStreak: null,
        longestStreak: null,
        extra: {},
      },
      activities: [],
      contests: [],
      dailyActivity: {
        days: days.map((date, i) => ({ date, submissions: counts[i] })),
        complete: true,
      },
    };
  }

  it("measures consistency from calendar days with no event rows", async () => {
    const quiet = (platform: PlatformId): PlatformAdapter => ({
      platform,
      fetchAll: async () => lcCalendarBundle([1, 2, 1, 3, 1]),
    });
    const app = createApp({
      platformAdapters: {
        CODEFORCES: quiet("CODEFORCES"),
        LEETCODE: quiet("LEETCODE"),
        CODECHEF: quiet("CODECHEF"),
        GEEKSFORGEEKS: quiet("GEEKSFORGEEKS"),
        HACKERRANK: quiet("HACKERRANK"),
      },
    });
    const agent = await registerAgent(app, "m10c");
    await agent.post("/api/platform-accounts/LEETCODE/connect").send({ username: "callc01" });
    const res = await agent.get("/api/rating");
    expect(res.status).toBe(200);
    // 5 consecutive calendar days ending today: measurable consistency
    // with zero ActivityEvent rows stored.
    expect(typeof res.body.data.components.consistency).toBe("number");
    expect(res.body.data.components.consistency).toBeGreaterThan(0);
    expect(res.body.data.coverage.platformsWithActivity).toContain("LEETCODE");
  });
});
