import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";
import {
  fetchLeetCodeProfile,
  LEETCODE_GRAPHQL_URL,
} from "../src/modules/leetcode/client";
import { createLeetCodeAdapter } from "../src/modules/leetcode/service";
import type {
  PlatformAdapter,
  SyncBundle,
} from "../src/modules/platforms/adapters";
import type { PlatformId } from "@codepulse/shared";
import { PlatformError } from "../src/modules/platforms/errors";
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

const DEPS = { timeoutMs: 2000 };

function graphqlResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function leetcodeStub(
  data: unknown,
  status = 200,
  extraSelections: Record<string, unknown> = {}
): typeof fetch {
  return (async (url: unknown, init: unknown) => {
    expect(String(url)).toBe(LEETCODE_GRAPHQL_URL);
    const body = JSON.parse(String((init as { body: string }).body));
    const operationName = body.operationName as string;
    if (operationName === "leetcodeCalendar") {
      return graphqlResponse(
        "calendar" in extraSelections
          ? extraSelections.calendar
          : { matchedUser: null },
        status
      );
    }
    if (operationName === "leetcodeContestHistory") {
      return graphqlResponse(
        "history" in extraSelections
          ? extraSelections.history
          : { userContestRankingHistory: null },
        status
      );
    }
    expect(operationName).toBe("leetcodeProfile");
    return graphqlResponse(data, status);
  }) as typeof fetch;
}

async function withStub<T>(stub: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

const fullProfile = {
  matchedUser: {
    username: "SomeUser",
    profile: { realName: "Some User", userAvatar: "https://example.com/a.png" },
    submitStatsGlobal: {
      acSubmissionNum: [
        { difficulty: "All", count: 500 },
        { difficulty: "Easy", count: 200 },
        { difficulty: "Medium", count: 250 },
        { difficulty: "Hard", count: 50 },
      ],
    },
  },
  userContestRanking: { attendedContestsCount: 12, rating: 1875.5 },
  recentAcSubmissionList: [
    { id: "111", title: "Two Sum", titleSlug: "two-sum", timestamp: "1700000000" },
    { id: "112", title: "Add Two Numbers", titleSlug: "add-two-numbers", timestamp: "1700000100" },
  ],
};

describe("leetcode profile parsing", () => {
  it("parses a valid public profile with splits and contest data", async () => {
    await withStub(leetcodeStub(fullProfile), async () => {
      const bundle = await fetchLeetCodeProfile("someuser", DEPS);
      expect(bundle.username).toBe("SomeUser");
      expect(bundle.realName).toBe("Some User");
      expect(bundle.solved).toEqual({ total: 500, easy: 200, medium: 250, hard: 50 });
      expect(bundle.contestsAttended).toBe(12);
      expect(bundle.contestRating).toBe(1875.5);
      expect(bundle.recentSubmissions).toHaveLength(2);
      expect(bundle.recentSubmissions[0]).toMatchObject({
        id: "111",
        titleSlug: "two-sum",
      });
      expect(bundle.activityUnsupported).toBe(false);
    });
  });

  it("rejects missing profiles", async () => {
    await withStub(leetcodeStub({ matchedUser: null }), async () => {
      const err = await fetchLeetCodeProfile("ghost", DEPS).catch((e) => e);
      expect(err).toBeInstanceOf(PlatformError);
      expect((err as PlatformError).kind).toBe("not-found");
    });
  });

  it("rejects mismatched usernames", async () => {
    await withStub(
      leetcodeStub({ matchedUser: { username: "someone-else" } }),
      async () => {
        const err = await fetchLeetCodeProfile("someuser", DEPS).catch((e) => e);
        expect((err as PlatformError).kind).toBe("not-found");
      }
    );
  });

  it("keeps optional statistics null when unavailable (never zero)", async () => {
    await withStub(
      leetcodeStub({
        matchedUser: { username: "bare", profile: null, submitStatsGlobal: null },
        userContestRanking: null,
        recentAcSubmissionList: null,
      }),
      async () => {
        const adapter = createLeetCodeAdapter(DEPS);
        const bundle = await adapter.fetchAll("bare");
        expect(bundle.stats.totalSolved).toBeNull();
        expect(bundle.stats.contestRating).toBeNull();
        expect(bundle.stats.contestsAttended).toBeNull();
        expect(bundle.stats.currentStreak).toBeNull();
        expect(bundle.stats.longestStreak).toBeNull();
        expect(bundle.activities).toEqual([]);
        expect(bundle.contests).toEqual([]);
      }
    );
  });

  it("marks activity unsupported on shape drift but still syncs the profile", async () => {
    await withStub(
      leetcodeStub({
        matchedUser: {
          username: "drifted",
          submitStatsGlobal: {
            acSubmissionNum: [{ difficulty: "All", count: 7 }],
          },
        },
        userContestRanking: null,
        recentAcSubmissionList: { totally: "different" },
      }),
      async () => {
        const adapter = createLeetCodeAdapter(DEPS);
        const bundle = await adapter.fetchAll("drifted");
        expect(bundle.stats.totalSolved).toBe(7);
        expect(bundle.activities).toEqual([]);
        expect(bundle.stats.extra).toMatchObject({ activityUnsupported: true });
      }
    );
  });

  it("rejects unreadable responses without fabricating data", async () => {
    await withStub(leetcodeStub(null), async () => {
      const err = await fetchLeetCodeProfile("someuser", DEPS).catch((e) => e);
      expect((err as PlatformError).kind).toBe("invalid-response");
    });
  });
});

describe("leetcode transport failures", () => {
  it("maps HTTP 429 to rate-limited without retrying", async () => {
    let calls = 0;
    const stub = (async () => {
      calls += 1;
      return new Response("{}", { status: 429 });
    }) as typeof fetch;
    await withStub(stub, async () => {
      const err = await fetchLeetCodeProfile("someuser", DEPS).catch((e) => e);
      expect((err as PlatformError).kind).toBe("rate-limited");
      expect(calls).toBe(1);
    });
  });

  it("maps aborts to timeout errors", async () => {
    const stub = (async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    }) as typeof fetch;
    await withStub(stub, async () => {
      const err = await fetchLeetCodeProfile("someuser", DEPS).catch((e) => e);
      expect((err as PlatformError).kind).toBe("timeout");
    });
  });

  it("maps network failures without leaking internals", async () => {
    const stub = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await withStub(stub, async () => {
      const err = await fetchLeetCodeProfile("someuser", DEPS).catch((e) => e);
      expect((err as PlatformError).kind).toBe("network");
      expect(String((err as Error).message)).not.toMatch(/ECONN|socket/i);
    });
  });
});

