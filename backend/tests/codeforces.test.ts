import { describe, expect, it } from "vitest";
import {
  fetchAllSubmissions,
  fetchContestHistory,
  fetchUserProfile,
  withFetchStub,
} from "../src/modules/codeforces/client";
import { createCodeforcesAdapter } from "../src/modules/codeforces/service";
import { PlatformError } from "../src/modules/platforms/errors";

const DEPS = { timeoutMs: 2000 };

// --- Stub fetch helpers (no network) ---

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function routerStub(
  routes: Record<string, (url: string) => Response | Promise<Response>>
): typeof fetch {
  return (async (url: unknown) => {
    const target = String(url);
    for (const [key, handler] of Object.entries(routes)) {
      if (target.includes(key)) return handler(target);
    }
    throw new Error(`unexpected URL in stub: ${target}`);
  }) as typeof fetch;
}

const profileFixture = {
  status: "OK",
  result: [
    {
      handle: "TestUser",
      rating: 1600,
      maxRating: 1900,
      rank: "expert",
      maxRank: "candidate master",
    },
  ],
};

const unratedProfileFixture = {
  status: "OK",
  result: [{ handle: "NewUser" }],
};

const ratingFixture = {
  status: "OK",
  result: [
    {
      contestId: 1790,
      contestName: "Round #1790",
      handle: "TestUser",
      rank: 123,
      ratingUpdateTimeSeconds: 1700000000,
      oldRating: 1500,
      newRating: 1600,
    },
    // Malformed entry: must be skipped, not fatal.
    { contestId: "oops", contestName: 42 },
  ],
};

function submissionFixture() {
  return {
    status: "OK",
    result: [
      {
        id: 300,
        creationTimeSeconds: 1700000300,
        verdict: "OK",
        problem: { contestId: 1791, index: "A", name: "Alpha", rating: 800 },
      },
      {
        id: 299,
        creationTimeSeconds: 1700000200,
        verdict: "OK",
        problem: { contestId: 1791, index: "A", name: "Alpha", rating: 800 },
      },
      {
        id: 298,
        creationTimeSeconds: 1700000100,
        verdict: "WRONG_ANSWER",
        problem: { contestId: 1791, index: "B", name: "Beta" },
      },
      {
        id: 297,
        creationTimeSeconds: 1700000000,
        problem: { index: "C", name: "Gamma" },
      },
    ],
  };
}

function fullStub() {
  return routerStub({
    "/user.info": () => jsonResponse(profileFixture),
    "/user.rating": () => jsonResponse(ratingFixture),
    "/user.status": () => jsonResponse(submissionFixture()),
  });
}

