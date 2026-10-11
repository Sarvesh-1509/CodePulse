import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/db/prisma";
import { createApp } from "../src/app";
import type {
  PlatformAdapter,
  SyncBundle,
} from "../src/modules/platforms/adapters";
import { PlatformError } from "../src/modules/platforms/errors";
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
  await prisma.$disconnect();
});

// --- Mock adapters (no network; deterministic bundles) ---

function testBundle(username: string, overrides: Partial<SyncBundle> = {}): SyncBundle {
  return {
    canonicalUsername: username,
    stats: {
      totalSolved: 10,
      contestRating: 1500,
      contestsAttended: 5,
      currentStreak: null,
      longestStreak: null,
      extra: { handle: username },
    },
    activities: [
      {
        externalId: "t-1",
        type: "PROBLEM_SOLVED",
        problemId: "1A",
        difficulty: "800",
        occurredAt: new Date("2024-01-01T00:00:00Z"),
      },
    ],
    contests: [
      {
        externalId: "t-c1",
        name: "Round 1",
        contestedAt: new Date("2024-01-02T00:00:00Z"),
        ratingBefore: 1400,
        ratingChange: 100,
        ratingAfter: 1500,
        rank: 100,
      },
    ],
    ...overrides,
  };
}

function mockAdapter(
  platform: PlatformId,
  fetchAll: (username: string) => Promise<SyncBundle>
): PlatformAdapter {
  return { platform, fetchAll };
}

function mockAdapters(): Record<PlatformId, PlatformAdapter> {
  return {
    CODEFORCES: mockAdapter("CODEFORCES", async (u) => testBundle(u)),
    LEETCODE: mockAdapter("LEETCODE", async (u) => testBundle(u)),
    CODECHEF: mockAdapter("CODECHEF", async (u) => testBundle(u)),
    GEEKSFORGEEKS: mockAdapter("GEEKSFORGEEKS", async (u) => testBundle(u)),
    HACKERRANK: mockAdapter("HACKERRANK", async (u) => testBundle(u)),
  };
}

function testApp(adapters = mockAdapters()) {
  // Inject mock adapters through createApp so the router is mounted in the
  // correct middleware order (before the 404 handler).
  return createApp({ platformAdapters: adapters });
}

async function registerAgent(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  const email = uniqueEmail("mod3");
  trackedEmails.push(email);
  const res = await agent.post("/api/auth/register").send({
    username: uniqueUsername("mod3user"),
    email,
    password: "validpassword123",
  });
  expect(res.status).toBe(201);
  return agent;
}

// All tests below use the real mount path with injected mock adapters.
const BASE = "/api/platform-accounts";

describe.skipIf(!hasDb)("GET /api/platforms", () => {
  it("lists all platforms with availability flags (public, no auth)", async () => {
    const app = createApp();
    const res = await request(app).get("/api/platforms");
    expect(res.status).toBe(200);
    const platforms = res.body.data.platforms;
    expect(platforms).toHaveLength(5);
    const byId = Object.fromEntries(platforms.map((p: { id: string }) => [p.id, p]));
    expect(byId.CODEFORCES.available).toBe(true);
    expect(byId.CODEFORCES.capabilities).toContain("sync");
    expect(byId.LEETCODE.available).toBe(true);
    // Modules 6-8: integrated with honest capability sets (no activity
    // timelines where the source exposes none).
    expect(byId.CODECHEF.available).toBe(true);
    expect(byId.CODECHEF.capabilities).toEqual(
      expect.arrayContaining(["profile", "stats", "contests", "sync"])
    );
    expect(byId.CODECHEF.capabilities).not.toContain("activity");
    expect(byId.GEEKSFORGEEKS.available).toBe(true);
    expect(byId.GEEKSFORGEEKS.capabilities).not.toContain("activity");
    expect(byId.GEEKSFORGEEKS.capabilities).not.toContain("contests");
    expect(byId.HACKERRANK.available).toBe(true);
    expect(byId.HACKERRANK.capabilities).not.toContain("activity");
  });
});