describe("leetcode adapter honesty", () => {
  it("never derives streaks and keeps native rating separate", async () => {
    await withStub(leetcodeStub(fullProfile), async () => {
      const adapter = createLeetCodeAdapter(DEPS);
      const bundle = await adapter.fetchAll("SomeUser");
      expect(bundle.stats.currentStreak).toBeNull();
      expect(bundle.stats.longestStreak).toBeNull();
      expect(bundle.stats.contestRating).toBe(1875.5);
      expect(bundle.stats.extra).toMatchObject({
        easySolved: 200,
        mediumSolved: 250,
        hardSolved: 50,
      });
      // Difficulty is not provided per submission: null, not invented.
      expect(bundle.activities[0].difficulty).toBeNull();
      expect(bundle.activities[0].externalId).toBe("lc-111");
    });
  });
});

function calendarSelection(days: Record<string, number>, username = "SomeUser") {
  return {
    matchedUser: {
      username,
      userCalendar: {
        activeYears: [2024, 2025],
        streak: 3,
        totalActiveDays: Object.keys(days).length,
        submissionCalendar: JSON.stringify(days),
      },
    },
  };
}

/** Adapter stub for platforms a test never syncs: fails loudly if called. */
function unused(platform: PlatformId): PlatformAdapter {
  return {
    platform,
    fetchAll: async () => {
      throw new Error(`unused adapter called: ${platform}`);
    },
  };
}

function historySelection(
  entries: Array<{
    attended?: boolean;
    rating?: number | null;
    title?: string;
    titleSlug?: string;
    startTime?: number;
  }>
) {
  return {
    userContestRankingHistory: entries.map((e) => ({
      attended: e.attended,
      rating: e.rating ?? null,
      trendDirection: "UP",
      contest:
        e.title === undefined
          ? null
          : { title: e.title, titleSlug: e.titleSlug ?? "x", startTime: e.startTime ?? 0 },
    })),
  };
}

