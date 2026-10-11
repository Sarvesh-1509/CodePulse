import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/db/prisma";
import { createApp } from "../src/app";
import { withFetchStub } from "../src/modules/platforms/http";
import { fetchGeeksforgeeksProfile } from "../src/modules/geeksforgeeks/client";
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

// Faithful fixture: the doubly-encoded profile-stats object GFG embeds.
function doublyInner(fields: Record<string, unknown>): string {
  const inner = JSON.stringify({
    name: "Test User",
    profile_image_url: "https://media.geeksforgeeks.org/img-practice/x.svg",
    created_date: "2020-01-01 00:00:00",
    score: 1234,
    monthly_score: 56,
    total_problems_solved: 450,
    institute_rank: "42",
    pod_solved_longest_streak: 30,
    pod_solved_global_longest_streak: 900,
    pod_solved_current_streak: 5,
    pod_correct_submissions_count: 40,
    ...fields,
  });
  return JSON.stringify(inner).slice(1, -1);
}

function statsPage(fields: Record<string, unknown>): string {
  const doubly = doublyInner(fields);
  return `<html><body><script>window.__DATA__ = {"profile": "${doubly}", "other": 1};</script></body></html>`;
}

const FULL_PAGE = statsPage({});
const SHELL_PAGE =
  "<html><body><h1>GeeksforGeeks</h1><div>top experts sidebar</div></body></html>";

const stubPage = (html: string) => (async () => new Response(html, {
  status: 200,
  headers: { "Content-Type": "text/html" },
})) as typeof fetch;

