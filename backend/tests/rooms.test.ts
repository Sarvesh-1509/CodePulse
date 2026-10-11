import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";
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
});

interface TestUser {
  agent: ReturnType<typeof request.agent>;
  id: string;
  username: string;
}

/** Fresh app per test so rate-limiter counters never leak between tests. */
async function user(prefix = "mod13"): Promise<TestUser & { app: ReturnType<typeof createApp> }> {
  const app = createApp();
  const agent = request.agent(app);
  const email = uniqueEmail(prefix);
  trackedEmails.push(email);
  const username = uniqueUsername(`${prefix}user`);
  const res = await agent.post("/api/auth/register").send({
    username,
    email,
    password: "validpassword123",
  });
  expect(res.status).toBe(201);
  return { app, agent, id: res.body.data.user.id as string, username };
}

async function createRoom(agent: TestUser["agent"], name = "Test room", description?: string) {
  const res = await agent.post("/api/rooms").send(
    description === undefined ? { name } : { name, description }
  );
  expect(res.status).toBe(201);
  return res.body.data.room as { id: string; name: string; myRole: string; memberCount: number };
}

async function createInvitation(agent: TestUser["agent"], roomId: string, body: object = {}) {
  const res = await agent.post(`/api/rooms/${roomId}/invitations`).send(body);
  expect(res.status).toBe(201);
  return res.body.data as {
    token: string;
    acceptPath: string;
    invitation: { id: string; roomId: string; maxUses: number; useCount: number };
  };
}

const UNKNOWN_UUID = "00000000-0000-4000-8000-000000000000";
const UNKNOWN_TOKEN = "A".repeat(43);

describe.skipIf(!hasDb)("rooms authentication", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const app = createApp();
    expect((await request(app).get("/api/rooms")).status).toBe(401);
    expect((await request(app).post("/api/rooms").send({ name: "x" })).status).toBe(401);
    expect((await request(app).get(`/api/rooms/${UNKNOWN_UUID}`)).status).toBe(401);
    expect((await request(app).get(`/api/rooms/invitations/${UNKNOWN_TOKEN}/validate`)).status).toBe(
      401
    );
    expect((await request(app).post(`/api/rooms/invitations/${UNKNOWN_TOKEN}/accept`)).status).toBe(
      401
    );
  });
});

describe.skipIf(!hasDb)("room creation and validation", () => {
  it("creates a room with the creator as owner", async () => {
    const { agent } = await user("mod13c");
    const room = await createRoom(agent, "Weekend grinders", "Saturday sessions");
    expect(room.myRole).toBe("OWNER");
    expect(room.memberCount).toBe(1);
    expect(room.name).toBe("Weekend grinders");
  });

  it("rejects invalid room details", async () => {
    const { agent } = await user("mod13v");
    expect((await agent.post("/api/rooms").send({ name: "" })).status).toBe(400);
    expect((await agent.post("/api/rooms").send({ name: "x".repeat(61) })).status).toBe(400);
    expect((await agent.post("/api/rooms").send({})).status).toBe(400);
    expect(
      (await agent.post("/api/rooms").send({ name: "ok", ownerId: "someone-else" })).status
    ).toBe(400);
  });

  it("lists only the rooms the user belongs to", async () => {
    const alice = await user("mod13l");
    const bob = await user("mod13m");
    await createRoom(alice.agent, "Alice room");
    const aliceList = await alice.agent.get("/api/rooms");
    expect(aliceList.status).toBe(200);
    expect(aliceList.body.data.rooms).toHaveLength(1);
    const bobList = await bob.agent.get("/api/rooms");
    expect(bobList.body.data.rooms).toEqual([]);
  });
});