describe("leetcode calendar history", () => {
  it("imports multi-year daily history with counts and order", async () => {
    const stub = leetcodeStub(fullProfile, 200, {
      calendar: calendarSelection({
        "1700006400": 2, // 2023-11-15
        "1735689600": 1, // 2025-01-01
        "1767225600": 5, // 2026-01-01
      }),
    });
    await withStub(stub, async () => {
      const bundle = await fetchLeetCodeProfile("someuser", DEPS);
      expect(bundle.calendarUnsupported).toBe(false);
      expect(bundle.calendarDays.map((d) => d.submissions)).toEqual([2, 1, 5]);
      expect(bundle.calendarDays[0].occurredAt).toEqual(new Date(1700006400 * 1000));
      expect(bundle.calendarDays[2].occurredAt).toEqual(new Date(1767225600 * 1000));
    });
  });

  it("maps calendar days to day aggregates, never to event rows", async () => {
    const stub = leetcodeStub(fullProfile, 200, {
      calendar: calendarSelection({ "1735689600": 2, "1735776000": 1 }),
    });
    await withStub(stub, async () => {
      const adapter = createLeetCodeAdapter(DEPS);
      const bundle = await adapter.fetchAll("SomeUser");
      // No per-submission expansion: calendar days must not become events.
      expect(bundle.activities.filter((a) => a.type === "SUBMISSION")).toEqual([]);
      expect(bundle.dailyActivity?.complete).toBe(true);
      expect(bundle.dailyActivity?.days).toEqual([
        { date: new Date(1735689600 * 1000), submissions: 2 },
        { date: new Date(1735776000 * 1000), submissions: 1 },
      ]);
      // ...so solved-problem counts only ever see the recent window.
      const solved = bundle.activities.filter(
        (a) => a.type === "PROBLEM_SOLVED" && a.problemId !== null
      );
      expect(solved).toHaveLength(2);
      // Aggregate totals stay authoritative and independent of the timeline.
      expect(bundle.stats.totalSolved).toBe(500);
      expect(bundle.stats.extra).toMatchObject({ calendarActiveDays: 2 });
    });
  });

  it("skips corrupt day keys and caps absurd counts", async () => {
    const stub = leetcodeStub(fullProfile, 200, {
      calendar: {
        matchedUser: {
          username: "SomeUser",
          userCalendar: {
            submissionCalendar: JSON.stringify({
              "1735689600": 3,
              "-5": 10,
              "not-a-day": 4,
              "9999999999": 2, // far-future day
              "1735776000": 1000000, // corrupt count, capped
            }),
          },
        },
      },
    });
    await withStub(stub, async () => {
      const adapter = createLeetCodeAdapter(DEPS);
      const bundle = await adapter.fetchAll("SomeUser");
      // 1 honest day + 1 capped day; corrupt keys contribute nothing, and
      // nothing expands into event rows.
      expect(bundle.dailyActivity?.days).toEqual([
        { date: new Date(1735689600 * 1000), submissions: 3 },
        { date: new Date(1735776000 * 1000), submissions: 1000 },
      ]);
      expect(bundle.activities.filter((a) => a.type === "SUBMISSION")).toEqual([]);
    });
  });

  it("treats a missing calendar as empty and a drifted one as unsupported", async () => {
    await withStub(leetcodeStub(fullProfile, 200), async () => {
      const bundle = await fetchLeetCodeProfile("someuser", DEPS);
      expect(bundle.calendarDays).toEqual([]);
      expect(bundle.calendarUnsupported).toBe(false);
    });
    const drifted = leetcodeStub(fullProfile, 200, {
      calendar: { matchedUser: { username: "SomeUser", userCalendar: { submissionCalendar: 42 } } },
    });
    await withStub(drifted, async () => {
      const bundle = await fetchLeetCodeProfile("someuser", DEPS);
      expect(bundle.calendarDays).toEqual([]);
      expect(bundle.calendarUnsupported).toBe(true);
      // The verified profile still syncs despite the drifted selection.
      expect(bundle.solved.total).toBe(500);
    });
  });

  it("never imports another user's calendar on username mismatch", async () => {
    const stub = leetcodeStub(fullProfile, 200, {
      calendar: calendarSelection({ "1735689600": 9 }, "someone-else"),
    });
    await withStub(stub, async () => {
      const bundle = await fetchLeetCodeProfile("someuser", DEPS);
      expect(bundle.calendarDays).toEqual([]);
    });
  });

  it("aborts the whole fetch when the calendar request fails transiently", async () => {
    let calls = 0;
    const stub = (async (url: unknown, init: unknown) => {
      const body = JSON.parse(String((init as { body: string }).body));
      calls += 1;
      if (body.operationName === "leetcodeCalendar") {
        return new Response("boom", { status: 500 });
      }
      return leetcodeStub(fullProfile, 200, {
        calendar: calendarSelection({}),
      })(url, init);
    }) as typeof fetch;
    await withStub(stub, async () => {
      const err = await fetchLeetCodeProfile("someuser", DEPS).catch((e) => e);
      expect((err as PlatformError).kind).toBe("upstream");
      // Profile + 3 calendar attempts (initial + 2 retries), history never runs.
      expect(calls).toBe(4);
    });
  });
});