describe.skipIf(!hasDb)("geeksforgeeks profile parsing", () => {
  it("parses score, totals, and pod streaks without conflating them", async () => {
    await withFetchStub(stubPage(FULL_PAGE), async () => {
      const bundle = await fetchGeeksforgeeksProfile("testuser", DEPS);
      expect(bundle.username).toBe("testuser");
      expect(bundle.displayName).toBe("Test User");
      expect(bundle.score).toBe(1234);
      expect(bundle.monthlyScore).toBe(56);
      expect(bundle.totalSolved).toBe(450);
      expect(bundle.instituteRank).toBe("42");
      expect(bundle.podCurrentStreak).toBe(5);
      expect(bundle.podLongestStreak).toBe(30);
    });
  });

  it("rejects shell pages (bogus users) as not-found", async () => {
    await withFetchStub(stubPage(SHELL_PAGE), async () => {
      const err = await fetchGeeksforgeeksProfile("ghost", DEPS).catch((e) => e);
      expect(err).toBeInstanceOf(PlatformError);
      expect((err as PlatformError).kind).toBe("not-found");
    });
  });

  it("fails closed when the stats object is corrupt", async () => {
    const corrupt = `<html><body><script>var x = { "total_problems_solved": "abc", "score": "xyz" };</script></body></html>`;
    await withFetchStub(stubPage(corrupt), async () => {
      const err = await fetchGeeksforgeeksProfile("testuser", DEPS).catch((e) => e);
      expect((err as PlatformError).kind).toBe("invalid-response");
    });
  });

  it("keeps genuinely missing fields null", async () => {
    const sparse = statsPage({ score: 100, total_problems_solved: 10, institute_rank: "" });
    await withFetchStub(stubPage(sparse), async () => {
      const bundle = await fetchGeeksforgeeksProfile("sparse", DEPS);
      expect(bundle.score).toBe(100);
      expect(bundle.totalSolved).toBe(10);
      expect(bundle.instituteRank).toBeNull();
    });
  });

  it("skips sidebar objects without stat keys before the profile object", async () => {
    const sidebar = '{\\"name\\": \\"Top Author\\", \\"role\\": \\"mentor\\", \\"articles\\": 12}';
    const html = `<html><body><div>${sidebar}</div><script>var d = {"profile": "${doublyInner(
      {}
    )}"};</script></body></html>`;
    await withFetchStub(stubPage(html), async () => {
      const bundle = await fetchGeeksforgeeksProfile("testuser", DEPS);
      expect(bundle.totalSolved).toBe(450);
    });
  });

  it("survives a brace inside an earlier object's string value", async () => {
    // Regression: real profile pages embed ~20 {"name",...} objects
    // (author sidebars). A `}` inside one of their string values used to
    // truncate the brace scan and fail the whole page as invalid-response
    // (HTTP 502) even though the stats object was present.
    const sidebar = '{\\"name\\": \\"Top Author } enjoy\\", \\"role\\": \\"mentor\\"}';
    const html = `<html><body><div>${sidebar}</div><script>var d = {"profile": "${doublyInner(
      {}
    )}"};</script></body></html>`;
    await withFetchStub(stubPage(html), async () => {
      const bundle = await fetchGeeksforgeeksProfile("testuser", DEPS);
      expect(bundle.totalSolved).toBe(450);
      expect(bundle.score).toBe(1234);
    });
  });

  it("survives an escaped quote inside an earlier object's string value", async () => {
    const sidebar = '{\\"name\\": \\"O\\\\\\\\\\"Brien\\", \\"role\\": \\"mentor\\"}';
    const html = `<html><body><div>${sidebar}</div><script>var d = {"profile": "${doublyInner(
      {}
    )}"};</script></body></html>`;
    await withFetchStub(stubPage(html), async () => {
      const bundle = await fetchGeeksforgeeksProfile("testuser", DEPS);
      expect(bundle.totalSolved).toBe(450);
    });
  });

  it("accepts JSON null for every optional stats field (null-handling regression)", async () => {
    // GFG serializes absent profile fields as JSON null (seen in the wild
    // as `"designation":null` inside this very object). Null must behave
    // exactly like a missing key — never a 502.
    const page = statsPage({
      name: null,
      score: null,
      monthly_score: null,
      total_problems_solved: null,
      institute_rank: null,
      pod_solved_current_streak: null,
      pod_solved_longest_streak: null,
    });
    await withFetchStub(stubPage(page), async () => {
      const bundle = await fetchGeeksforgeeksProfile("nulluser", DEPS);
      expect(bundle.username).toBe("nulluser");
      expect(bundle.displayName).toBeNull();
      expect(bundle.score).toBeNull();
      expect(bundle.monthlyScore).toBeNull();
      expect(bundle.totalSolved).toBeNull();
      expect(bundle.instituteRank).toBeNull();
      expect(bundle.podCurrentStreak).toBeNull();
      expect(bundle.podLongestStreak).toBeNull();
    });
  });

  it("accepts reordered keys, whitespace, and a missing name field", async () => {
    // A page variant that orders keys differently, pads whitespace, and
    // omits the name entirely: the old `{"name"`-prefix seek was blind to it.
    const inner = `{"total_problems_solved" : 5, "score" : 10, "monthly_score" : 1}`;
    const doubly = JSON.stringify(inner).slice(1, -1);
    const html = `<html><body><script>window.__DATA__ = {"profile": "${doubly}"};</script></body></html>`;
    await withFetchStub(stubPage(html), async () => {
      const bundle = await fetchGeeksforgeeksProfile("reordered", DEPS);
      expect(bundle.totalSolved).toBe(5);
      expect(bundle.score).toBe(10);
      expect(bundle.monthlyScore).toBe(1);
      expect(bundle.displayName).toBeNull();
    });
  });

  it("rejects anchor mentions in prose when no stats object exists", async () => {
    const html = `<html><body><p>Read about total_problems_solved on our blog.</p><script>var broken = {"name": "oops";</script></body></html>`;
    await withFetchStub(stubPage(html), async () => {
      const err = await fetchGeeksforgeeksProfile("testuser", DEPS).catch((e) => e);
      expect((err as PlatformError).kind).toBe("invalid-response");
    });
  });

  it("rejects wrong-typed stats without accepting them as a profile", async () => {
    const inner = JSON.stringify({ name: "Test", total_problems_solved: [1, 2], score: "high" });
    const doubly = JSON.stringify(inner).slice(1, -1);
    const html = `<html><body><script>var d = {"profile": "${doubly}"};</script></body></html>`;
    await withFetchStub(stubPage(html), async () => {
      const err = await fetchGeeksforgeeksProfile("testuser", DEPS).catch((e) => e);
      expect((err as PlatformError).kind).toBe("invalid-response");
    });
  });

  it("accepts a numeric institute_rank (live-profile regression)", async () => {
    // Verified live 2026-10-11: profile `santhoshau1fy` carries
    // `"institute_rank":190` (bare number), while other profiles carry a
    // string (`"42"`) or `""`. The old string-only schema rejected the
    // numeric shape with invalid-response (HTTP 502).
    const page = statsPage({ institute_rank: 190 });
    await withFetchStub(stubPage(page), async () => {
      const bundle = await fetchGeeksforgeeksProfile("numericrank", DEPS);
      expect(bundle.instituteRank).toBe("190");
      expect(bundle.totalSolved).toBe(450);
    });
  });

  it("attaches bounded sanitized diagnostics, never page content", async () => {
    const missing = await withFetchStub(stubPage(SHELL_PAGE), () =>
      fetchGeeksforgeeksProfile("ghost", DEPS).catch((e) => e)
    );
    expect((missing as PlatformError).details).toBe("gfg.parse=no-anchor");

    const corrupt = `<html><body><script>var x = { "total_problems_solved": "abc" };</script></body></html>`;
    const bad = await withFetchStub(stubPage(corrupt), () =>
      fetchGeeksforgeeksProfile("testuser", DEPS).catch((e) => e)
    );
    const details = (bad as PlatformError).details ?? "";
    expect(details).toMatch(/^gfg\.parse=schema-rejected/);
    expect(details.length).toBeLessThan(200);
    expect(details).not.toContain("<");
    // Public message contract is unchanged.
    expect((bad as Error).message).toBe(
      "GeeksforGeeks returned an unreadable response. The integration may have changed."
    );
  });
});

