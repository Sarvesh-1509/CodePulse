import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/db/prisma";
import { createApp } from "../src/app";
import { withFetchStub } from "../src/modules/platforms/http";
import { fetchHackerrankProfile } from "../src/modules/hackerrank/client";
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

// Faithful fixture: URL-encoded #initialData with viewProfiles.{key}.
// The entry's own `username` field is passed explicitly so mismatch cases
// (key matches, field differs) can be constructed deliberately.
function profilePage(entry: Record<string, unknown>, key: string): string {
  const doc = {
    community: { viewProfiles: { [key.toLowerCase()]: entry } },
  };
  const encoded = encodeURIComponent(JSON.stringify(doc));
  return `<html><body><script type="application/json" id="initialData">${encoded}</script></body></html>`;
}

const FULL_MODEL = {
  username: "testuser",
  name: "Test User",
  country: "India",
  level: 4,
  followers_count: 120,
  badges: [
    { badge_name: "Problem Solving", stars: 6, solved: 202, current_points: 7158.51 },
    { badge_name: "C++", stars: 1, solved: 3, current_points: 35 },
  ],
  scores: {
    algorithms: { name: "Algorithms", practice: { score: 6498.51, rank: 2671 } },
    cpp: { name: "C++", practice: { score: 35, rank: 868362 } },
  },
  contestHistory: { list: [], total: 7 },
};

const stubPage = (html: string) => (async () => new Response(html, {
  status: 200,
  headers: { "Content-Type": "text/html" },
})) as typeof fetch;
const SHELL_PAGE = "<html><body><h1>HackerRank</h1></body></html>";

describe.skipIf(!hasDb)("hackerrank profile parsing", () => {
  it("parses badges, domain scores, and contest totals without inventing ratings", async () => {
    await withFetchStub(stubPage(profilePage(FULL_MODEL, "testuser")), async () => {
      const bundle = await fetchHackerrankProfile("testuser", DEPS);
      expect(bundle.username).toBe("testuser");
      expect(bundle.displayName).toBe("Test User");
      expect(bundle.country).toBe("India");
      expect(bundle.level).toBe(4);
      expect(bundle.followersCount).toBe(120);
      expect(bundle.badges).toHaveLength(2);
      expect(bundle.badges[0]).toMatchObject({ name: "Problem Solving", stars: 6, solved: 202 });
      expect(bundle.domains[0]).toMatchObject({ slug: "algorithms", score: 6498.51, rank: 2671 });
      expect(bundle.contestsAttended).toBe(7);
    });
  });

  it("rejects shell pages (bogus users) as not-found", async () => {
    await withFetchStub(stubPage(SHELL_PAGE), async () => {
      const err = await fetchHackerrankProfile("ghost", DEPS).catch((e) => e);
      expect(err).toBeInstanceOf(PlatformError);
      expect((err as PlatformError).kind).toBe("not-found");
    });
  });

  it("rejects mismatched usernames", async () => {
    await withFetchStub(
      stubPage(profilePage({ ...FULL_MODEL, username: "someone-else" }, "testuser")),
      async () => {
        const err = await fetchHackerrankProfile("testuser", DEPS).catch((e) => e);
        expect((err as PlatformError).kind).toBe("not-found");
      }
    );
  });

  it("keeps missing sections null and caps badge/domain lists", async () => {
    const manyBadges = Array.from({ length: 25 }, (_, i) => ({ badge_name: `B${i}`, stars: 1 }));
    const sparse = { username: "sparse", badges: manyBadges };
    await withFetchStub(stubPage(profilePage(sparse, "sparse")), async () => {
      const bundle = await fetchHackerrankProfile("sparse", DEPS);
      expect(bundle.displayName).toBeNull();
      expect(bundle.contestsAttended).toBeNull();
      expect(bundle.badges).toHaveLength(10);
      expect(bundle.domains).toEqual([]);
    });
  });
});