describe("leetcode contest history", () => {
  it("chains attended contests with integer ratings, oldest first", async () => {
    const stub = leetcodeStub(fullProfile, 200, {
      history: historySelection([
        { attended: true, rating: 1415.42, title: "Biweekly Contest 159", titleSlug: "biweekly-contest-159", startTime: 1750516200 },
        { attended: false },
        { attended: true, rating: 1500.1, title: "Weekly Contest 400", titleSlug: "weekly-contest-400", startTime: 1753118400 },
      ]),
    });
    await withStub(stub, async () => {
      const adapter = createLeetCodeAdapter(DEPS);
      const bundle = await adapter.fetchAll("SomeUser");
      expect(bundle.contests).toHaveLength(2);
      expect(bundle.contests[0]).toMatchObject({
        externalId: "lc-biweekly-contest-159",
        name: "Biweekly Contest 159",
        ratingBefore: null,
        ratingChange: null,
        ratingAfter: 1415,
        rank: null,
      });
      expect(bundle.contests[1]).toMatchObject({
        externalId: "lc-weekly-contest-400",
        ratingBefore: 1415,
        ratingChange: 85,
        ratingAfter: 1500,
      });
      expect(bundle.contests[0].contestedAt).toEqual(new Date(1750516200 * 1000));
    });
  });

  it("keeps null ratings null and skips entries without contest blocks", async () => {
    const stub = leetcodeStub(fullProfile, 200, {
      history: historySelection([
        { attended: true, rating: null, title: "Weekly Contest 1", titleSlug: "weekly-contest-1", startTime: 1700000000 },
        { attended: true },
      ]),
    });
    await withStub(stub, async () => {
      const adapter = createLeetCodeAdapter(DEPS);
      const bundle = await adapter.fetchAll("SomeUser");
      expect(bundle.contests).toHaveLength(1);
      expect(bundle.contests[0].ratingAfter).toBeNull();
      expect(bundle.contests[0].ratingChange).toBeNull();
    });
  });

  it("returns no contests when history is absent", async () => {
    await withStub(leetcodeStub(fullProfile, 200), async () => {
      const bundle = await fetchLeetCodeProfile("someuser", DEPS);
      expect(bundle.contestHistory).toEqual([]);
    });
  });
});

const DAY_A = 1735689600; // 2025-01-01 UTC
const DAY_B = 1767225600; // 2026-01-01 UTC

function dbBundle(dayCounts: Record<string, number>): {
  recent: SyncBundle["activities"];
  calendar: Record<string, number>;
} {
  return {
    recent: [
      {
        externalId: "db-1",
        type: "PROBLEM_SOLVED",
        problemId: "two-sum",
        difficulty: null,
        occurredAt: new Date("2026-02-01T12:00:00Z"),
      },
    ],
    calendar: dayCounts,
  };
}

function dbAdapters(
  getData: () => { recent: SyncBundle["activities"]; calendar: Record<string, number> }
): Record<PlatformId, PlatformAdapter> {
  const adapter = (platform: PlatformId): PlatformAdapter => ({
    platform,
    fetchAll: async (username: string) => {
      const data = getData();
      const days = Object.entries(data.calendar).flatMap(([epoch, count]) => {
        const rows = [];
        for (let i = 0; i < count; i += 1) {
          rows.push({
            externalId: `lc-cal-${epoch}-${i}`,
            type: "SUBMISSION" as const,
            problemId: null,
            difficulty: null,
            occurredAt: new Date(Number(epoch) * 1000),
          });
        }
        return rows;
      });
      return {
        canonicalUsername: username,
        stats: {
          totalSolved: 100,
          contestRating: 1500,
          contestsAttended: 2,
          currentStreak: null,
          longestStreak: null,
          extra: {},
        },
        activities: [...data.recent, ...days],
        contests: [
          {
            externalId: "lc-weekly-contest-400",
            name: "Weekly Contest 400",
            contestedAt: new Date("2025-07-01T12:00:00Z"),
            ratingBefore: null,
            ratingChange: null,
            ratingAfter: 1500,
            rank: null,
          },
        ],
      };
    },
  });
  return {
    CODEFORCES: adapter("CODEFORCES"),
    LEETCODE: adapter("LEETCODE"),
    CODECHEF: adapter("CODECHEF"),
    GEEKSFORGEEKS: adapter("GEEKSFORGEEKS"),
    HACKERRANK: adapter("HACKERRANK"),
  };
}

