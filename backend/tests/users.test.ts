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

const hasDb = await databaseAvailable();
const trackedEmails: string[] = [];

afterAll(async () => {
  await cleanupUsers(trackedEmails);
  await prisma.$disconnect();
});

async function loggedInAgent() {
  const app = createApp();
  const agent = request.agent(app);
  const email = uniqueEmail("profile");
  const username = uniqueUsername("profileuser");
  trackedEmails.push(email);
  await agent.post("/api/auth/register").send({
    username,
    email,
    password: "profilepassword123",
  });
  return { agent, email, username };
}

describe.skipIf(!hasDb)("GET /api/users/me", () => {
  it("returns the safe profile for authenticated users", async () => {
    const { agent, email, username } = await loggedInAgent();
    const res = await agent.get("/api/users/me");
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(email);
    expect(res.body.data.user.username).toBe(username);
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  it("rejects unauthenticated requests with 401", async () => {
    const app = createApp();
    expect((await request(app).get("/api/users/me")).status).toBe(401);
  });
});

describe.skipIf(!hasDb)("PATCH /api/users/me", () => {
  it("updates allowed fields and returns the updated profile", async () => {
    const { agent } = await loggedInAgent();
    const res = await agent.patch("/api/users/me").send({
      displayName: "New Name",
      timezone: "Europe/Berlin",
      avatarUrl: "https://example.com/avatar.png",
    });

    expect(res.status).toBe(200);
    expect(res.body.data.user.displayName).toBe("New Name");
    expect(res.body.data.user.timezone).toBe("Europe/Berlin");
    expect(res.body.data.user.avatarUrl).toBe("https://example.com/avatar.png");

    const me = await agent.get("/api/users/me");
    expect(me.body.data.user.displayName).toBe("New Name");
  });

  it("updates the username when it is unique", async () => {
    const { agent } = await loggedInAgent();
    const next = uniqueUsername("renamed");
    const res = await agent.patch("/api/users/me").send({ username: next });
    expect(res.status).toBe(200);
    expect(res.body.data.user.username).toBe(next);
  });

  it("rejects duplicate usernames with 409", async () => {
    const first = await loggedInAgent();
    const second = await loggedInAgent();

    const res = await second.agent
      .patch("/api/users/me")
      .send({ username: first.username });
    expect(res.status).toBe(409);

    // The second user is unchanged.
    const me = await second.agent.get("/api/users/me");
    expect(me.body.data.user.username).toBe(second.username);
  });

  it("rejects protected and unknown fields with 400", async () => {
    const { agent } = await loggedInAgent();
    for (const body of [
      { email: "new@example.com" },
      { passwordHash: "x" },
      { id: "some-id" },
      { password: "newpassword1234" },
      { role: "admin" },
      {},
    ]) {
      const res = await agent.patch("/api/users/me").send(body);
      expect(res.status).toBe(400);
    }
  });

  it("rejects invalid values with 400", async () => {
    const { agent } = await loggedInAgent();
    for (const body of [
      { username: "x" },
      { username: "has space" },
      { timezone: "Not/AZone" },
      { avatarUrl: "not-a-url" },
    ]) {
      const res = await agent.patch("/api/users/me").send(body);
      expect(res.status).toBe(400);
    }
  });

  it("rejects unauthenticated updates with 401", async () => {
    const app = createApp();
    expect(
      (await request(app).patch("/api/users/me").send({ displayName: "x" })).status
    ).toBe(401);
  });

  it("one user cannot read or change another user's profile", async () => {
    const alice = await loggedInAgent();
    const bob = await loggedInAgent();

    // There is no by-id endpoint: the only profile surface is /me.
    const hacked = await alice.agent
      .patch("/api/users/me")
      .send({ username: bob.username });
    expect(hacked.status).toBe(409);

    const bobMe = await bob.agent.get("/api/users/me");
    expect(bobMe.body.data.user.username).toBe(bob.username);

    const aliceMe = await alice.agent.get("/api/users/me");
    expect(aliceMe.body.data.user.email).toBe(alice.email);
  });
});