describe.skipIf(!hasDb)("room details and updates", () => {
  it("shows details to members and 404 to outsiders without leaking existence", async () => {
    const alice = await user("mod13d");
    const bob = await user("mod13n");
    const room = await createRoom(alice.agent, "Secret room");
    const details = await alice.agent.get(`/api/rooms/${room.id}`);
    expect(details.status).toBe(200);
    expect(details.body.data.room.members).toHaveLength(1);
    expect(details.body.data.room.members[0].user.email).toBeUndefined();
    // Non-members get the same 404 as a missing room.
    expect((await bob.agent.get(`/api/rooms/${room.id}`)).status).toBe(404);
    expect((await bob.agent.get(`/api/rooms/${UNKNOWN_UUID}`)).status).toBe(404);
    expect((await alice.agent.get("/api/rooms/not-a-uuid")).status).toBe(400);
  });

  it("lets the owner update settings but not members", async () => {
    const alice = await user("mod13u");
    const bob = await user("mod13o");
    const room = await createRoom(alice.agent, "Old name");
    const invite = await createInvitation(alice.agent, room.id);
    await bob.agent.post(`/api/rooms/invitations/${invite.token}/accept`);
    const updated = await alice.agent.patch(`/api/rooms/${room.id}`).send({ name: "New name" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.room.name).toBe("New name");
    expect((await bob.agent.patch(`/api/rooms/${room.id}`).send({ name: "Hijack" })).status).toBe(
      403
    );
    expect((await alice.agent.patch(`/api/rooms/${room.id}`).send({})).status).toBe(400);
  });
});

describe.skipIf(!hasDb)("invitations", () => {
  it("creates invitations without ever returning a stored hash", async () => {
    const { agent } = await user("mod13i");
    const room = await createRoom(agent, "Invite room");
    const created = await createInvitation(agent, room.id, { expiresInHours: 24, maxUses: 2 });
    expect(typeof created.token).toBe("string");
    expect(created.token.length).toBeGreaterThanOrEqual(32);
    expect(created.acceptPath).toBe(`/invite/${created.token}`);
    expect(created.invitation.maxUses).toBe(2);
    expect((created.invitation as Record<string, unknown>).tokenHash).toBeUndefined();
    // Owner-only listing; members-only reads stay private.
    const listed = await agent.get(`/api/rooms/${room.id}/invitations`);
    expect(listed.status).toBe(200);
    expect(listed.body.data.invitations).toHaveLength(1);
    expect(listed.body.data.invitations[0].token).toBeUndefined();
  });

  it("validates and accepts a token, then treats repeats as idempotent", async () => {
    const alice = await user("mod13j");
    const bob = await user("mod13p");
    const room = await createRoom(alice.agent, "Join room");
    const invite = await createInvitation(alice.agent, room.id);
    const preview = await bob.agent.get(`/api/rooms/invitations/${invite.token}/validate`);
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({ roomName: "Join room", alreadyMember: false });
    const first = await bob.agent.post(`/api/rooms/invitations/${invite.token}/accept`);
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ roomId: room.id, alreadyMember: false });
    // Repeat acceptance: success without a duplicate membership.
    const second = await bob.agent.post(`/api/rooms/invitations/${invite.token}/accept`);
    expect(second.status).toBe(200);
    expect(second.body.data.alreadyMember).toBe(true);
    const members = await alice.agent.get(`/api/rooms/${room.id}/members`);
    expect(members.body.data.members).toHaveLength(2);
  });

  it("still previews an exhausted link to the member who used it", async () => {
    const alice = await user("mod13q2");
    const bob = await user("mod13r2");
    const carol = await user("mod13s2");
    const room = await createRoom(alice.agent, "Reopen room");
    const invite = await createInvitation(alice.agent, room.id, { maxUses: 1 });
    expect((await bob.agent.post(`/api/rooms/invitations/${invite.token}/accept`)).status).toBe(201);
    // Bob used the single seat: his own preview still works (alreadyMember),
    // while an outsider learns nothing.
    const preview = await bob.agent.get(`/api/rooms/invitations/${invite.token}/validate`);
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({ roomName: "Reopen room", alreadyMember: true });
    expect((await carol.agent.get(`/api/rooms/invitations/${invite.token}/validate`)).status).toBe(
      404
    );
  });

  it("exhausts single-use invitations with a generic 404", async () => {
    const alice = await user("mod13k");
    const bob = await user("mod13q");
    const carol = await user("mod13r");
    const room = await createRoom(alice.agent, "Single seat");
    const invite = await createInvitation(alice.agent, room.id, { maxUses: 1 });
    expect((await bob.agent.post(`/api/rooms/invitations/${invite.token}/accept`)).status).toBe(201);
    // A different user finds nothing usable — same 404 as an unknown token.
    expect((await carol.agent.post(`/api/rooms/invitations/${invite.token}/accept`)).status).toBe(
      404
    );
    expect((await carol.agent.get(`/api/rooms/invitations/${invite.token}/validate`)).status).toBe(
      404
    );
  });

  it("rejects expired invitations", async () => {
    const alice = await user("mod13x");
    const bob = await user("mod13s");
    const room = await createRoom(alice.agent, "Stale room");
    const invite = await createInvitation(alice.agent, room.id);
    await prisma.roomInvitation.update({
      where: { id: invite.invitation.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await bob.agent.get(`/api/rooms/invitations/${invite.token}/validate`)).status).toBe(
      404
    );
    expect((await bob.agent.post(`/api/rooms/invitations/${invite.token}/accept`)).status).toBe(404);
  });

  it("revokes invitations and keeps revocation idempotent", async () => {
    const alice = await user("mod13t");
    const bob = await user("mod13u2");
    const room = await createRoom(alice.agent, "Revoke room");
    const invite = await createInvitation(alice.agent, room.id);
    const revoked = await alice.agent.post(`/api/rooms/invitations/${invite.invitation.id}/revoke`);
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.invitation.revokedAt).not.toBeNull();
    expect((await bob.agent.post(`/api/rooms/invitations/${invite.token}/accept`)).status).toBe(404);
    // Revoking twice stays a success.
    expect(
      (await alice.agent.post(`/api/rooms/invitations/${invite.invitation.id}/revoke`)).status
    ).toBe(200);
  });

  it("rejects malformed and unknown tokens without details", async () => {
    const { agent } = await user("mod13z");
    expect((await agent.get("/api/rooms/invitations/short/validate")).status).toBe(400);
    expect((await agent.get(`/api/rooms/invitations/${UNKNOWN_TOKEN}/validate`)).status).toBe(404);
    expect((await agent.post(`/api/rooms/invitations/${UNKNOWN_TOKEN}/accept`)).status).toBe(404);
  });

  it("keeps invitation management owner-only", async () => {
    const alice = await user("mod13w");
    const bob = await user("mod13v2");
    const room = await createRoom(alice.agent, "Guarded room");
    const invite = await createInvitation(alice.agent, room.id);
    await bob.agent.post(`/api/rooms/invitations/${invite.token}/accept`);
    // Bob is a member but not the owner.
    expect((await bob.agent.post(`/api/rooms/${room.id}/invitations`).send({})).status).toBe(403);
    expect((await bob.agent.get(`/api/rooms/${room.id}/invitations`)).status).toBe(403);
    expect(
      (await bob.agent.post(`/api/rooms/invitations/${invite.invitation.id}/revoke`)).status
    ).toBe(403);
  });
});

