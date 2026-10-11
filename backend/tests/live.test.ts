import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/db/prisma";
import { createApp } from "../src/app";
import {
  cleanupUsers,
  databaseAvailable,
  uniqueEmail,
  uniqueUsername,
} from "./db";

/**
 * LIVE upstream smoke tests (Modules 4-5) — NOT part of the normal suite.
 *
 * Run explicitly with a real network + test database:
 *   LIVE_API=1 DATABASE_URL=postgresql://.../codepulse_test npx vitest run tests/live.test.ts
 *
 * These hit codeforces.com and leetcode.com with small bounded requests.
 * Results are reported separately from the mocked unit tests and may vary
 * with upstream availability. The suite skips entirely without LIVE_API=1.
 */

const RUN_LIVE = process.env.LIVE_API === "1";
const hasDb = await databaseAvailable();
const trackedEmails: string[] = [];

afterAll(async () => {
  await cleanupUsers(trackedEmails);
  await prisma.$disconnect();
});

async function registerAgent(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  const email = uniqueEmail("live");
  trackedEmails.push(email);
  await agent.post("/api/auth/register").send({
    username: uniqueUsername("liveuser"),
    email,
    password: "validpassword123",
  });
  return agent;
}

describe.skipIf(!RUN_LIVE || !hasDb)("live: codeforces", () => {
  it(
    "connects a real handle and persists profile data",
    { timeout: 120000 },
    async () => {
      const app = createApp();
      const agent = await registerAgent(app);
      const res = await agent
        .post("/api/platform-accounts/CODEFORCES/connect")
        .send({ username: "tourist" });
      expect(res.status).toBe(201);
      const account = res.body.data.account;
      expect(account.platformUsername).toBe("tourist");
      // A legendary grandmaster must have a rating and contests.
      expect(account.stats.contestRating).toBeGreaterThan(3000);
      expect(account.stats.contestsAttended).toBeGreaterThan(100);
      expect(account.stats.totalSolved).toBeGreaterThan(500);

      const sync = await agent.post("/api/platform-accounts/CODEFORCES/sync");
      expect(sync.status).toBe(200);
      await agent.delete("/api/platform-accounts/CODEFORCES");
    }
  );

  it(
    "rejects a bogus handle against the real API",
    { timeout: 60000 },
    async () => {
      const app = createApp();
      const agent = await registerAgent(app);
      const res = await agent
        .post("/api/platform-accounts/CODEFORCES/connect")
        .send({ username: "this_handle_definitely_does_not_exist_zzz" });
      expect(res.status).toBe(400);
    }
  );
});

describe.skipIf(!RUN_LIVE || !hasDb)("live: leetcode", () => {
  it(
    "connects a real public profile and persists aggregate stats",
    { timeout: 120000 },
    async () => {
      const app = createApp();
      const agent = await registerAgent(app);
      const res = await agent
        .post("/api/platform-accounts/LEETCODE/connect")
        .send({ username: "lee215" });
      expect(res.status).toBe(201);
      const account = res.body.data.account;
      expect(account.platformUsername).toBe("lee215");
      // Aggregate totals from the real API; streaks must stay null.
      expect(account.stats.totalSolved).toBeGreaterThan(100);
      expect(account.stats.currentStreak).toBeNull();
      expect(account.stats.longestStreak).toBeNull();
      expect(account.stats.additional.easySolved).toBeGreaterThan(0);
      await agent.delete("/api/platform-accounts/LEETCODE");
    }
  );

  it(
    "rejects a bogus username against the real API",
    { timeout: 60000 },
    async () => {
      const app = createApp();
      const agent = await registerAgent(app);
      const res = await agent
        .post("/api/platform-accounts/LEETCODE/connect")
        .send({ username: "this_user_definitely_does_not_exist_zzz" });
      // Either a clean not-found or a graceful upstream error — never 201
      // with fabricated data and never a crash.
      expect([400, 429, 502]).toContain(res.status);
      const list = await agent.get("/api/platform-accounts");
      expect(list.body.data.accounts).toEqual([]);
    }
  );
});