describe.skipIf(!hasDb)("geeksforgeeks transport failures", () => {
  it("retries transient failures once, then reports upstream", async () => {
    let calls = 0;
    const stub = (async () => {
      calls += 1;
      return calls < 2 ? new Response("boom", { status: 500 }) : new Response(FULL_PAGE, { status: 200 });
    }) as typeof fetch;
    await withFetchStub(stub, async () => {
      const bundle = await fetchGeeksforgeeksProfile("testuser", DEPS);
      expect(bundle.totalSolved).toBe(450);
      expect(calls).toBe(2);
    });
  });

  it("maps rate limits, timeouts, and network errors without leaking internals", async () => {
    const limited = (async () => new Response("{}", { status: 429 })) as typeof fetch;
    await withFetchStub(limited, async () => {
      const err = await fetchGeeksforgeeksProfile("testuser", DEPS).catch((e) => e);
      expect((err as PlatformError).kind).toBe("rate-limited");
    });
    const timeout = (async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    }) as typeof fetch;
    await withFetchStub(timeout, async () => {
      const err = await fetchGeeksforgeeksProfile("testuser", DEPS).catch((e) => e);
      expect((err as PlatformError).kind).toBe("timeout");
    });
    const network = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await withFetchStub(network, async () => {
      const err = await fetchGeeksforgeeksProfile("testuser", DEPS).catch((e) => e);
      expect((err as PlatformError).kind).toBe("network");
    });
  });

  it.each([502, 503, 504])(
    "classifies upstream HTTP %i as an upstream failure (never invalid-username)",
    async (status) => {
      let calls = 0;
      const stub = (async () => {
        calls += 1;
        return new Response("upstream exploded", { status });
      }) as typeof fetch;
      await withFetchStub(stub, async () => {
        const err = await fetchGeeksforgeeksProfile("testuser", DEPS).catch((e) => e);
        expect(err).toBeInstanceOf(PlatformError);
        expect((err as PlatformError).kind).toBe("upstream");
      });
      // Initial attempt + the single permitted retry, then stop.
      expect(calls).toBe(2);
    }
  );

  it("skips a truncated earlier candidate cut off at the window edge", async () => {
    const truncated = '{\\"name\\": \\"Half written bio without end';
    const html = `<html><body><div>${truncated} ... ${"x".repeat(9000)} total_problems_solved ... {"profile": "${doublyInner(
      {}
    )}"};</div></body></html>`;
    await withFetchStub(stubPage(html), async () => {
      const bundle = await fetchGeeksforgeeksProfile("testuser", DEPS);
      expect(bundle.totalSolved).toBe(450);
    });
  });
});