describe.skipIf(!hasDb)("username invitations", () => {
  async function received(agent: TestUser["agent"]) {
    const res = await agent.get("/api/rooms/invitations/received");
    expect(res.status).toBe(200);
    return res.body.data.invitations as Array<{
      id: string;
      roomId: string;
      roomName: string;
      createdByUsername: string;
      invitedUsername: string | null;
    }>;
  }

  it("sends, lists, and accepts an in-app invitation without any link", async () => {
    const alice = await user("m13a");
    const bob = await user("m13b");
    const room = await createRoom(alice.agent, "Direct room");
    const sent = await alice.agent
      .post(`/api/rooms/${room.id}/invitations`)
      .send({ username: bob.username });
    expect(sent.status).toBe(201);
    expect(sent.body.data.invitation.invitedUsername).toBe(bob.username);
    expect(sent.body.data.invitation.maxUses).toBe(1);
    expect(sent.body.data.invitation.token).toBeUndefined();
    // Owner listing shows the recipient.
    const listed = await alice.agent.get(`/api/rooms/${room.id}/invitations`);
    expect(listed.body.data.invitations[0].invitedUsername).toBe(bob.username);
    // Recipient sees it pending with only safe fields.
    const pending = await received(bob.agent);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      roomName: "Direct room",
      createdByUsername: alice.username,
      invitedUsername: bob.username,
    });
    expect((pending[0] as Record<string, unknown>).token).toBeUndefined();
    // Accept joins the room; accepting twice stays idempotent.
    const first = await bob.agent.post(
      `/api/rooms/invitations/received/${pending[0].id}/accept`
    );
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ roomId: room.id, alreadyMember: false });
    const second = await bob.agent.post(
      `/api/rooms/invitations/received/${pending[0].id}/accept`
    );
    expect(second.status).toBe(200);
    expect(second.body.data.alreadyMember).toBe(true);
    const members = await alice.agent.get(`/api/rooms/${room.id}/members`);
    expect(members.body.data.members).toHaveLength(2);
    // Joined rooms leave the pending list.
    expect(await received(bob.agent)).toEqual([]);
  });

  it("declines an invitation and keeps declining idempotent", async () => {
    const alice = await user("m13c");
    const bob = await user("m13d");
    const room = await createRoom(alice.agent, "Decline room");
    await alice.agent.post(`/api/rooms/${room.id}/invitations`).send({ username: bob.username });
    const pending = await received(bob.agent);
    expect(pending).toHaveLength(1);
    const declined = await bob.agent.post(
      `/api/rooms/invitations/received/${pending[0].id}/decline`
    );
    expect(declined.status).toBe(200);
    expect(await received(bob.agent)).toEqual([]);
    // Declining twice stays a success; the recipient never joined.
    expect(
      (
        await bob.agent.post(`/api/rooms/invitations/received/${pending[0].id}/decline`)
      ).status
    ).toBe(200);
    expect((await bob.agent.get(`/api/rooms/${room.id}`)).status).toBe(404);
  });

  it("rejects self-invites, unknown users, bad shapes, duplicates, and members", async () => {
    const alice = await user("m13e");
    const bob = await user("m13f");
    const room = await createRoom(alice.agent, "Guard room");
    expect((await alice.agent.post(`/api/rooms/${room.id}/invitations`).send({ username: alice.username })).status).toBe(400);
    expect(
      (await alice.agent.post(`/api/rooms/${room.id}/invitations`).send({ username: "nobody-with-this-name-xyz" })).status
    ).toBe(404);
    expect((await alice.agent.post(`/api/rooms/${room.id}/invitations`).send({ username: "ab" })).status).toBe(400);
    expect((await alice.agent.post(`/api/rooms/${room.id}/invitations`).send({ username: "bad name!" })).status).toBe(400);
    const first = await alice.agent.post(`/api/rooms/${room.id}/invitations`).send({ username: bob.username });
    expect(first.status).toBe(201);
    // Duplicate pending invitation is refused...
    expect((await alice.agent.post(`/api/rooms/${room.id}/invitations`).send({ username: bob.username })).status).toBe(409);
    // ...and so is inviting someone who already joined.
    const pending = await received(bob.agent);
    expect((await bob.agent.post(`/api/rooms/invitations/received/${pending[0].id}/accept`)).status).toBe(201);
    expect((await alice.agent.post(`/api/rooms/${room.id}/invitations`).send({ username: bob.username })).status).toBe(409);
  });

  it("enforces recipient-only access and owner-only sending", async () => {
    const alice = await user("m13g");
    const bob = await user("m13h");
    const carol = await user("m13i");
    const dave = await user("m13j");
    const room = await createRoom(alice.agent, "Private invite");
    await alice.agent.post(`/api/rooms/${room.id}/invitations`).send({ username: bob.username });
    const pending = await received(bob.agent);
    // A stranger sees nothing pending and cannot accept or decline by id.
    expect(await received(carol.agent)).toEqual([]);
    expect((await carol.agent.post(`/api/rooms/invitations/received/${pending[0].id}/accept`)).status).toBe(404);
    expect((await carol.agent.post(`/api/rooms/invitations/received/${pending[0].id}/decline`)).status).toBe(404);
    expect((await carol.agent.post(`/api/rooms/invitations/received/${UNKNOWN_UUID}/accept`)).status).toBe(404);
    // Members who are not owners cannot send invites.
    const invite = await createInvitation(alice.agent, room.id);
    await dave.agent.post(`/api/rooms/invitations/${invite.token}/accept`);
    expect((await dave.agent.post(`/api/rooms/${room.id}/invitations`).send({ username: carol.username })).status).toBe(403);
    // Unauthenticated reads are rejected.
    expect((await request(alice.app).get("/api/rooms/invitations/received")).status).toBe(401);
  });

  it("keeps addressed invitations out of the link flow", async () => {
    const alice = await user("m13k");
    const bob = await user("m13l");
    const carol = await user("m13m");
    const room = await createRoom(alice.agent, "Addressed room");
    const sent = await alice.agent
      .post(`/api/rooms/${room.id}/invitations`)
      .send({ username: bob.username });
    expect(sent.status).toBe(201);
    // The creation-time token is never usable as a share link, even by the
    // recipient or an outsider.
    const token = sent.body.data.token as string;
    expect((await bob.agent.get(`/api/rooms/invitations/${token}/validate`)).status).toBe(404);
    expect((await bob.agent.post(`/api/rooms/invitations/${token}/accept`)).status).toBe(404);
    expect((await carol.agent.post(`/api/rooms/invitations/${token}/accept`)).status).toBe(404);
    // Plain link invites still work exactly as before.
    const link = await createInvitation(alice.agent, room.id);
    expect((await carol.agent.post(`/api/rooms/invitations/${link.token}/accept`)).status).toBe(201);
  });
});

