import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";
import { applyRanks } from "../src/modules/leaderboards/service";
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

/**
 * The global board sees every opted-in row in the test database, so each
 * test removes its own users when it finishes — otherwise earlier tests in
 * this file would leak into later tests' boards. Room-scoped tests do not
 * need this, but global assertions do.
 */
let testEmails: string[] = [];

afterEach(async () => {
  await cleanupUsers(testEmails);
  testEmails = [];
});

afterAll(async () => {
  await cleanupUsers(trackedEmails);
});

const HOUR = 3_600_000;
const agoHours = (h: number) => new Date(Date.now() - h * HOUR);

function stats(overrides: Partial<SyncBundle["stats"]> = {}): SyncBundle["stats"] {
  return {
    totalSolved: 20,
    contestRating: 1500,
    contestsAttended: 3,
    currentStreak: null,
    longestStreak: null,
    extra: {},
    ...overrides,
  };
}

function bundle(username: string, overrides: Partial<SyncBundle> = {}): SyncBundle {
  return {
    canonicalUsername: username,
    stats: stats(),
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

function adapters(
  fetchAll: (platform: PlatformId, username: string) => Promise<SyncBundle>
): Record<PlatformId, PlatformAdapter> {
  const make = (platform: PlatformId): PlatformAdapter => ({
    platform,
    fetchAll: (username) => fetchAll(platform, username),
  });
  return {
    CODEFORCES: make("CODEFORCES"),
    LEETCODE: make("LEETCODE"),
    CODECHEF: make("CODECHEF"),
    GEEKSFORGEEKS: make("GEEKSFORGEEKS"),
    HACKERRANK: make("HACKERRANK"),
  };
}

const emptyAdapters = () =>
  adapters(async (platform, username) => bundle(`${username}-${platform}`, { activities: [] }));

interface TestUser {
  agent: ReturnType<typeof request.agent>;
  id: string;
  username: string;
}

async function register(
  app: ReturnType<typeof createApp>,
  prefix = "mod14"
): Promise<TestUser> {
  const agent = request.agent(app);
  const email = uniqueEmail(prefix);
  trackedEmails.push(email);
  testEmails.push(email);
  const username = uniqueUsername(`${prefix}user`);
  const res = await agent.post("/api/auth/register").send({
    username,
    email,
    password: "validpassword123",
  });
  expect(res.status).toBe(201);
  return { agent, id: res.body.data.user.id as string, username };
}

async function optIn(agent: TestUser["agent"], show = true) {
  const res = await agent.patch("/api/users/me").send({ showOnLeaderboard: show });
  expect(res.status).toBe(200);
}

async function connect(
  agent: TestUser["agent"],
  platform: string,
  username: string
): Promise<void> {
  const res = await agent
    .post(`/api/platform-accounts/${platform}/connect`)
    .send({ username });
  expect(res.status).toBe(201);
}

async function recalculate(agent: TestUser["agent"]): Promise<void> {
  const res = await agent.post("/api/rating/recalculate");
  expect(res.status).toBe(200);
}

// Platform usernames cap at 50 chars, so tests use short unique handles
// (generated CodePulse usernames alone would overflow with a prefix).
let handleCounter = 0;
function handle(prefix: string): string {
  handleCounter += 1;
  return `${prefix}${handleCounter}`;
}

describe("applyRanks boundaries", () => {
  it("ranks nothing for an empty board and ranks a lone row first", () => {
    expect(applyRanks([])).toEqual([]);
    const row = {
      userId: "u1",
      username: "solo",
      displayName: null,
      avatarUrl: null,
      score: 10,
      detail: {},
    };
    expect(applyRanks([row])).toMatchObject([{ rank: 1, score: 10 }]);
  });

  it("shares ranks on ties without depending on input order", () => {
    const rows = [
      { userId: "u2", username: "b", displayName: null, avatarUrl: null, score: 5, detail: {} },
      { userId: "u1", username: "a", displayName: null, avatarUrl: null, score: 5, detail: {} },
    ];
    const ranked = applyRanks(
      [...rows].sort((x, y) => y.score - x.score || (x.username < y.username ? -1 : 1))
    );
    expect(ranked.map((e) => [e.rank, e.user.username])).toEqual([
      [1, "a"],
      [1, "b"],
    ]);
  });
});

describe.skipIf(!hasDb)("leaderboard validation and auth", () => {
  it("rejects bad metric, period, and pagination values", async () => {
    const app = createApp({ platformAdapters: emptyAdapters() });
    const { agent } = await register(app, "mod14v");
    expect((await agent.get("/api/leaderboards/global?metric=nope")).status).toBe(400);
    expect((await agent.get("/api/leaderboards/global?period=1d")).status).toBe(400);
    expect((await agent.get("/api/leaderboards/global?limit=0")).status).toBe(400);
    expect((await agent.get("/api/leaderboards/global?page=0")).status).toBe(400);
    expect((await agent.get("/api/leaderboards/global?limit=500")).status).toBe(400);
  });

  it("is public globally but requires auth for rooms", async () => {
    const app = createApp({ platformAdapters: emptyAdapters() });
    expect((await request(app).get("/api/leaderboards/global")).status).toBe(200);
    expect((await request(app).get("/api/leaderboards/rooms/whatever")).status).toBe(401);
  });

  it("hides private rooms from non-members with a generic 404", async () => {
    const app = createApp({ platformAdapters: emptyAdapters() });
    const alice = await register(app, "mod14a");
    const bob = await register(app, "mod14b");
    const created = await alice.agent.post("/api/rooms").send({ name: "Secret board room" });
    expect(created.status).toBe(201);
    const roomId = created.body.data.room.id as string;
    expect((await bob.agent.get(`/api/leaderboards/rooms/${roomId}`)).status).toBe(404);
    expect(
      (await bob.agent.get(`/api/leaderboards/rooms/00000000-0000-4000-8000-000000000000`)).status
    ).toBe(404);
    expect((await alice.agent.get("/api/leaderboards/rooms/not-a-uuid")).status).toBe(400);
  });
});

describe.skipIf(!hasDb)("global activity and solved boards", () => {
  it("orders by active days with competition ranks and deterministic ties", async () => {
    const app = createApp({
      platformAdapters: adapters(async (_platform, username) => {
        const extraDays = username.endsWith("busy") ? 3 : 0;
        const activities = [solved("a1", agoHours(2), "P1"), solved("a2", agoHours(26), "P2")];
        for (let d = 0; d < extraDays; d += 1) {
          activities.push(solved(`x${d}`, agoHours(50 + d * 24), `PX${d}`));
        }
        return bundle(username, { activities });
      }),
    });
    // Both users get identical 2-day histories: shared rank 1,
    // username-ascending order.
    const alice = await register(app, "mod14t");
    const bob = await register(app, "mod14u");
    await optIn(alice.agent);
    await optIn(bob.agent);
    await connect(alice.agent, "CODEFORCES", handle("cf"));
    await connect(bob.agent, "CODEFORCES", handle("cf"));

    const res = await alice.agent.get("/api/leaderboards/global?metric=activity&period=7d");
    expect(res.status).toBe(200);
    const entries = res.body.data.entries as Array<{
      rank: number;
      user: { username: string };
      score: number;
    }>;
    expect(res.body.data.pagination.total).toBe(2);
    // Identical 2-day histories: shared rank 1, username-ascending order.
    expect(entries.map((e) => e.score)).toEqual([2, 2]);
    expect(entries.map((e) => e.rank)).toEqual([1, 1]);
    const names = entries.map((e) => e.user.username);
    expect(names).toEqual([...names].sort());
  });

  it("ranks a busier user first and skips the tied rank", async () => {
    const app = createApp({
      platformAdapters: adapters(async (_platform, username) => {
        const activities = [solved("a1", agoHours(2), "P1")];
        if (username.includes("busy")) {
          activities.push(solved("a2", agoHours(26), "P2"), solved("a3", agoHours(50), "P3"));
        }
        return bundle(username, { activities });
      }),
    });
    const busy = await register(app, "m14b");
    const quiet = await register(app, "m14q");
    const alsoBusy = await register(app, "m14b");
    await optIn(busy.agent);
    await optIn(quiet.agent);
    await optIn(alsoBusy.agent);
    await connect(busy.agent, "CODEFORCES", handle("cfbusy"));
    await connect(quiet.agent, "CODEFORCES", handle("cfquiet"));
    await connect(alsoBusy.agent, "CODEFORCES", handle("cfbusy"));

    const res = await busy.agent.get("/api/leaderboards/global?metric=activity&period=7d");
    const entries = res.body.data.entries as Array<{ rank: number; score: number }>;
    expect(entries.map((e) => e.score)).toEqual([3, 3, 1]);
    // Standard competition ranking: 1,1,3.
    expect(entries.map((e) => e.rank)).toEqual([1, 1, 3]);
  });

  it("counts the same problem id on two platforms as two solves", async () => {
    const app = createApp({
      platformAdapters: adapters(async (platform, username) => {
        if (platform === "CODEFORCES") {
          return bundle(username, {
            activities: [
              solved("cf-1", agoHours(2), "SAME-1"),
              solved("cf-2", agoHours(3), "SAME-1"), // same-platform duplicate: one solve
              solved("cf-3", agoHours(4), "CF-ONLY"),
            ],
          });
        }
        return bundle(username, {
          activities: [solved("lc-1", agoHours(2), "SAME-1")], // cross-platform: distinct
        });
      }),
    });
    const alice = await register(app, "mod14d");
    await optIn(alice.agent);
    await connect(alice.agent, "CODEFORCES", handle("cf"));
    await connect(alice.agent, "LEETCODE", handle("lc"));

    const res = await alice.agent.get("/api/leaderboards/global?metric=solved&period=7d");
    expect(res.status).toBe(200);
    expect(res.body.data.entries).toHaveLength(1);
    // CF:SAME-1 + CF:CF-ONLY + LC:SAME-1 = 3, not 2.
    expect(res.body.data.entries[0].score).toBe(3);
    expect(res.body.data.entries[0].detail).toMatchObject({ solved: 3 });
  });

  it("paginates deterministically and reports the viewer row", async () => {
    const app = createApp({
      platformAdapters: adapters(async (_platform, username) =>
        bundle(username, { activities: [solved("a1", agoHours(2), "P1")] })
      ),
    });
    const users: TestUser[] = [];
    for (let i = 0; i < 3; i += 1) {
      const u = await register(app, "mod14p");
      await optIn(u.agent);
      await connect(u.agent, "CODEFORCES", handle("cf"));
      users.push(u);
    }
    const page1 = await users[0].agent.get(
      "/api/leaderboards/global?metric=activity&period=7d&limit=2&page=1"
    );
    expect(page1.body.data.pagination).toMatchObject({ page: 1, limit: 2, total: 3 });
    expect(page1.body.data.entries).toHaveLength(2);
    const page2 = await users[0].agent.get(
      "/api/leaderboards/global?metric=activity&period=7d&limit=2&page=2"
    );
    expect(page2.body.data.entries).toHaveLength(1);
    // Same rows in the same order across pages (username-asc tie order).
    const all = [...page1.body.data.entries, ...page2.body.data.entries].map(
      (e: { user: { username: string } }) => e.user.username
    );
    expect(all).toEqual([...all].sort());
    // The viewer row resolves through the session cookie.
    expect(page1.body.data.me).toMatchObject({ user: { id: users[0].id } });
  });
});

describe.skipIf(!hasDb)("leaderboard privacy and eligibility", () => {
  it("hides opted-out users globally but shows them in their rooms", async () => {
    const app = createApp({
      platformAdapters: adapters(async (_platform, username) =>
        bundle(username, { activities: [solved("a1", agoHours(2), "P1")] })
      ),
    });
    const alice = await register(app, "mod14h");
    const bob = await register(app, "mod14s");
    await optIn(alice.agent);
    // Bob stays opted out (the default).
    await connect(alice.agent, "CODEFORCES", handle("cf"));
    await connect(bob.agent, "CODEFORCES", handle("cf"));

    const global = await request(app).get("/api/leaderboards/global?metric=activity&period=7d");
    const names = (global.body.data.entries as Array<{ user: { username: string } }>).map(
      (e) => e.user.username
    );
    expect(names).toContain(alice.username);
    expect(names).not.toContain(bob.username);

    // Room boards follow membership, not the global opt-in.
    const created = await alice.agent.post("/api/rooms").send({ name: "Privacy room" });
    const roomId = created.body.data.room.id as string;
    const invite = await alice.agent.post(`/api/rooms/${roomId}/invitations`).send({});
    await bob.agent.post(`/api/rooms/invitations/${invite.body.data.token}/accept`);
    const room = await alice.agent.get(`/api/leaderboards/rooms/${roomId}?metric=activity&period=7d`);
    expect(room.status).toBe(200);
    const roomNames = (room.body.data.entries as Array<{ user: { username: string } }>).map(
      (e) => e.user.username
    );
    expect(roomNames).toContain(alice.username);
    expect(roomNames).toContain(bob.username);

    // Opting back out removes the user from the global board.
    await optIn(alice.agent, false);
    const after = await request(app).get("/api/leaderboards/global?metric=activity&period=7d");
    expect(after.body.data.pagination.total).toBe(0);
  });

  it("omits users with no ranking data instead of zero-ranking them", async () => {
    const app = createApp({
      platformAdapters: adapters(async (_platform, username) => bundle(username)),
    });
    const alice = await register(app, "mod14e");
    await optIn(alice.agent);
    // No platform connected, no snapshots: nothing to rank.
    for (const metric of ["cpr", "activity", "solved", "streak"] as const) {
      const res = await alice.agent.get(`/api/leaderboards/global?metric=${metric}`);
      expect(res.status).toBe(200);
      expect(res.body.data.entries).toEqual([]);
      expect(res.body.data.pagination.total).toBe(0);
      expect(res.body.data.me).toBeNull();
    }
  });

  it("exposes only public identity fragments, never emails", async () => {
    const app = createApp({
      platformAdapters: adapters(async (_platform, username) =>
        bundle(username, { activities: [solved("a1", agoHours(2), "P1")] })
      ),
    });
    const alice = await register(app, "mod14f");
    await optIn(alice.agent);
    await connect(alice.agent, "CODEFORCES", handle("cf"));
    const res = await request(app).get("/api/leaderboards/global?metric=activity&period=7d");
    expect(res.body.data.entries).toHaveLength(1);
    expect(Object.keys(res.body.data.entries[0].user).sort()).toEqual([
      "avatarUrl",
      "displayName",
      "id",
      "username",
    ]);
  });
});

describe.skipIf(!hasDb)("cpr leaderboard", () => {
  it("ranks identical snapshots as a username-ordered tie with version metadata", async () => {
    const app = createApp({
      platformAdapters: adapters(async (_platform, username) =>
        bundle(username, {
          stats: stats({ totalSolved: 50, contestRating: 1600, contestsAttended: 4 }),
          activities: [solved("a1", agoHours(2), "P1"), solved("a2", agoHours(26), "P2")],
        })
      ),
    });
    const alice = await register(app, "mod14c");
    const bob = await register(app, "mod14g");
    await optIn(alice.agent);
    await optIn(bob.agent);
    await connect(alice.agent, "CODEFORCES", handle("cf"));
    await connect(bob.agent, "CODEFORCES", handle("cf"));
    await recalculate(alice.agent);
    await recalculate(bob.agent);

    const res = await alice.agent.get("/api/leaderboards/global?metric=cpr");
    expect(res.status).toBe(200);
    expect(res.body.data.formulaVersion).toBe("1.0.0");
    expect(res.body.data.period).toBeNull();
    const entries = res.body.data.entries as Array<{
      rank: number;
      score: number;
      user: { username: string };
      provisional?: boolean;
      detail: { rating: number };
    }>;
    expect(entries).toHaveLength(2);
    expect(entries[0].score).toBe(entries[1].score);
    expect(entries.map((e) => e.rank)).toEqual([1, 1]);
    const names = entries.map((e) => e.user.username);
    expect(names).toEqual([...names].sort());
    expect(typeof entries[0].provisional).toBe("boolean");
    expect(entries[0].detail.rating).toBe(entries[0].score);
    expect(res.body.data.me).toMatchObject({ user: { id: alice.id } });
  });

  it("excludes snapshots stamped with an old formula version", async () => {
    const app = createApp({
      platformAdapters: adapters(async (_platform, username) =>
        bundle(username, { activities: [solved("a1", agoHours(2), "P1")] })
      ),
    });
    const alice = await register(app, "mod14o");
    await optIn(alice.agent);
    await connect(alice.agent, "CODEFORCES", handle("cf"));
    // A huge stale-version rating that must never win the board.
    await prisma.ratingSnapshot.create({
      data: {
        userId: alice.id,
        rating: 9999,
        contestScore: 9999,
        problemSolvingScore: 9999,
        consistencyScore: 9999,
        formulaVersion: "0.0.0",
      },
    });
    const res = await request(app).get("/api/leaderboards/global?metric=cpr");
    expect(res.status).toBe(200);
    expect(res.body.data.entries).toEqual([]);
  });

  it("orders distinct ratings strictly descending with sequential ranks", async () => {
    // No platform fetches happen here, so the default adapters are never
    // invoked; snapshots are seeded directly to isolate ranking order.
    const app = createApp();
    const high = await register(app, "m14hi");
    const mid = await register(app, "m14mi");
    const low = await register(app, "m14lo");
    await optIn(high.agent);
    await optIn(mid.agent);
    await optIn(low.agent);
    // Direct snapshots isolate ranking order from rating-engine inputs:
    // distinct stored ratings must board highest-first, ranks 1-2-3.
    for (const [user, rating] of [
      [low, 400],
      [high, 800],
      [mid, 600],
    ] as const) {
      await prisma.ratingSnapshot.create({
        data: {
          userId: user.id,
          rating,
          contestScore: rating,
          problemSolvingScore: rating,
          consistencyScore: rating,
          formulaVersion: "1.0.0",
        },
      });
    }
    const res = await request(app).get("/api/leaderboards/global?metric=cpr");
    expect(res.status).toBe(200);
    const entries = res.body.data.entries as Array<{
      rank: number;
      score: number;
      user: { id: string };
    }>;
    expect(entries.map((e) => e.score)).toEqual([800, 600, 400]);
    expect(entries.map((e) => e.rank)).toEqual([1, 2, 3]);
    expect(entries.map((e) => e.user.id)).toEqual([high.id, mid.id, low.id]);
  });

  it("returns empty entries past the last page while keeping the total", async () => {
    const app = createApp({
      platformAdapters: adapters(async (_platform, username) =>
        bundle(username, { activities: [solved("a1", agoHours(2), "P1")] })
      ),
    });
    const alice = await register(app, "mod14q");
    await optIn(alice.agent);
    await connect(alice.agent, "CODEFORCES", handle("cf"));
    const res = await request(app).get(
      "/api/leaderboards/global?metric=activity&period=7d&limit=5&page=99"
    );
    expect(res.status).toBe(200);
    expect(res.body.data.entries).toEqual([]);
    expect(res.body.data.pagination).toMatchObject({ page: 99, limit: 5, total: 1 });
  });
});

describe.skipIf(!hasDb)("streak leaderboard", () => {
  it("orders equal current streaks by longest streak, then username", async () => {
    const app = createApp({
      platformAdapters: adapters(async (_platform, username) => {
        const activities = [solved("now", agoHours(2), "P1"), solved("yd", agoHours(26), "P2")];
        if (username.includes("veteran")) {
          for (let d = 10; d <= 14; d += 1) {
            activities.push(solved(`old${d}`, agoHours(d * 24 + 2), `OLD${d}`));
          }
        }
        return bundle(username, { activities });
      }),
    });
    const newcomer = await register(app, "mod14n");
    const veteran = await register(app, "m14v");
    await optIn(newcomer.agent);
    await optIn(veteran.agent);
    await connect(newcomer.agent, "CODEFORCES", handle("cfnew"));
    await connect(veteran.agent, "CODEFORCES", handle("cfveteran"));

    const res = await newcomer.agent.get("/api/leaderboards/global?metric=streak");
    expect(res.status).toBe(200);
    expect(res.body.data.period).toBeNull();
    const entries = res.body.data.entries as Array<{
      rank: number;
      score: number;
      user: { username: string; id: string };
      detail: { streak: number };
    }>;
    expect(entries).toHaveLength(2);
    // Both current streaks are 2; the veteran's longest (5) wins the order.
    expect(entries.map((e) => e.score)).toEqual([2, 2]);
    expect(entries.map((e) => e.rank)).toEqual([1, 1]);
    expect(entries[0].user.id).toBe(veteran.id);
    expect(entries[0].detail.streak).toBe(2);
    expect(res.body.data.note).toMatch(/365 days/);
  });
});

describe.skipIf(!hasDb)("room leaderboard content", () => {
  it("scopes room boards to members and paginates them", async () => {
    const app = createApp({
      platformAdapters: adapters(async (_platform, username) =>
        bundle(username, { activities: [solved("a1", agoHours(2), "P1")] })
      ),
    });
    const alice = await register(app, "mod14r");
    const bob = await register(app, "mod14m");
    const carol = await register(app, "mod14z");
    await optIn(alice.agent);
    await optIn(carol.agent);
    await connect(alice.agent, "CODEFORCES", handle("cf"));
    await connect(bob.agent, "CODEFORCES", handle("cf"));
    await connect(carol.agent, "CODEFORCES", handle("cf"));

    const created = await alice.agent.post("/api/rooms").send({ name: "Board room" });
    const roomId = created.body.data.room.id as string;
    const invite = await alice.agent.post(`/api/rooms/${roomId}/invitations`).send({});
    await bob.agent.post(`/api/rooms/invitations/${invite.body.data.token}/accept`);

    // Carol is opted in and active but not a member: excluded.
    const page = await alice.agent.get(
      `/api/leaderboards/rooms/${roomId}?metric=activity&period=7d&limit=1&page=1`
    );
    expect(page.status).toBe(200);
    expect(page.body.data.pagination).toMatchObject({ page: 1, limit: 1, total: 2 });
    const page2 = await alice.agent.get(
      `/api/leaderboards/rooms/${roomId}?metric=activity&period=7d&limit=1&page=2`
    );
    expect(page2.body.data.entries).toHaveLength(1);
    const both = [
      ...page.body.data.entries,
      ...page2.body.data.entries,
    ].map((e: { user: { username: string } }) => e.user.username);
    expect(both).not.toContain(carol.username);
    expect(page.body.data.me).toMatchObject({ user: { id: alice.id } });
  });
});

describe.skipIf(!hasDb)("leaderboard calendar union", () => {
  /** UTC-midnight days ending today (consecutive). */
  function recentMidnights(n: number): Date[] {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    return Array.from({ length: n }, (_, i) => new Date(today.getTime() - (n - 1 - i) * 86_400_000));
  }

  function lcCalendarApp(counts: number[]) {
    const days = recentMidnights(counts.length);
    return createApp({
      platformAdapters: adapters(async (_platform, username) =>
        bundle(username, {
          activities: [],
          dailyActivity: {
            days: days.map((date, i) => ({ date, submissions: counts[i] })),
            complete: true,
          },
        })
      ),
    });
  }

  it("ranks calendar days on activity boards without leaking into solved", async () => {
    const app = lcCalendarApp([3, 1]);
    const alice = await register(app, "m14a");
    await optIn(alice.agent);
    await connect(alice.agent, "LEETCODE", handle("lc"));

    const activity = await alice.agent.get("/api/leaderboards/global?metric=activity&period=7d");
    expect(activity.status).toBe(200);
    expect(activity.body.data.entries).toHaveLength(1);
    expect(activity.body.data.entries[0]).toMatchObject({
      score: 2,
      detail: { activeDays: 2, events: 4 },
    });

    // Calendar counts never qualify as solved: the user is absent here.
    const solved = await alice.agent.get("/api/leaderboards/global?metric=solved&period=7d");
    expect(solved.status).toBe(200);
    expect(solved.body.data.entries).toEqual([]);
    expect(solved.body.data.me).toBeNull();
  });

  it("counts calendar days toward streak boards", async () => {
    const app = lcCalendarApp([1, 2, 1]);
    const alice = await register(app, "m14b");
    await optIn(alice.agent);
    await connect(alice.agent, "LEETCODE", handle("lc"));
    const res = await alice.agent.get("/api/leaderboards/global?metric=streak");
    expect(res.status).toBe(200);
    expect(res.body.data.entries).toHaveLength(1);
    expect(res.body.data.entries[0].score).toBe(3);
  });
});