describe.skipIf(!hasDb)("platform account authentication", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const app = testApp();
    expect((await request(app).get(BASE)).status).toBe(401);
    expect(
      (await request(app).post(`${BASE}/CODEFORCES/connect`).send({ username: "x" }))
        .status
    ).toBe(401);
    expect((await request(app).delete(`${BASE}/CODEFORCES`)).status).toBe(401);
    expect((await request(app).post(`${BASE}/CODEFORCES/sync`)).status).toBe(401);
  });

  it("returns an empty list for users with no linked accounts", async () => {
    const app = testApp();
    const agent = await registerAgent(app);
    const res = await agent.get(BASE);
    expect(res.status).toBe(200);
    expect(res.body.data.accounts).toEqual([]);
  });
});

describe.skipIf(!hasDb)("connect validation", () => {
  it("rejects unknown platform identifiers with 400", async () => {
    const app = testApp();
    const agent = await registerAgent(app);
    const res = await agent.post(`${BASE}/STEAM/connect`).send({ username: "x" });
    expect(res.status).toBe(400);
  });

  it("accepts lowercase platform identifiers", async () => {
    const app = testApp();
    const agent = await registerAgent(app);
    const res = await agent.post(`${BASE}/codeforces/connect`).send({ username: "cfuser1" });
    expect(res.status).toBe(201);
    expect(res.body.data.account.platform).toBe("CODEFORCES");
  });

  it("does not create false connections when the adapter is missing", async () => {
    // Availability is registry-driven, but a platform without a wired
    // adapter must still fail safely (502) instead of a false success.
    const app = createApp({ platformAdapters: {} });
    const agent = await registerAgent(app);
    const res = await agent.post(`${BASE}/CODECHEF/connect`).send({ username: "someuser" });
    expect(res.status).toBe(502);
    const list = await agent.get(BASE);
    expect(list.body.data.accounts).toEqual([]);
    // Scoped to this user: nothing was linked by the rejected attempts.
    const me = await agent.get("/api/auth/me");
    const userId = me.body.data.user.id as string;
    expect(
      await prisma.linkedAccount.count({ where: { userId } })
    ).toBe(0);
  });

  it("rejects malformed usernames and bodies with 400", async () => {
    const app = testApp();
    const agent = await registerAgent(app);
    expect(
      (await agent.post(`${BASE}/CODEFORCES/connect`).send({ username: "ab" })).status
    ).toBe(400);
    expect(
      (await agent.post(`${BASE}/CODEFORCES/connect`).send({ username: "has space" }))
        .status
    ).toBe(400);
    expect((await agent.post(`${BASE}/CODEFORCES/connect`).send({})).status).toBe(400);
  });

  it("returns a clear error and creates no row when verification fails", async () => {
    const adapters = mockAdapters();
    adapters.CODEFORCES = mockAdapter("CODEFORCES", async () => {
      throw new PlatformError("not-found", 'Codeforces handle "ghost" was not found.');
    });
    const app = testApp(adapters);
    const agent = await registerAgent(app);
    const res = await agent.post(`${BASE}/CODEFORCES/connect`).send({ username: "ghostuser" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not found/);
    expect(
      await prisma.linkedAccount.count({ where: { platformUsername: "ghostuser" } })
    ).toBe(0);
  });
});

describe.skipIf(!hasDb)("connect + duplicate handling", () => {
  it("connects an account with persisted stats (numbers, not strings)", async () => {
    const app = testApp();
    const agent = await registerAgent(app);
    const res = await agent.post(`${BASE}/LEETCODE/connect`).send({ username: "lcuser1" });
    expect(res.status).toBe(201);
    const account = res.body.data.account;
    expect(account.platformUsername).toBe("lcuser1");
    expect(account.connectionStatus).toBe("CONNECTED");
    expect(account.lastSyncedAt).not.toBeNull();
    expect(account.stats.totalSolved).toBe(10);
    expect(typeof account.stats.contestRating).toBe("number");
    expect(account.stats.contestRating).toBe(1500);

    const persisted = await prisma.platformStats.findFirstOrThrow({
      where: { linkedAccount: { platformUsername: "lcuser1" } },
    });
    expect(persisted.totalSolved).toBe(10);
  });

  it("rejects duplicate connections with 409 (explicit replace required)", async () => {
    const app = testApp();
    const agent = await registerAgent(app);
    await agent.post(`${BASE}/CODEFORCES/connect`).send({ username: "cfuser2" });
    const dup = await agent.post(`${BASE}/CODEFORCES/connect`).send({ username: "othername" });
    expect(dup.status).toBe(409);

    const list = await agent.get(BASE);
    const cf = list.body.data.accounts.filter(
      (a: { platform: string }) => a.platform === "CODEFORCES"
    );
    expect(cf).toHaveLength(1);
    expect(cf[0].platformUsername).toBe("cfuser2");
  });

  it("concurrent connects create exactly one row (unique constraint wins)", async () => {
    const adapters = mockAdapters();
    adapters.CODEFORCES = mockAdapter("CODEFORCES", async (u) => {
      await new Promise((r) => setTimeout(r, 50));
      return testBundle(u);
    });
    const app = testApp(adapters);
    const agent = await registerAgent(app);
    const handle = `raceruser${Date.now()}`;
    const [a, b] = await Promise.allSettled([
      agent.post(`${BASE}/CODEFORCES/connect`).send({ username: handle }),
      agent.post(`${BASE}/CODEFORCES/connect`).send({ username: handle }),
    ]);
    const statuses = [a, b]
      .map((r) => (r.status === "fulfilled" ? r.value.status : -1))
      .sort();
    expect(statuses).toEqual([201, 409]);
    const rows = await prisma.linkedAccount.findMany({
      where: { platformUsername: handle },
    });
    expect(rows).toHaveLength(1);
  });
});

describe.skipIf(!hasDb)("disconnect", () => {
  it("removes the account, stats, and activities without deleting the user", async () => {
    const app = testApp();
    const agent = await registerAgent(app);
    await agent.post(`${BASE}/CODEFORCES/connect`).send({ username: "byeuser1" });

    const account = await prisma.linkedAccount.findFirstOrThrow({
      where: { platformUsername: "byeuser1" },
    });
    expect(
      await prisma.activityEvent.count({ where: { linkedAccountId: account.id } })
    ).toBe(1);

    const res = await agent.delete(`${BASE}/CODEFORCES`);
    expect(res.status).toBe(200);
    expect(await prisma.linkedAccount.findUnique({ where: { id: account.id } })).toBeNull();
    expect(
      await prisma.platformStats.count({ where: { linkedAccountId: account.id } })
    ).toBe(0);
    expect(
      await prisma.activityEvent.count({ where: { linkedAccountId: account.id } })
    ).toBe(0);

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
  });

  it("returns 404 for missing accounts", async () => {
    const app = testApp();
    const agent = await registerAgent(app);
    expect((await agent.delete(`${BASE}/LEETCODE`)).status).toBe(404);
    expect((await agent.delete(`${BASE}/STEAM`)).status).toBe(400);
  });

  it("one user cannot disconnect another user's account", async () => {
    const app = testApp();
    const alice = await registerAgent(app);
    const bob = await registerAgent(app);
    await alice.post(`${BASE}/CODEFORCES/connect`).send({ username: "alicecf01" });

    expect((await bob.delete(`${BASE}/CODEFORCES`)).status).toBe(404);
    const list = await alice.get(BASE);
    expect(
      list.body.data.accounts.filter((a: { platform: string }) => a.platform === "CODEFORCES")
    ).toHaveLength(1);
  });
});

describe.skipIf(!hasDb)("sync", () => {
  it("returns 404 when nothing is linked", async () => {
    const app = testApp();
    const agent = await registerAgent(app);
    expect((await agent.post(`${BASE}/LEETCODE/sync`)).status).toBe(404);
  });

  it("refreshes stats and updates the sync timestamp", async () => {
    let total = 10;
    const adapters = mockAdapters();
    adapters.CODEFORCES = mockAdapter("CODEFORCES", async (u) =>
      testBundle(u, {
        stats: { ...testBundle(u).stats, totalSolved: total },
      })
    );
    const app = testApp(adapters);
    const agent = await registerAgent(app);
    const connected = await agent.post(`${BASE}/CODEFORCES/connect`).send({ username: "syncuser1" });
    const before = connected.body.data.account.lastSyncedAt;

    total = 42;
    const synced = await agent.post(`${BASE}/CODEFORCES/sync`);
    expect(synced.status).toBe(200);
    expect(synced.body.data.account.stats.totalSolved).toBe(42);
    expect(synced.body.data.account.connectionStatus).toBe("CONNECTED");
    expect(synced.body.data.account.lastSyncedAt).not.toBe(before);
  });

  it("preserves last known good stats when a sync response omits metrics", async () => {
    // A drifted upstream response carries nulls for metrics it previously
    // reported. Null means "unknown" and must not wipe stored values.
    let drifted = false;
    const adapters = mockAdapters();
    adapters.CODEFORCES = mockAdapter("CODEFORCES", async (u) =>
      drifted
        ? testBundle(u, {
            stats: {
              totalSolved: null,
              contestRating: null,
              contestsAttended: null,
              currentStreak: null,
              longestStreak: null,
              extra: { handle: u },
            },
          })
        : testBundle(u)
    );
    const app = testApp(adapters);
    const agent = await registerAgent(app);
    const connected = await agent.post(`${BASE}/CODEFORCES/connect`).send({ username: "driftuser1" });
    expect(connected.body.data.account.stats.totalSolved).toBe(10);

    drifted = true;
    const synced = await agent.post(`${BASE}/CODEFORCES/sync`);
    expect(synced.status).toBe(200);
    // Stored aggregates survive; the sync timestamp still advances.
    expect(synced.body.data.account.stats).toMatchObject({
      totalSolved: 10,
      contestRating: 1500,
      contestsAttended: 5,
    });
    expect(synced.body.data.account.lastSyncedAt).not.toBe(
      connected.body.data.account.lastSyncedAt
    );
  });

  it("failed refresh preserves stats and timestamp, records a clean error", async () => {
    let calls = 0;
    const adapters = mockAdapters();
    adapters.LEETCODE = mockAdapter("LEETCODE", async (u) => {
      calls += 1;
      if (calls === 1) return testBundle(u);
      throw new PlatformError("upstream", "The platform returned HTTP 500.");
    });
    const app = testApp(adapters);
    const agent = await registerAgent(app);
    const connected = await agent.post(`${BASE}/LEETCODE/connect`).send({ username: "failuser1" });
    const goodStats = connected.body.data.account.stats;
    const goodSyncedAt = connected.body.data.account.lastSyncedAt;

    const failed = await agent.post(`${BASE}/LEETCODE/sync`);
    expect(failed.status).toBe(502);
    expect(failed.body.success).toBe(false);

    const list = await agent.get(BASE);
    const account = list.body.data.accounts[0];
    expect(account.connectionStatus).toBe("ERROR");
    expect(account.lastSyncedAt).toBe(goodSyncedAt);
    expect(account.stats).toEqual(goodStats);
    expect(typeof account.lastSyncError).toBe("string");
    expect(JSON.stringify(account)).not.toMatch(/stack|Trace/i);
  });

  it("incremental refresh unions solved keys instead of shrinking the total", async () => {
    // Regression: a refresh that fetches only new submissions must not
    // overwrite the full known total with the window's smaller count.
    let calls = 0;
    const adapters = mockAdapters();
    adapters.CODEFORCES = mockAdapter("CODEFORCES", async (u) => {
      calls += 1;
      if (calls === 1) {
        return testBundle(u, {
          stats: { ...testBundle(u).stats, totalSolved: 2 },
          activities: [
            { externalId: "cf-1001", type: "PROBLEM_SOLVED", problemId: "AAA", difficulty: null, occurredAt: new Date("2024-01-01T00:00:00Z") },
            { externalId: "cf-1002", type: "PROBLEM_SOLVED", problemId: "BBB", difficulty: null, occurredAt: new Date("2024-01-02T00:00:00Z") },
          ],
          contests: [],
        });
      }
      return testBundle(u, {
        stats: { ...testBundle(u).stats, totalSolved: 1 },
        activities: [
          { externalId: "cf-1003", type: "PROBLEM_SOLVED", problemId: "CCC", difficulty: null, occurredAt: new Date("2024-01-03T00:00:00Z") },
        ],
        contests: [],
      });
    });
    const app = testApp(adapters);
    const agent = await registerAgent(app);
    const connected = await agent.post(`${BASE}/CODEFORCES/connect`).send({ username: "unionuser1" });
    expect(connected.body.data.account.stats.totalSolved).toBe(2);
    const synced = await agent.post(`${BASE}/CODEFORCES/sync`);
    expect(synced.status).toBe(200);
    // 2 known + 1 new = 3, not the window count of 1.
    expect(synced.body.data.account.stats.totalSolved).toBe(3);
  });

  it("repeated syncs do not duplicate activities or contests", async () => {
    const app = testApp();
    const agent = await registerAgent(app);
    await agent.post(`${BASE}/CODEFORCES/connect`).send({ username: "idemuser1" });
    await agent.post(`${BASE}/CODEFORCES/sync`);
    await agent.post(`${BASE}/CODEFORCES/sync`);

    const account = await prisma.linkedAccount.findFirstOrThrow({
      where: { platformUsername: "idemuser1" },
    });
    expect(
      await prisma.activityEvent.count({ where: { linkedAccountId: account.id } })
    ).toBe(1);
    expect(
      await prisma.contestResult.count({ where: { linkedAccountId: account.id } })
    ).toBe(1);
  });

  it(
    "concurrent syncs: one runs, the other gets 409",
    { timeout: 30000 },
    async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const adapters = mockAdapters();
    adapters.CODEFORCES = mockAdapter("CODEFORCES", async (u) => {
      calls += 1;
      // First call is the connect (resolves immediately); the sync waits.
      if (calls > 1) await gate;
      return testBundle(u);
    });
    const app = testApp(adapters);
    const agent = await registerAgent(app);
    await agent.post(`${BASE}/CODEFORCES/connect`).send({ username: "lockuser1" });

    const firstPromise = agent.post(`${BASE}/CODEFORCES/sync`).then((r) => r);
    // Wait until the first sync observably holds the lock (SYNCING status).
    let syncing = false;
    for (let i = 0; i < 40 && !syncing; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      const row = await prisma.linkedAccount.findFirst({
        where: { platformUsername: "lockuser1" },
      });
      syncing = row?.connectionStatus === "SYNCING";
    }
    expect(syncing).toBe(true);
    const second = await agent.post(`${BASE}/CODEFORCES/sync`);
    expect(second.status).toBe(409);
    release();
    expect((await firstPromise).status).toBe(200);
    }
  );

  it(
    "sync endpoint is rate-limited",
    { timeout: 30000 },
    async () => {
    const app = testApp();
    const agent = await registerAgent(app);
    await agent.post(`${BASE}/LEETCODE/connect`).send({ username: "rateuser1" });
    let last = 0;
    for (let i = 0; i < 21; i += 1) {
      last = (await agent.post(`${BASE}/LEETCODE/sync`)).status;
    }
    expect(last).toBe(429);
    }
  );
});