describe.skipIf(!hasDb)("leetcode backfill persistence (mocked network, real DB)", () => {
  async function registerAgent(app: ReturnType<typeof createApp>) {
    const agent = request.agent(app);
    const email = uniqueEmail("lcbackfill");
    trackedEmails.push(email);
    const res = await agent.post("/api/auth/register").send({
      username: uniqueUsername("lcbk"),
      email,
      password: "validpassword123",
    });
    expect(res.status).toBe(201);
    return { agent, userId: res.body.data.user.id as string };
  }

  async function accountIdFor(userId: string): Promise<string> {
    const account = await prisma.linkedAccount.findUniqueOrThrow({
      where: { userId_platform: { userId, platform: "LEETCODE" } },
    });
    return account.id;
  }

  async function counts(accountId: string) {
    const events = await prisma.activityEvent.findMany({
      where: { linkedAccountId: accountId },
      select: { externalActivityId: true, activityType: true },
      orderBy: { externalActivityId: "asc" },
    });
    return {
      events: events.length,
      contests: await prisma.contestResult.count({ where: { linkedAccountId: accountId } }),
      externalIds: events.map((e) => e.externalActivityId),
      submissions: events.filter((e) => e.activityType === "SUBMISSION").length,
    };
  }

  it("imports calendar days and contests, then repeats idempotently", async () => {
    let mode: "full" | "partial" = "full";
    const app = createApp({
      platformAdapters: dbAdapters(() =>
        dbBundle(mode === "full" ? { [DAY_A]: 2, [DAY_B]: 1 } : { [DAY_A]: 1 })
      ),
    });
    const { agent, userId } = await registerAgent(app);
    const connected = await agent
      .post("/api/platform-accounts/LEETCODE/connect")
      .send({ username: "backfilllc" });
    expect(connected.status).toBe(201);
    expect(connected.body.data.account.stats.totalSolved).toBe(100);
    const accountId = await accountIdFor(userId);

    const first = await counts(accountId);
    expect(first.events).toBe(4); // 1 recent + 3 calendar rows
    expect(first.submissions).toBe(3);
    expect(first.contests).toBe(1);
    expect(connected.body.data.account.stats.totalSolved).toBe(100);

    // Same import twice: identical rows, no duplicates.
    const synced = await agent.post("/api/platform-accounts/LEETCODE/sync");
    expect(synced.status).toBe(200);
    const second = await counts(accountId);
    expect(second).toEqual(first);

    // Partial upstream response later: old rows are preserved, never deleted.
    mode = "partial";
    const third = await agent.post("/api/platform-accounts/LEETCODE/sync");
    expect(third.status).toBe(200);
    const after = await counts(accountId);
    expect(after.events).toBe(4);
    expect(after.externalIds).toEqual(first.externalIds);
  });

  it("recovers from a failed sync without losing the backfill", async () => {
    let failing = false;
    const flaky = (platform: PlatformId): PlatformAdapter => ({
      platform,
      fetchAll: async (username: string) => {
        if (failing) {
          throw new PlatformError("upstream", "The platform returned HTTP 500.");
        }
        return {
          canonicalUsername: username,
          stats: {
            totalSolved: 50,
            contestRating: null,
            contestsAttended: 0,
            currentStreak: null,
            longestStreak: null,
            extra: {},
          },
          activities: [
            {
              externalId: "lc-cal-1735689600-0",
              type: "SUBMISSION" as const,
              problemId: null,
              difficulty: null,
              occurredAt: new Date(DAY_A * 1000),
            },
          ],
          contests: [],
        };
      },
    });
    const app = createApp({
      platformAdapters: {
        CODEFORCES: flaky("CODEFORCES"),
        LEETCODE: flaky("LEETCODE"),
        CODECHEF: flaky("CODECHEF"),
        GEEKSFORGEEKS: flaky("GEEKSFORGEEKS"),
        HACKERRANK: flaky("HACKERRANK"),
      },
    });
    const { agent, userId } = await registerAgent(app);
    const connected = await agent
      .post("/api/platform-accounts/LEETCODE/connect")
      .send({ username: "retrylc" });
    expect(connected.status).toBe(201);
    failing = true;
    const failed = await agent.post("/api/platform-accounts/LEETCODE/sync");
    expect(failed.status).toBe(502);
    // Retry succeeds and imports the day exactly once.
    failing = false;
    const retried = await agent.post("/api/platform-accounts/LEETCODE/sync");
    expect(retried.status).toBe(200);
    const accountId = await accountIdFor(userId);
    const rows = await prisma.activityEvent.findMany({
      where: { linkedAccountId: accountId },
      select: { externalActivityId: true },
    });
    expect(rows.map((r) => r.externalActivityId)).toEqual(["lc-cal-1735689600-0"]);
    expect(
      await prisma.activityEvent.count({ where: { linkedAccountId: accountId } })
    ).toBe(1);
    const again = await agent.post("/api/platform-accounts/LEETCODE/sync");
    expect(again.status).toBe(200);
    expect(
      await prisma.activityEvent.count({ where: { linkedAccountId: accountId } })
    ).toBe(1);
  });
});