describe.skipIf(!hasDb)("hackerrank transport failures", () => {
  it("retries transient failures once, then reports upstream", async () => {
    let calls = 0;
    const stub = (async () => {
      calls += 1;
      return calls < 2
        ? new Response("boom", { status: 500 })
        : new Response(profilePage(FULL_MODEL, "testuser"), { status: 200 });
    }) as typeof fetch;
    await withFetchStub(stub, async () => {
      const bundle = await fetchHackerrankProfile("testuser", DEPS);
      expect(bundle.username).toBe("testuser");
      expect(calls).toBe(2);
    });
  });

  it("maps rate limits, timeouts, and network errors without leaking internals", async () => {
    const limited = (async () => new Response("{}", { status: 429 })) as typeof fetch;
    await withFetchStub(limited, async () => {
      const err = await fetchHackerrankProfile("testuser", DEPS).catch((e) => e);
      expect((err as PlatformError).kind).toBe("rate-limited");
    });
    const timeout = (async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    }) as typeof fetch;
    await withFetchStub(timeout, async () => {
      const err = await fetchHackerrankProfile("testuser", DEPS).catch((e) => e);
      expect((err as PlatformError).kind).toBe("timeout");
    });
    const network = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await withFetchStub(network, async () => {
      const err = await fetchHackerrankProfile("testuser", DEPS).catch((e) => e);
      expect((err as PlatformError).kind).toBe("network");
      expect(String((err as Error).message)).not.toMatch(/ECONN|socket/i);
    });
  });
});

describe.skipIf(!hasDb)("hackerrank connect + sync (mocked network, real DB)", () => {
  async function registerAgent(app: ReturnType<typeof createApp>) {
    const agent = request.agent(app);
    const email = uniqueEmail("mod8");
    trackedEmails.push(email);
    const res = await agent.post("/api/auth/register").send({
      username: uniqueUsername("mod8user"),
      email,
      password: "validpassword123",
    });
    expect(res.status).toBe(201);
    return agent;
  }

  it("connects with scores kept out of rating fields and no fabricated activity", async () => {
    const app = createApp();
    const agent = await registerAgent(app);
    const connected = await withFetchStub(stubPage(profilePage({ ...FULL_MODEL, username: "HrUser1" }, "hruser1")), () =>
      agent.post("/api/platform-accounts/HACKERRANK/connect").send({ username: "hruser1" })
    );
    expect(connected.status).toBe(201);
    const account = connected.body.data.account;
    expect(account.platformUsername).toBe("HrUser1");
    // Domain points are scores, not ratings or solved totals.
    expect(account.stats.contestRating).toBeNull();
    expect(account.stats.totalSolved).toBeNull();
    expect(account.stats.contestsAttended).toBe(7);
    expect(account.stats.additional).toMatchObject({ badgesCount: 2, level: 4 });
    expect(account.stats.additional.badges[0]).toMatchObject({ name: "Problem Solving", stars: 6 });

    const row = await prisma.linkedAccount.findFirstOrThrow({
      where: { platformUsername: "HrUser1" },
    });
    expect(await prisma.activityEvent.count({ where: { linkedAccountId: row.id } })).toBe(0);
    expect(await prisma.contestResult.count({ where: { linkedAccountId: row.id } })).toBe(0);

    const synced = await withFetchStub(stubPage(profilePage({ ...FULL_MODEL, username: "HrUser1" }, "hruser1")), () =>
      agent.post("/api/platform-accounts/HACKERRANK/sync")
    );
    expect(synced.status).toBe(200);

    const removed = await agent.delete("/api/platform-accounts/HACKERRANK");
    expect(removed.status).toBe(200);
  });

  it("rejects bogus users without creating rows", async () => {
    const app = createApp();
    const agent = await registerAgent(app);
    const res = await withFetchStub(stubPage(SHELL_PAGE), () =>
      agent.post("/api/platform-accounts/HACKERRANK/connect").send({ username: "ghosthr1" })
    );
    expect(res.status).toBe(400);
    expect(
      await prisma.linkedAccount.count({ where: { platformUsername: "ghosthr1" } })
    ).toBe(0);
  });
});