describe.skipIf(!hasDb)("geeksforgeeks connect + sync (mocked network, real DB)", () => {
  async function registerAgent(app: ReturnType<typeof createApp>) {
    const agent = request.agent(app);
    const email = uniqueEmail("mod7");
    trackedEmails.push(email);
    const res = await agent.post("/api/auth/register").send({
      username: uniqueUsername("mod7user"),
      email,
      password: "validpassword123",
    });
    expect(res.status).toBe(201);
    return agent;
  }

  it("connects with score labeled as score (never as rating), no fabricated activity", async () => {
    const app = createApp();
    const agent = await registerAgent(app);
    const connected = await withFetchStub(stubPage(FULL_PAGE), () =>
      agent.post("/api/platform-accounts/GEEKSFORGEEKS/connect").send({ username: "gfguser1" })
    );
    expect(connected.status).toBe(201);
    const account = connected.body.data.account;
    expect(account.platformUsername).toBe("gfguser1");
    // Coding score is NOT a rating: contestRating must stay null.
    expect(account.stats.contestRating).toBeNull();
    expect(account.stats.totalSolved).toBe(450);
    expect(account.stats.contestsAttended).toBeNull();
    expect(account.stats.currentStreak).toBeNull();
    expect(account.stats.longestStreak).toBeNull();
    expect(account.stats.additional).toMatchObject({
      score: 1234,
      monthlyScore: 56,
      podCurrentStreak: 5,
      podLongestStreak: 30,
    });

    const row = await prisma.linkedAccount.findFirstOrThrow({
      where: { platformUsername: "gfguser1" },
    });
    expect(await prisma.activityEvent.count({ where: { linkedAccountId: row.id } })).toBe(0);
    expect(await prisma.contestResult.count({ where: { linkedAccountId: row.id } })).toBe(0);

    const synced = await withFetchStub(stubPage(FULL_PAGE), () =>
      agent.post("/api/platform-accounts/GEEKSFORGEEKS/sync")
    );
    expect(synced.status).toBe(200);
    expect(synced.body.data.account.stats.totalSolved).toBe(450);

    const removed = await agent.delete("/api/platform-accounts/GEEKSFORGEEKS");
    expect(removed.status).toBe(200);
  });

  it("rejects bogus users without creating rows", async () => {
    const app = createApp();
    const agent = await registerAgent(app);
    const res = await withFetchStub(stubPage(SHELL_PAGE), () =>
      agent.post("/api/platform-accounts/GEEKSFORGEEKS/connect").send({ username: "ghostgfg1" })
    );
    expect(res.status).toBe(400);
    expect(
      await prisma.linkedAccount.count({ where: { platformUsername: "ghostgfg1" } })
    ).toBe(0);
  });

  it("reports upstream outages as 502 without creating rows or blaming the username", async () => {
    const app = createApp();
    const agent = await registerAgent(app);
    const outage = (async () => new Response("bad gateway", { status: 502 })) as typeof fetch;
    const res = await withFetchStub(outage, () =>
      agent.post("/api/platform-accounts/GEEKSFORGEEKS/connect").send({ username: "realgfguser" })
    );
    expect(res.status).toBe(502);
    expect(String(res.body.message)).not.toMatch(/invalid|not found/i);
    expect(
      await prisma.linkedAccount.count({ where: { platformUsername: "realgfguser" } })
    ).toBe(0);
  });

  it("connects null-field profiles with null stats instead of failing", async () => {
    const app = createApp();
    const agent = await registerAgent(app);
    const nullPage = statsPage({
      name: null,
      score: null,
      monthly_score: null,
      total_problems_solved: null,
      institute_rank: null,
    });
    const res = await withFetchStub(stubPage(nullPage), () =>
      agent.post("/api/platform-accounts/GEEKSFORGEEKS/connect").send({ username: "nullgfg1" })
    );
    expect(res.status).toBe(201);
    expect(res.body.data.account.stats.totalSolved).toBeNull();
    expect(res.body.data.account.stats.contestRating).toBeNull();
    await agent.delete("/api/platform-accounts/GEEKSFORGEEKS");
  });

  it("failed refresh preserves cached statistics", async () => {
    let calls = 0;
    const flaky = (async () => {
      calls += 1;
      if (calls === 1) return new Response(FULL_PAGE, { status: 200 });
      return new Response("boom", { status: 500 });
    }) as typeof fetch;
    const app = createApp();
    const agent = await registerAgent(app);
    await withFetchStub(flaky, () =>
      agent.post("/api/platform-accounts/GEEKSFORGEEKS/connect").send({ username: "flakygfg1" })
    );
    // Second call fails twice (initial + 1 retry) -> 502, cache preserved.
    const failed = await withFetchStub(flaky, () =>
      agent.post("/api/platform-accounts/GEEKSFORGEEKS/sync")
    );
    expect(failed.status).toBe(502);
    const list = await agent.get("/api/platform-accounts");
    const account = list.body.data.accounts.find(
      (a: { platform: string }) => a.platform === "GEEKSFORGEEKS"
    );
    expect(account.connectionStatus).toBe("ERROR");
    expect(account.stats.totalSolved).toBe(450);
    expect(account.lastSyncedAt).not.toBeNull();
    await agent.delete("/api/platform-accounts/GEEKSFORGEEKS");
  });
});