describe.skipIf(!RUN_LIVE || !hasDb)("live: codechef", () => {
  it(
    "connects a real handle and persists profile + contest data",
    { timeout: 120000 },
    async () => {
      const app = createApp();
      const agent = await registerAgent(app);
      const res = await agent
        .post("/api/platform-accounts/CODECHEF/connect")
        .send({ username: "gennady.korotkevich" });
      expect(res.status).toBe(201);
      const account = res.body.data.account;
      expect(account.platformUsername).toBe("gennady.korotkevich");
      // Loose bounds on a real legendary account: present and plausible.
      expect(account.stats.contestRating).toBeGreaterThan(2000);
      expect(account.stats.totalSolved).toBeGreaterThan(100);
      expect(account.stats.contestsAttended).toBeGreaterThan(20);
      expect(account.stats.additional.division).toMatch(/Div/);
      const sync = await agent.post("/api/platform-accounts/CODECHEF/sync");
      expect(sync.status).toBe(200);
      await agent.delete("/api/platform-accounts/CODECHEF");
    }
  );

  it(
    "rejects a bogus handle against the real site",
    { timeout: 60000 },
    async () => {
      const app = createApp();
      const agent = await registerAgent(app);
      const res = await agent
        .post("/api/platform-accounts/CODECHEF/connect")
        .send({ username: "this_handle_definitely_does_not_exist_zzz" });
      expect([400, 429, 502]).toContain(res.status);
      const list = await agent.get("/api/platform-accounts");
      expect(list.body.data.accounts).toEqual([]);
    }
  );
});

describe.skipIf(!RUN_LIVE || !hasDb)("live: geeksforgeeks", () => {
  it(
    "connects a real public profile without fabricating metrics",
    { timeout: 120000 },
    async () => {
      const app = createApp();
      const agent = await registerAgent(app);
      const res = await agent
        .post("/api/platform-accounts/GEEKSFORGEEKS/connect")
        .send({ username: "sandeepjain" });
      expect(res.status).toBe(201);
      const account = res.body.data.account;
      expect(account.platformUsername).toBe("sandeepjain");
      // A coding score is not a rating: contestRating must stay null even
      // when the profile syncs successfully.
      expect(account.stats.contestRating).toBeNull();
      expect(account.stats.currentStreak).toBeNull();
      expect(account.stats.longestStreak).toBeNull();
      await agent.delete("/api/platform-accounts/GEEKSFORGEEKS");
    }
  );

  it(
    "rejects a bogus username against the real site",
    { timeout: 60000 },
    async () => {
      const app = createApp();
      const agent = await registerAgent(app);
      const res = await agent
        .post("/api/platform-accounts/GEEKSFORGEEKS/connect")
        .send({ username: "zzz_no_such_user_12345" });
      expect([400, 429, 502]).toContain(res.status);
      const list = await agent.get("/api/platform-accounts");
      expect(list.body.data.accounts).toEqual([]);
    }
  );
});

describe.skipIf(!RUN_LIVE || !hasDb)("live: hackerrank", () => {
  it(
    "connects a real public profile with badges and no invented totals",
    { timeout: 120000 },
    async () => {
      const app = createApp();
      const agent = await registerAgent(app);
      const res = await agent
        .post("/api/platform-accounts/HACKERRANK/connect")
        .send({ username: "shashank21j" });
      expect(res.status).toBe(201);
      const account = res.body.data.account;
      expect(account.platformUsername).toBe("shashank21j");
      // Scores live in extras; rating and solved totals stay null.
      expect(account.stats.contestRating).toBeNull();
      expect(account.stats.totalSolved).toBeNull();
      expect(account.stats.additional.badgesCount).toBeGreaterThan(0);
      await agent.delete("/api/platform-accounts/HACKERRANK");
    }
  );

  it(
    "rejects a bogus username against the real site",
    { timeout: 60000 },
    async () => {
      const app = createApp();
      const agent = await registerAgent(app);
      const res = await agent
        .post("/api/platform-accounts/HACKERRANK/connect")
        .send({ username: "zzz_no_such_user_12345" });
      expect([400, 429, 502]).toContain(res.status);
      const list = await agent.get("/api/platform-accounts");
      expect(list.body.data.accounts).toEqual([]);
    }
  );
});
