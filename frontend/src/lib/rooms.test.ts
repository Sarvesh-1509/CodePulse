import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  invitationStatus,
  invitationStatusLabel,
  isRoomOwner,
  memberDisplayName,
  toInvitationLink,
} from "./rooms";
import {
  ApiError,
  acceptInvitation,
  createRoom,
  createRoomInvitation,
  deleteRoom,
  getRoomDetails,
  getRoomProgress,
  leaveRoom,
  listRoomInvitations,
  listRoomMembers,
  listRooms,
  removeRoomMember,
  revokeRoomInvitation,
  updateRoom,
  validateInvitation,
} from "./api";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    revokedAt: null,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    useCount: 0,
    maxUses: 1,
    ...overrides,
  };
}

describe("toInvitationLink", () => {
  it("joins origin and accept path without doubling slashes", () => {
    expect(toInvitationLink("http://localhost:3000", "/invite/abc")).toBe(
      "http://localhost:3000/invite/abc"
    );
    expect(toInvitationLink("http://localhost:3000/", "/invite/abc")).toBe(
      "http://localhost:3000/invite/abc"
    );
  });
});

describe("invitationStatus", () => {
  it("reports active invitations", () => {
    expect(invitationStatus(invitation())).toBe("active");
  });

  it("reports revoked before checking expiry or uses", () => {
    expect(
      invitationStatus(invitation({ revokedAt: new Date().toISOString() }))
    ).toBe("revoked");
  });

  it("reports expired and exhausted links", () => {
    expect(
      invitationStatus(invitation({ expiresAt: new Date(Date.now() - 1000).toISOString() }))
    ).toBe("expired");
    expect(invitationStatus(invitation({ useCount: 1, maxUses: 1 }))).toBe("exhausted");
  });

  it("labels every status for display", () => {
    expect(invitationStatusLabel("active")).toBe("Active");
    expect(invitationStatusLabel("revoked")).toBe("Revoked");
    expect(invitationStatusLabel("expired")).toBe("Expired");
    expect(invitationStatusLabel("exhausted")).toBe("Used up");
  });
});

describe("room helpers", () => {
  it("detects owners and falls back to usernames", () => {
    expect(isRoomOwner({ myRole: "OWNER" })).toBe(true);
    expect(isRoomOwner({ myRole: "MEMBER" })).toBe(false);
    expect(memberDisplayName({ user: { username: "u", displayName: "Name" } })).toBe("Name");
    expect(memberDisplayName({ user: { username: "u", displayName: null } })).toBe("u");
  });
});

describe("rooms api client", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { success: true, data: {} }))
    );
  });

  it("lists rooms and creates one with name and description", async () => {
    const seen: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        seen.push([String(url), init]);
        if (String(url).endsWith("/api/rooms")) {
          if (init?.method === "POST") {
            expect(init.body).toContain("Weekend");
            return jsonResponse(201, { success: true, data: { room: { id: "r1" } } });
          }
          return jsonResponse(200, { success: true, data: { rooms: [] } });
        }
        return jsonResponse(200, { success: true, data: {} });
      })
    );
    await expect(listRooms()).resolves.toEqual([]);
    await expect(createRoom({ name: "Weekend", description: "d" })).resolves.toEqual({ id: "r1" });
    expect(seen[1][1]?.method).toBe("POST");
    expect(seen[1][1]?.credentials).toBe("include");
  });

  it("fetches details, updates with PATCH, deletes, and leaves rooms", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        seen.push(`${init?.method ?? "GET"} ${String(url)}`);
        if (String(url).endsWith("/leave")) {
          return jsonResponse(200, { success: true, data: { left: true } });
        }
        if ((init?.method ?? "GET") === "PATCH") {
          return jsonResponse(200, { success: true, data: { room: { id: "r1" } } });
        }
        if ((init?.method ?? "GET") === "DELETE") {
          return jsonResponse(200, { success: true, message: "Room deleted." });
        }
        return jsonResponse(200, { success: true, data: { room: { id: "r1" } } });
      })
    );
    await getRoomDetails("r1");
    await updateRoom("r1", { name: "New" });
    await deleteRoom("r1");
    await leaveRoom("r1");
    expect(seen).toEqual([
      "GET http://localhost:5000/api/rooms/r1",
      "PATCH http://localhost:5000/api/rooms/r1",
      "DELETE http://localhost:5000/api/rooms/r1",
      "POST http://localhost:5000/api/rooms/r1/leave",
    ]);
  });

  it("manages members and progress without leaking the room id unencoded", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        seen.push(`${init?.method ?? "GET"} ${String(url)}`);
        return jsonResponse(200, { success: true, data: { members: [], progress: [] } });
      })
    );
    await listRoomMembers("r 1");
    await removeRoomMember("r 1", "u 2");
    await getRoomProgress("r 1");
    expect(seen[0]).toContain("/api/rooms/r%201/members");
    expect(seen[1]).toContain("/api/rooms/r%201/members/u%202");
    expect(seen[2]).toContain("/api/rooms/r%201/progress");
  });

  it("creates, lists, and revokes invitations; validates and accepts tokens", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        seen.push(`${init?.method ?? "GET"} ${String(url)}`);
        return jsonResponse(201, { success: true, data: {} });
      })
    );
    await createRoomInvitation("r1", { expiresInHours: 24, maxUses: 2 });
    await listRoomInvitations("r1");
    await revokeRoomInvitation("inv1");
    await validateInvitation("tok123");
    await acceptInvitation("tok123");
    expect(seen).toEqual([
      "POST http://localhost:5000/api/rooms/r1/invitations",
      "GET http://localhost:5000/api/rooms/r1/invitations",
      "POST http://localhost:5000/api/rooms/invitations/inv1/revoke",
      "GET http://localhost:5000/api/rooms/invitations/tok123/validate",
      "POST http://localhost:5000/api/rooms/invitations/tok123/accept",
    ]);
  });

  it("surfaces room errors with status instead of mock data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(404, { success: false, message: "Room not found." }))
    );
    const err = await getRoomDetails("missing").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    const forbidden = await validateInvitation("tok").catch((e) => e);
    expect((forbidden as ApiError).status).toBe(404);
  });
});