describe.skipIf(!hasDb)("leetcode daily activity persistence (mocked network, real DB)", () => {
  async function registerAgent(app: ReturnType<typeof createApp>) {
    const agent = request.agent(app);
    const email = uniqueEmail("lcdaily");
    trackedEmails.push(email);
    const res = await agent.post("/api/auth/register").send({
      username: uniqueUsername("lcd"),
      email,
      password: "validpassword123",
    });
    expect(res.status).toBe(201);
    return { agent, userId: res.body.data.user.id as string };
  }

  function lcAppWithCalendar(calendar: unknown) {
    const stub = leetcodeStub(fullProfile, 200, { calendar });
    return createApp({
      platformAdapters: {
        CODEFORCES: unused("CODEFORCES"),
        LEETCODE: {
          platform: "LEETCODE",
          fetchAll: (username: string) =>
            withStub(stub, () => createLeetCodeAdapter({ timeoutMs: 2000 }).fetchAll(username)),
        },
        CODECHEF: unused("CODECHEF"),
        GEEKSFORGEEKS: unused("GEEKSFORGEEKS"),
        HACKERRANK: unused("HACKERRANK"),
      },
    });
  }

  async function dailyRows(accountId: string) {
    return prisma.dailyActivity.findMany({
      where: { linkedAccountId: accountId },
      orderBy: { date: "asc" },
    });
  }

  async function accountIdFor(userId: string): Promise<string> {
    const account = await prisma.linkedAccount.findUniqueOrThrow({
      where: { userId_platform: { userId, platform: "LEETCODE" } },
    });
    return account.id;
  }

  it("upserts calendar days idempotently without creating event rows", async () => {
    const app = lcAppWithCalendar(calendarSelection({ "1735689600": 2, "1735776000": 1 }));
    const { agent, userId } = await registerAgent(app);
    const connected = await agent
      .post("/api/platform-accounts/LEETCODE/connect")
      .send({ username: "SomeUser" });
    expect(connected.status).toBe(201);
    const accountId = await accountIdFor(userId);

    let rows = await dailyRows(accountId);
    expect(rows.map((r) => [r.date.toISOString().slice(0, 10), r.submissions])).toEqual([
      ["2025-01-01", 2],
      ["2025-01-02", 1],
    ]);
    // No per-submission expansion: only the 2 recent PROBLEM_SOLVED events.
    expect(
      await prisma.activityEvent.count({ where: { linkedAccountId: accountId } })
    ).toBe(2);

    // Repeat sync: same rows, no duplicates, counts overwritten not summed.
    const synced = await agent.post("/api/platform-accounts/LEETCODE/sync");
    expect(synced.status).toBe(200);
    rows = await dailyRows(accountId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.submissions)).toEqual([2, 1]);
    expect(
      await prisma.activityEvent.count({ where: { linkedAccountId: accountId } })
    ).toBe(2);
  });

  it("converts legacy SUBMISSION rows into aggregates without losing history", async () => {
    const app = lcAppWithCalendar(calendarSelection({ "1735689600": 4 }));
    const { agent, userId } = await registerAgent(app);
    const connected = await agent
      .post("/api/platform-accounts/LEETCODE/connect")
      .send({ username: "SomeUser" });
    expect(connected.status).toBe(201);
    const accountId = await accountIdFor(userId);

    // Seed pre-migration expansion rows for a covered day plus one stale day.
    const staleDay = new Date(Date.UTC(2024, 5, 1));
    await prisma.activityEvent.createMany({
      data: [0, 1, 2].map((i) => ({
        userId,
        linkedAccountId: accountId,
        platform: "LEETCODE",
        externalActivityId: `lc-cal-1735689600-${i}`,
        activityType: "SUBMISSION",
        problemIdentifier: null,
        difficulty: null,
        occurredAt: new Date(1735689600 * 1000),
      })),
      skipDuplicates: true,
    });
    await prisma.activityEvent.create({
      data: {
        userId,
        linkedAccountId: accountId,
        platform: "LEETCODE",
        externalActivityId: "lc-cal-stale-0",
        activityType: "SUBMISSION",
        problemIdentifier: null,
        difficulty: null,
        occurredAt: staleDay,
      },
    });

    // Next sync imports the calendar day (4 submissions) and removes the
    // three superseded expansion rows; the stale-only day is preserved.
    const synced = await agent.post("/api/platform-accounts/LEETCODE/sync");
    expect(synced.status).toBe(200);
    const rows = await dailyRows(accountId);
    expect(rows.map((r) => [r.date.toISOString().slice(0, 10), r.submissions])).toEqual([
      ["2025-01-01", 4],
    ]);
    const remaining = await prisma.activityEvent.findMany({
      where: { linkedAccountId: accountId, activityType: "SUBMISSION" },
      select: { externalActivityId: true },
    });
    expect(remaining.map((r) => r.externalActivityId)).toEqual(["lc-cal-stale-0"]);
    // Recent per-problem events are untouched.
    expect(
      await prisma.activityEvent.count({
        where: { linkedAccountId: accountId, activityType: "PROBLEM_SOLVED" },
      })
    ).toBe(2);
  });

  it("preserves stored days when a later calendar fetch comes back empty", async () => {
    // First import succeeds with days...
    let calendar: unknown = calendarSelection({ "1735689600": 2 });
    const stubFor = () => leetcodeStub(fullProfile, 200, { calendar });
    const app = createApp({
      platformAdapters: {
        CODEFORCES: unused("CODEFORCES"),
        LEETCODE: {
          platform: "LEETCODE",
          fetchAll: (username: string) =>
            withStub(stubFor(), () => createLeetCodeAdapter({ timeoutMs: 2000 }).fetchAll(username)),
        },
        CODECHEF: unused("CODECHEF"),
        GEEKSFORGEEKS: unused("GEEKSFORGEEKS"),
        HACKERRANK: unused("HACKERRANK"),
      },
    });
    const { agent, userId } = await registerAgent(app);
    const connected = await agent
      .post("/api/platform-accounts/LEETCODE/connect")
      .send({ username: "SomeUser" });
    expect(connected.status).toBe(201);
    const accountId = await accountIdFor(userId);
    expect(await dailyRows(accountId)).toHaveLength(1);

    // ...then upstream returns a valid-but-empty calendar: stored days stay.
    calendar = { matchedUser: { username: "SomeUser", userCalendar: null } };
    const synced = await agent.post("/api/platform-accounts/LEETCODE/sync");
    expect(synced.status).toBe(200);
    const rows = await dailyRows(accountId);
    expect(rows.map((r) => r.submissions)).toEqual([2]);
  });

  it("preserves stored days when a later sync fails outright", async () => {
    let failing = false;
    const stubFor = () => leetcodeStub(fullProfile, 200, {
      calendar: calendarSelection({ "1735689600": 2 }),
    });
    const app = createApp({
      platformAdapters: {
        CODEFORCES: unused("CODEFORCES"),
        LEETCODE: {
          platform: "LEETCODE",
          fetchAll: async (username: string) => {
            if (failing) {
              throw new PlatformError("upstream", "The platform returned HTTP 500.");
            }
            return withStub(stubFor(), () =>
              createLeetCodeAdapter({ timeoutMs: 2000 }).fetchAll(username)
            );
          },
        },
        CODECHEF: unused("CODECHEF"),
        GEEKSFORGEEKS: unused("GEEKSFORGEEKS"),
        HACKERRANK: unused("HACKERRANK"),
      },
    });
    const { agent, userId } = await registerAgent(app);
    const connected = await agent
      .post("/api/platform-accounts/LEETCODE/connect")
      .send({ username: "SomeUser" });
    expect(connected.status).toBe(201);
    const accountId = await accountIdFor(userId);
    expect(await dailyRows(accountId)).toHaveLength(1);

    failing = true;
    const failed = await agent.post("/api/platform-accounts/LEETCODE/sync");
    expect(failed.status).toBe(502);
    // Failed fetch aborts before persistence: stored day untouched.
    expect((await dailyRows(accountId)).map((r) => r.submissions)).toEqual([2]);

    failing = false;
    const retried = await agent.post("/api/platform-accounts/LEETCODE/sync");
    expect(retried.status).toBe(200);
    expect(await dailyRows(accountId)).toHaveLength(1);
  });

  it("syncs the profile with drifted calendar flagged and no daily rows", async () => {
    const app = lcAppWithCalendar({
      matchedUser: {
        // Same username as the profile selection so the calendar reaches
        // content validation (which rejects the malformed map) instead of
        // the identity gate.
        username: "SomeUser",
        userCalendar: { submissionCalendar: 42 },
      },
    });
    const { agent, userId } = await registerAgent(app);
    const connected = await agent
      .post("/api/platform-accounts/LEETCODE/connect")
      .send({ username: "SomeUser" });
    // Profile sync succeeds despite the drifted selection...
    expect(connected.status).toBe(201);
    const accountId = await accountIdFor(userId);
    // ...stores no daily rows...
    expect(await dailyRows(accountId)).toHaveLength(0);
    // ...and surfaces the unsupported flag for honest UI copy.
    expect(connected.body.data.account.stats.additional).toMatchObject({
      calendarUnsupported: true,
    });
  });
});