describe("codeforces profile lookup", () => {
  it("maps a valid rated profile (canonical handle case)", async () => {
    await withFetchStub(fullStub(), async () => {
      const profile = await fetchUserProfile("testuser", DEPS);
      expect(profile.handle).toBe("TestUser");
      expect(profile.rating).toBe(1600);
      expect(profile.maxRating).toBe(1900);
      expect(profile.rank).toBe("expert");
    });
  });

  it("keeps missing rating fields null (unrated users)", async () => {
    const stub = routerStub({ "/user.info": () => jsonResponse(unratedProfileFixture) });
    await withFetchStub(stub, async () => {
      const profile = await fetchUserProfile("newuser", DEPS);
      expect(profile.rating).toBeNull();
      expect(profile.maxRating).toBeNull();
      expect(profile.rank).toBeNull();
    });
  });

  it("rejects invalid handles from the API with not-found", async () => {
    const stub = routerStub({
      "/user.info": () =>
        jsonResponse({ status: "FAILED", comment: "handles: User with handle ghost not found" }),
    });
    await withFetchStub(stub, async () => {
      const err = await fetchUserProfile("ghost", DEPS).catch((e) => e);
      expect(err).toBeInstanceOf(PlatformError);
      expect((err as PlatformError).kind).toBe("not-found");
    });
  });

  it("maps every endpoint's not-found wording to not-found (regression)", async () => {
    // Observed live: user.info, user.status, and user.rating each phrase
    // unknown handles differently. All three must become validation
    // errors — never a 502 from a race between parallel fetches.
    const comments = [
      "handles: User with handle ghost not found",
      "handle: User with handle ghost not found",
      "handle: User ghost not found",
    ];
    for (const comment of comments) {
      const stub = routerStub({
        "/user.info": () => jsonResponse({ status: "FAILED", comment }),
      });
      await withFetchStub(stub, async () => {
        const err = await fetchUserProfile("ghost", DEPS).catch((e) => e);
        expect((err as PlatformError).kind).toBe("not-found");
      });
    }
  });

  it("reads the FAILED envelope on HTTP 400 (observed live behavior)", async () => {
    // Observed live: Codeforces answers unknown handles with HTTP 400
    // carrying {"status":"FAILED",...}. The envelope — not the status —
    // decides, without retries.
    let calls = 0;
    const stub = (async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ status: "FAILED", comment: "handles: User with handle ghost not found" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    await withFetchStub(stub, async () => {
      const err = await fetchUserProfile("ghost", DEPS).catch((e) => e);
      expect((err as PlatformError).kind).toBe("not-found");
      expect(calls).toBe(1);
    });
  });

  it("verifies the handle before enrichment fetches (deterministic bogus handling)", async () => {    // Observed live: user.status answers bogus handles with a bare HTTP 400
    // while user.info answers 200+FAILED. The adapter must gate on the
    // profile first so bogus handles deterministically become not-found
    // instead of racing into a 502.
    const calls: string[] = [];
    const stub = (async (url: unknown) => {
      const target = String(url);
      calls.push(target);
      if (target.includes("/user.info")) {
        return jsonResponse({ status: "FAILED", comment: "handles: User with handle ghost not found" });
      }
      return new Response("bad", { status: 400 });
    }) as typeof fetch;
    await withFetchStub(stub, async () => {
      const adapter = createCodeforcesAdapter(DEPS);
      const err = await adapter.fetchAll("ghost").catch((e) => e);
      expect(err).toBeInstanceOf(PlatformError);
      expect((err as PlatformError).kind).toBe("not-found");
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain("/user.info");
    });
  });

  it("maps rate-limit comments to rate-limited without retrying", async () => {
    let calls = 0;
    const stub = (async () => {
      calls += 1;
      return jsonResponse({ status: "FAILED", comment: "Call limit exceeded" });
    }) as typeof fetch;
    await withFetchStub(stub, async () => {
      const err = await fetchUserProfile("testuser", DEPS).catch((e) => e);
      expect((err as PlatformError).kind).toBe("rate-limited");
      expect(calls).toBe(1);
    });
  });
});

describe("codeforces transport failures", () => {
  it("retries transient HTTP 500s, then succeeds", async () => {
    let calls = 0;
    const stub = (async () => {
      calls += 1;
      return calls < 3 ? new Response("boom", { status: 500 }) : jsonResponse(profileFixture);
    }) as typeof fetch;
    await withFetchStub(stub, async () => {
      const profile = await fetchUserProfile("testuser", DEPS);
      expect(profile.handle).toBe("TestUser");
      expect(calls).toBe(3);
    });
  });

  it("does not retry permanent HTTP errors", async () => {
    let calls = 0;
    const stub = (async () => {
      calls += 1;
      return new Response("nope", { status: 404 });
    }) as typeof fetch;
    await withFetchStub(stub, async () => {
      const err = await fetchUserProfile("testuser", DEPS).catch((e) => e);
      expect((err as PlatformError).kind).toBe("upstream");
      expect(calls).toBe(1);
    });
  });

  it("retries network failures a bounded number of times", async () => {
    let calls = 0;
    const stub = (async () => {
      calls += 1;
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await withFetchStub(stub, async () => {
      const err = await fetchUserProfile("testuser", DEPS).catch((e) => e);
      expect((err as PlatformError).kind).toBe("network");
      expect(calls).toBe(3);
    });
  });

  it("maps aborts to timeout errors", async () => {
    let calls = 0;
    const stub = (async () => {
      calls += 1;
      throw new DOMException("The operation was aborted.", "AbortError");
    }) as typeof fetch;
    await withFetchStub(stub, async () => {
      const err = await fetchUserProfile("testuser", DEPS).catch((e) => e);
      expect((err as PlatformError).kind).toBe("timeout");
      expect(calls).toBe(3);
    });
  });

  it("rejects malformed JSON as invalid-response", async () => {
    const stub = (async () => new Response("{{not json", { status: 200 })) as typeof fetch;
    await withFetchStub(stub, async () => {
      const err = await fetchUserProfile("testuser", DEPS).catch((e) => e);
      expect((err as PlatformError).kind).toBe("invalid-response");
    });
  });
});

describe("codeforces sync mapping", () => {
  it("counts unique solved problems, only OK verdicts, skips bad entries", async () => {
    await withFetchStub(fullStub(), async () => {
      const adapter = createCodeforcesAdapter(DEPS);
      const bundle = await adapter.fetchAll("TestUser");
      expect(bundle.canonicalUsername).toBe("TestUser");
      // 1791A solved twice -> one unique problem; B failed; C missing verdict.
      expect(bundle.stats.totalSolved).toBe(1);
      expect(bundle.stats.contestRating).toBe(1600);
      expect(bundle.stats.contestsAttended).toBe(1);
      expect(bundle.stats.currentStreak).toBeNull();
      expect(bundle.activities).toHaveLength(2);
      expect(bundle.activities[0]).toMatchObject({
        externalId: "cf-300",
        type: "PROBLEM_SOLVED",
        problemId: "1791A",
        difficulty: "800",
      });
      expect(bundle.contests).toHaveLength(1);
      expect(bundle.contests[0]).toMatchObject({
        externalId: "cf-1790",
        ratingBefore: 1500,
        ratingChange: 100,
        ratingAfter: 1600,
        rank: 123,
      });
      expect(bundle.stats.extra).toMatchObject({ maxRating: 1900, rank: "expert" });
    });
  });

  it(
    "flags truncation when the page cap is hit",
    { timeout: 30000 },
    async () => {
    const big = Array.from({ length: 1000 }, (_, i) => ({
      id: 5000 - i,
      creationTimeSeconds: 1700000000 - i,
      verdict: "OK",
      problem: { contestId: 1000, index: `Z${i}`, name: `P${i}` },
    }));
    const stub = routerStub({
      "/user.info": () => jsonResponse(profileFixture),
      "/user.rating": () => jsonResponse({ status: "OK", result: [] }),
      "/user.status": () => jsonResponse({ status: "OK", result: big }),
    });
    await withFetchStub(stub, async () => {
      const adapter = createCodeforcesAdapter(DEPS);
      const bundle = await adapter.fetchAll("TestUser", {});
      expect(bundle.stats.truncated).toBe(true);
    });
    }
  );
});
