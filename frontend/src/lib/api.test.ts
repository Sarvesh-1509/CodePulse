import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  acceptReceivedInvitation,
  connectPlatformAccount,
  createRoomInvitation,
  declineReceivedInvitation,
  disconnectPlatformAccount,
  getActivityDays,
  getActivityStreak,
  getCurrentUser,
  getRating,
  getRatingHistory,
  getRecentActivity,
  listPlatformAccounts,
  listPlatforms,
  listReceivedInvitations,
  loginRequest,
  recalculateRating,
  registerRequest,
  syncPlatformAccount,
} from "./api";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api client", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { success: true, data: {} }))
    );
  });

  it("sends credentials (cookies) and JSON content type", async () => {
    await getCurrentUser().catch(() => undefined);
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe("include");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json"
    );
  });

  it("returns the user on successful registration", async () => {
    const user = { id: "1", username: "u", email: "u@e.com" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, { success: true, data: { user } })
      )
    );
    await expect(
      registerRequest({ username: "u", email: "u@e.com", password: "longpassword123" })
    ).resolves.toEqual(user);
  });

  it("throws ApiError with status and issues on validation failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(400, {
          success: false,
          message: "Invalid login details.",
          issues: { email: ["Enter a valid email address."] },
        })
      )
    );
    const err = await loginRequest({ email: "bad", password: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).issues?.email).toEqual(["Enter a valid email address."]);
  });

  it("throws a connection ApiError when fetch itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    const err = await getCurrentUser().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
  });

  it("never stores tokens: responses carry only the user object", async () => {
    const body = { success: true, data: { user: { id: "1" } } };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, body)));
    const user = await getCurrentUser();
    expect(user).toEqual({ id: "1" });
    expect(JSON.stringify(user)).not.toMatch(/token|passwordHash/i);
  });
});

describe("platform api client", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { success: true, data: {} }))
    );
  });

  it("lists platforms", async () => {
    const platforms = [{ id: "CODEFORCES", available: true }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        expect(String(url)).toContain("/api/platforms");
        return jsonResponse(200, { success: true, data: { platforms } });
      })
    );
    await expect(listPlatforms()).resolves.toEqual(platforms);
  });

  it("connects an account with POST and the username body", async () => {
    const account = { platform: "CODEFORCES", platformUsername: "tourist" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init: unknown) => {
        expect(String(url)).toContain("/api/platform-accounts/CODEFORCES/connect");
        expect((init as RequestInit).method).toBe("POST");
        expect((init as RequestInit).credentials).toBe("include");
        return jsonResponse(201, { success: true, data: { account } });
      })
    );
    await expect(connectPlatformAccount("CODEFORCES", "tourist")).resolves.toEqual(account);
  });

  it("surfaces connect validation errors with status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(400, { success: false, message: "Enter a valid Codeforces handle." }))
    );
    const err = await connectPlatformAccount("CODEFORCES", "ab").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
  });

  it("disconnects with DELETE and syncs with POST", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        calls.push([String(url), init]);
        if (String(url).endsWith("/sync")) {
          return jsonResponse(200, { success: true, data: { account: { platform: "LEETCODE" } } });
        }
        return jsonResponse(200, { success: true, message: "Disconnected." });
      })
    );
    await disconnectPlatformAccount("LEETCODE");
    const account = await syncPlatformAccount("LEETCODE");
    expect(account).toEqual({ platform: "LEETCODE" });
    expect(calls[0][1]?.method).toBe("DELETE");
    expect(calls[1][1]?.method).toBe("POST");
  });

  it("lists linked accounts", async () => {
    const accounts = [{ platform: "LEETCODE", stats: null }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { success: true, data: { accounts } }))
    );
    await expect(listPlatformAccounts()).resolves.toEqual(accounts);
  });
});

describe("activity and rating api client", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { success: true, data: {} }))
    );
  });

  it("fetches the streak with credentials", async () => {
    const payload = { streak: { current: 3 }, coverage: {}, totals: {} };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init: unknown) => {
        expect(String(url)).toContain("/api/activity/streak");
        expect((init as RequestInit).credentials).toBe("include");
        return jsonResponse(200, { success: true, data: payload });
      })
    );
    await expect(getActivityStreak()).resolves.toEqual(payload);
  });

  it("passes days and end params to the days endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        expect(String(url)).toContain("/api/activity/days");
        expect(String(url)).toContain("days=30");
        expect(String(url)).toContain("end=2026-06-30");
        return jsonResponse(200, { success: true, data: { days: [] } });
      })
    );
    await getActivityDays(30, "2026-06-30");
  });

  it("passes pagination and filters to the recent endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        const text = String(url);
        expect(text).toContain("/api/activity/recent");
        expect(text).toContain("limit=5");
        expect(text).toContain("platform=CODEFORCES");
        return jsonResponse(200, {
          success: true,
          data: { items: [], pagination: { limit: 5, offset: 0, total: 0 } },
        });
      })
    );
    const data = await getRecentActivity({ limit: 5, platform: "CODEFORCES" });
    expect(data.pagination.total).toBe(0);
  });

  it("fetches and recalculates the rating", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${String(url)}`);
        return jsonResponse(200, { success: true, data: { rating: 500 } });
      })
    );
    await getRating();
    await recalculateRating();
    expect(calls).toEqual(["GET http://localhost:5000/api/rating", "POST http://localhost:5000/api/rating/recalculate"]);
  });

  it("fetches rating history with a limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        expect(String(url)).toContain("/api/rating/history?limit=5");
        return jsonResponse(200, { success: true, data: { snapshots: [] } });
      })
    );
    await expect(getRatingHistory(5)).resolves.toEqual({ snapshots: [] });
  });

  it("surfaces rating errors with status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(503, { success: false, message: "Database is not configured." }))
    );
    const err = await getRating().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(503);
  });
});

describe("room invitation api client", () => {
  it("sends the username body when inviting by username", async () => {
    const calls: Array<{ method?: string; url: string; body?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        calls.push({
          method: init?.method,
          url: String(url),
          body: init?.body as string | undefined,
        });
        return jsonResponse(201, {
          success: true,
          data: { invitation: { invitedUsername: "friend" }, token: "t", acceptPath: "/invite/t" },
        });
      })
    );
    await createRoomInvitation("room-1", { username: "friend" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/api/rooms/room-1/invitations");
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({ username: "friend" });
  });

  it("lists, accepts, and declines received invitations", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${String(url)}`);
        const text = String(url);
        if (text.endsWith("/invitations/received")) {
          return jsonResponse(200, { success: true, data: { invitations: [] } });
        }
        return jsonResponse(200, { success: true, data: { invitation: {}, roomId: "r", alreadyMember: false } });
      })
    );
    await listReceivedInvitations();
    await acceptReceivedInvitation("inv-1");
    await declineReceivedInvitation("inv-2");
    expect(calls).toEqual([
      "GET http://localhost:5000/api/rooms/invitations/received",
      "POST http://localhost:5000/api/rooms/invitations/received/inv-1/accept",
      "POST http://localhost:5000/api/rooms/invitations/received/inv-2/decline",
    ]);
  });
});