describe.skipIf(!hasDb)("leetcode official totals vs tracked solves (mocked network, real DB)", () => {
  async function registerAgent(app: ReturnType<typeof createApp>) {
    const agent = request.agent(app);
    const email = uniqueEmail("lctotals");
    trackedEmails.push(email);
    const res = await agent.post("/api/auth/register").send({
      username: uniqueUsername("lct"),
      email,
      password: "validpassword123",
    });
    expect(res.status).toBe(201);
    return agent;
  }

  it("reports 164 official solved alongside 20 individually tracked problems", async () => {
    // Mirrors the real profile shape: 164 lifetime solves in the aggregate
    // selection, 20 recent accepted submissions with identifiers, a small
    // calendar, and no contest history.
    const nowSec = Math.trunc(Date.now() / 1000);
    const recent = Array.from({ length: 20 }, (_, i) => ({
      id: `s${1000 + i}`,
      title: `Problem ${i}`,
      titleSlug: `problem-${i}`,
      timestamp: String(nowSec - i * 100),
    }));
    const profile = {
      matchedUser: {
        username: "TotalsUser",
        profile: { realName: "Totals User" },
        submitStatsGlobal: {
          acSubmissionNum: [
            { difficulty: "All", count: 164 },
            { difficulty: "Easy", count: 80 },
            { difficulty: "Medium", count: 70 },
            { difficulty: "Hard", count: 14 },
          ],
        },
      },
      userContestRanking: null,
      recentAcSubmissionList: recent,
    };
    const stub = leetcodeStub(profile, 200, {
      calendar: calendarSelection({ "1735689600": 3 }, "TotalsUser"),
      history: { userContestRankingHistory: [] },
    });
    const unused = (platform: PlatformId): PlatformAdapter => ({
      platform,
      fetchAll: async () => {
        throw new Error("unused adapter");
      },
    });
    const lcApp = createApp({
      platformAdapters: {
        CODEFORCES: unused("CODEFORCES"),
        LEETCODE: {
          platform: "LEETCODE",
          fetchAll: (username: string) =>
            withStub(stub, () => createLeetCodeAdapter({ timeoutMs: 2000 }).fetchAll(username)),
        },
        CODECHEF: unused("CODECHEF"),
        GEEKSFORGEEKS: unused("GEEKSFORGEEKS"),
        HACKERRANK: unused("HACKERRANK"),
      },
    });
    const agent = await registerAgent(lcApp);
    const connected = await agent
      .post("/api/platform-accounts/LEETCODE/connect")
      .send({ username: "TotalsUser" });
    expect(connected.status).toBe(201);
    // Official aggregate is stored and served...
    expect(connected.body.data.account.stats.totalSolved).toBe(164);
    expect(connected.body.data.account.stats.additional).toMatchObject({
      easySolved: 80,
      mediumSolved: 70,
      hardSolved: 14,
    });

    // ...while individually tracked solves stay at the 20 recent problems.
    const totals = await agent.get("/api/activity/streak");
    expect(totals.status).toBe(200);
    expect(totals.body.data.totals.uniqueSolvedByPlatform).toEqual({ LEETCODE: 20 });
    expect(totals.body.data.totals.officialSolvedByPlatform).toEqual({ LEETCODE: 164 });

    // The analytics breakdown carries both numbers side by side.
    const summary = await agent.get("/api/analytics/summary?range=30d&timezone=UTC");
    expect(summary.status).toBe(200);
    const lc = (summary.body.data.perPlatform as Array<Record<string, unknown>>).find(
      (p) => p.platform === "LEETCODE"
    );
    expect(lc).toMatchObject({ totalSolvedAllTime: 164, solved: 20 });
    expect(summary.body.data.totals.totalSolvedAllTime).toBe(164);
  });
});