describe.skipIf(!hasDb)("membership management", () => {
  it("removes members as the owner and blocks self-removal", async () => {
    const alice = await user("mod13e");
    const bob = await user("mod13f");
    const room = await createRoom(alice.agent, "Team room");
    const invite = await createInvitation(alice.agent, room.id);
    await bob.agent.post(`/api/rooms/invitations/${invite.token}/accept`);
    const removed = await alice.agent.delete(`/api/rooms/${room.id}/members/${bob.id}`);
    expect(removed.status).toBe(200);
    // Removed members lose access like any outsider.
    expect((await bob.agent.get(`/api/rooms/${room.id}`)).status).toBe(404);
    // The owner removes themselves via leave, not via removal.
    expect((await alice.agent.delete(`/api/rooms/${room.id}/members/${alice.id}`)).status).toBe(
      400
    );
    // Members cannot remove each other.
    const carol = await user("mod13g");
    expect((await carol.agent.delete(`/api/rooms/${room.id}/members/${alice.id}`)).status).toBe(
      404
    );
  });

  it("transfers ownership when the owner leaves with members behind", async () => {
    const alice = await user("mod13h");
    const bob = await user("mod13y");
    const room = await createRoom(alice.agent, "Handover room");
    const invite = await createInvitation(alice.agent, room.id);
    await bob.agent.post(`/api/rooms/invitations/${invite.token}/accept`);
    const left = await alice.agent.post(`/api/rooms/${room.id}/leave`);
    expect(left.status).toBe(200);
    expect(left.body.data.roomDeleted).toBe(false);
    expect(left.body.data.transferredToUsername).toBe(bob.username);
    const details = await bob.agent.get(`/api/rooms/${room.id}`);
    expect(details.body.data.room.myRole).toBe("OWNER");
  });

  it("deletes the room when a sole owner leaves, and on owner delete", async () => {
    const alice = await user("mod13d2");
    const solo = await createRoom(alice.agent, "Solo room");
    const left = await alice.agent.post(`/api/rooms/${solo.id}/leave`);
    expect(left.body.data.roomDeleted).toBe(true);
    expect((await alice.agent.get(`/api/rooms/${solo.id}`)).status).toBe(404);

    const second = await createRoom(alice.agent, "Doomed room");
    expect((await alice.agent.delete(`/api/rooms/${second.id}`)).status).toBe(200);
    expect((await alice.agent.get(`/api/rooms/${second.id}`)).status).toBe(404);
  });

  it("blocks member deletes and hides progress from outsiders", async () => {
    const alice = await user("mod13b");
    const bob = await user("mod13c2");
    const carol = await user("mod13a2");
    const room = await createRoom(alice.agent, "Private room");
    const invite = await createInvitation(alice.agent, room.id);
    await bob.agent.post(`/api/rooms/invitations/${invite.token}/accept`);
    expect((await bob.agent.delete(`/api/rooms/${room.id}`)).status).toBe(403);
    expect((await carol.agent.get(`/api/rooms/${room.id}/members`)).status).toBe(404);
    expect((await carol.agent.get(`/api/rooms/${room.id}/progress`)).status).toBe(404);
  });
});

