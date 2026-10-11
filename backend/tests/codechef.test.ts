import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/db/prisma";
import { createApp } from "../src/app";
import { withFetchStub } from "../src/modules/platforms/http";
import { fetchCodechefProfile } from "../src/modules/codechef/client";
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

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html" },
  });
}

function profilePage(overrides: {
  username?: string;
  rating?: string;
  maxRating?: string;
  division?: string;
  stars?: number;
  globalRank?: string;
  countryRank?: string;
  solved?: string;
  history?: string | null;
}): string {
  const {
    username = "testuser",
    rating = "1842",
    maxRating = "2105",
    division = "2",
    stars = 4,
    globalRank = "12345",
    countryRank = "987",
    solved = "256",
  } = overrides;
  const history =
    overrides.history !== undefined
      ? overrides.history
      : `[{"code":"START01","getyear":"2024","getmonth":"1","getday":"10","reason":null,"penalised_in":null,"rating":"1700","rank":"500","name":"Starters 1","end_date":"2024-01-10 20:00:00","color":"#666"},{"code":"START02","getyear":"2024","getmonth":"2","getday":"10","reason":null,"penalised_in":null,"rating":"1842","rank":"300","name":"Starters 2","end_date":"2024-02-10 20:00:00","color":"#666"}]`;
  const starSpans = Array.from({ length: stars }, () => "<span>&#9733;</span>").join("");
  return `<html><body>
<span class='m-username--link'>${username}</span>
<div class="rating-number">
    ${rating}
</div>
<a><strong>CodeChef Rating</strong></a>
<small>(Highest Rating ${maxRating})</small>
<div>(Div ${division})</div>
<div class="rating-star">${starSpans}</div>
<ul class="inline-list">
<li><a href="/ratings/all"><strong>${globalRank}</strong></a>Global Rank</li>
<li><a href="/ratings/all?x"><strong>${countryRank}</strong></a>Country Rank</li>
</ul>
<h3>Total Problems Solved: ${solved}</h3>
${history === null ? "" : `<script>var all_rating = ${history};</script>`}
</body></html>`;
}

const HOMEPAGE = "<html><body><h1>CodeChef</h1><a>Login</a></body></html>";

const stubProfile = (html: string) =>
  (async () => htmlResponse(html)) as typeof fetch;

describe.skipIf(!hasDb)("codechef profile parsing", () => {
  it("parses rating, ranks, stars, solved count, and contest history", async () => {
    await withFetchStub(stubProfile(profilePage({})), async () => {
      const bundle = await fetchCodechefProfile("testuser", DEPS);
      expect(bundle.username).toBe("testuser");
      expect(bundle.rating).toBe(1842);
      expect(bundle.maxRating).toBe(2105);
      expect(bundle.division).toBe("Div 2");
      expect(bundle.stars).toBe(4);
      expect(bundle.globalRank).toBe(12345);
      expect(bundle.countryRank).toBe(987);
      expect(bundle.totalSolved).toBe(256);
      expect(bundle.contests).toHaveLength(2);
      expect(bundle.contests[0]).toMatchObject({ code: "START01", rating: 1700, rank: 500 });
      expect(bundle.contests[1].contestedAt).toEqual(new Date(Date.UTC(2024, 1, 10, 20, 0, 0)));
    });
  });

  it("treats missing/inactive values as null, never zero", async () => {
    await withFetchStub(
      stubProfile(profilePage({ rating: "NA", globalRank: "Inactive", countryRank: "Inactive" })),
      async () => {
        const bundle = await fetchCodechefProfile("testuser", DEPS);
        expect(bundle.rating).toBeNull();
        expect(bundle.globalRank).toBeNull();
        expect(bundle.countryRank).toBeNull();
        // Fields that ARE present still parse.
        expect(bundle.totalSolved).toBe(256);
      }
    );
  });

  it("rejects redirected bogus profiles as not-found", async () => {
    await withFetchStub(stubProfile(HOMEPAGE), async () => {
      const err = await fetchCodechefProfile("ghost", DEPS).catch((e) => e);
      expect(err).toBeInstanceOf(PlatformError);
      expect((err as PlatformError).kind).toBe("not-found");
    });
  });

  it("matches canonical usernames case-insensitively, rejects mismatches", async () => {
    await withFetchStub(stubProfile(profilePage({ username: "TestUser" })), async () => {
      const bundle = await fetchCodechefProfile("testuser", DEPS);
      expect(bundle.username).toBe("TestUser");
    });
    await withFetchStub(stubProfile(profilePage({ username: "someone-else" })), async () => {
      const err = await fetchCodechefProfile("testuser", DEPS).catch((e) => e);
      expect((err as PlatformError).kind).toBe("not-found");
    });
  });

  it("fails closed on corrupt contest history", async () => {
    await withFetchStub(stubProfile(profilePage({ history: "[{broken]" })), async () => {
      const err = await fetchCodechefProfile("testuser", DEPS).catch((e) => e);
      expect((err as PlatformError).kind).toBe("invalid-response");
    });
  });
});