describe.skipIf(!hasDb)("member progress route", () => {
  it("returns privacy-safe progress snapshots to members", async () => {
    const alice = await user("mod13pr");
    const room = await createRoom(alice.agent, "Progress room");
    const res = await alice.agent.get(`/api/rooms/${room.id}/progress`);
    expect(res.status).toBe(200);
    expect(res.body.data.progress).toHaveLength(1);
    const entry = res.body.data.progress[0];
    expect(Object.keys(entry.user).sort()).toEqual(["avatarUrl", "displayName", "id", "username"]);
    expect(entry.user.email).toBeUndefined();
    expect(entry).toMatchObject({
      role: "OWNER",
      currentStreak: expect.any(Number),
      longestStreak: expect.any(Number),
      totalSolved: expect.any(Number),
      contestsAttended: expect.any(Number),
      activeDays30: expect.any(Number),
    });
    expect(Array.isArray(entry.connectedPlatforms)).toBe(true);
  });

  it("requires a valid room id and membership", async () => {
    const alice = await user("mod13pq");
    const outsider = await user("mod13po");
    const room = await createRoom(alice.agent, "Progress guard");
    expect((await alice.agent.get("/api/rooms/not-a-uuid/progress")).status).toBe(400);
    expect((await outsider.agent.get(`/api/rooms/${room.id}/progress`)).status).toBe(404);
  });
});