describe.skipIf(!hasDb)("codechef transport failures", () => {
  it("retries transient failures once, then reports upstream", async () => {
    let calls = 0;
    const stub = (async () => {
      calls += 1;
      return calls < 2 ? new Response("boom", { status: 500 }) : htmlResponse(profilePage({}));
    }) as typeof fetch;
    await withFetchStub(stub, async () => {
      const bundle = await fetchCodechefProfile("testuser", DEPS);
      expect(bundle.rating).toBe(1842);
      expect(calls).toBe(2);
    });
  });

  it("does not retry permanent HTTP errors", async () => {
    let calls = 0;
    const stub = (async () => {
      calls += 1;
      return new Response("denied", { status: 403 });
    }) as typeof fetch;
    await withFetchStub(stub, async () => {
      const err = await fetchCodechefProfile("testuser", DEPS).catch((e) => e);
      expect((err as PlatformError).kind).toBe("upstream");
      expect(calls).toBe(1);
    });
  });

  it("maps aborts to timeouts and network errors cleanly", async () => {
    const timeoutStub = (async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    }) as typeof fetch;
    await withFetchStub(timeoutStub, async () => {
      const err = await fetchCodechefProfile("testuser", DEPS).catch((e) => e);
      expect((err as PlatformError).kind).toBe("timeout");
    });
    const networkStub = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await withFetchStub(networkStub, async () => {
      const err = await fetchCodechefProfile("testuser", DEPS).catch((e) => e);
      expect((err as PlatformError).kind).toBe("network");
      expect(String((err as Error).message)).not.toMatch(/ECONN|socket/i);
    });
  });
});

describe.skipIf(!hasDb)("codechef connect + sync (mocked network, real DB)", () => {
  async function registerAgent(app: ReturnType<typeof createApp>) {
    const agent = request.agent(app);
    const email = uniqueEmail("mod6");
    trackedEmails.push(email);
    const res = await agent.post("/api/auth/register").send({
      username: uniqueUsername("mod6user"),
      email,
      password: "validpassword123",
    });
    expect(res.status).toBe(201);
    return agent;
  }

  it("connects, persists stats + chained contest history, syncs idempotently", async () => {
    const app = createApp();
    const agent = await registerAgent(app);
    const connected = await withFetchStub(stubProfile(profilePage({})), () =>
      agent.post("/api/platform-accounts/CODECHEF/connect").send({ username: "testuser" })
    );
    expect(connected.status).toBe(201);
    const account = connected.body.data.account;
    expect(account.platformUsername).toBe("testuser");
    expect(account.stats.contestRating).toBe(1842);
    expect(account.stats.totalSolved).toBe(256);
    expect(account.stats.contestsAttended).toBe(2);
    expect(account.stats.additional).toMatchObject({
      division: "Div 2",
      stars: 4,
      maxRating: 2105,
    });
    // No activity events: the source exposes no per-problem timestamps.
    const row = await prisma.linkedAccount.findFirstOrThrow({
      where: { platformUsername: "testuser" },
    });
    expect(await prisma.activityEvent.count({ where: { linkedAccountId: row.id } })).toBe(0);
    expect(await prisma.contestResult.count({ where: { linkedAccountId: row.id } })).toBe(2);

    const first = await prisma.contestResult.findFirstOrThrow({
      where: { linkedAccountId: row.id, externalContestId: "cc-START01" },
    });
    expect(first.ratingBefore).toBeNull();
    expect(first.ratingChange).toBeNull();
    expect(first.ratingAfter).toBe(1700);
    const second = await prisma.contestResult.findFirstOrThrow({
      where: { linkedAccountId: row.id, externalContestId: "cc-START02" },
    });
    expect(second.ratingBefore).toBe(1700);
    expect(second.ratingChange).toBe(142);
    expect(second.ratingAfter).toBe(1842);

    // Second sync with identical data: no duplicates.
    const synced = await withFetchStub(stubProfile(profilePage({})), () =>
      agent.post("/api/platform-accounts/CODECHEF/sync")
    );
    expect(synced.status).toBe(200);
    expect(await prisma.contestResult.count({ where: { linkedAccountId: row.id } })).toBe(2);

    const removed = await agent.delete("/api/platform-accounts/CODECHEF");
    expect(removed.status).toBe(200);
  });

  it("rejects bogus handles without creating rows", async () => {
    const app = createApp();
    const agent = await registerAgent(app);
    const res = await withFetchStub(stubProfile(HOMEPAGE), () =>
      agent.post("/api/platform-accounts/CODECHEF/connect").send({ username: "ghostuser1" })
    );
    expect(res.status).toBe(400);
    expect(
      await prisma.linkedAccount.count({ where: { platformUsername: "ghostuser1" } })
    ).toBe(0);
  });
});
