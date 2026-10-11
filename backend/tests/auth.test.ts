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

function track(email: string): string {
  trackedEmails.push(email);
  return email;
}

describe.skipIf(!hasDb)("POST /api/auth/register", () => {
  it("registers a user, hashes the password, sets a session cookie", async () => {
    const app = createApp();
    const email = track(uniqueEmail());
    const username = uniqueUsername();

    const res = await request(app).post("/api/auth/register").send({
      username,
      email,
      password: "validpassword123",
      displayName: "Test User",
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.username).toBe(username);
    expect(res.body.data.user.email).toBe(email);
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("validpassword123");

    const setCookie = res.headers["set-cookie"] as unknown as string[];
    expect(setCookie.join(";")).toMatch(/codepulse_session=.+;.+HttpOnly/i);

    const stored = await prisma.user.findUnique({ where: { email } });
    expect(stored).not.toBeNull();
    expect(stored!.passwordHash).not.toContain("validpassword123");
  });

  it("normalizes email casing on registration", async () => {
    const app = createApp();
    // Track the normalized (lowercase) form: that is what the service stores,
    // so afterAll cleanup actually removes this row.
    const email = track(uniqueEmail().toLowerCase());
    const sentEmail = email.toUpperCase();

    const res = await request(app).post("/api/auth/register").send({
      username: uniqueUsername(),
      email: sentEmail,
      password: "validpassword123",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe(email);
  });

  it("rejects duplicate emails and usernames", async () => {
    const app = createApp();
    const email = track(uniqueEmail());
    const username = uniqueUsername();
    const body = { username, email, password: "validpassword123" };

    expect((await request(app).post("/api/auth/register").send(body)).status).toBe(201);

    const dupEmail = await request(app)
      .post("/api/auth/register")
      .send({ username: uniqueUsername(), email, password: "validpassword123" });
    expect(dupEmail.status).toBe(409);

    const dupUsername = await request(app)
      .post("/api/auth/register")
      .send({ username, email: uniqueEmail(), password: "validpassword123" });
    expect(dupUsername.status).toBe(409);
  });

  it("rejects invalid email, short password, bad username, malformed input", async () => {
    const app = createApp();
    const cases = [
      { username: uniqueUsername(), email: "not-an-email", password: "validpassword123" },
      { username: uniqueUsername(), email: uniqueEmail(), password: "short" },
      { username: "ab", email: uniqueEmail(), password: "validpassword123" },
      { username: "bad name!", email: uniqueEmail(), password: "validpassword123" },
      { username: uniqueUsername(), email: uniqueEmail() }, // missing password
      { username: uniqueUsername(), email: uniqueEmail(), password: "validpassword123", admin: true }, // strict: unknown field
    ];
    for (const body of cases) {
      const res = await request(app).post("/api/auth/register").send(body);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    }
  });
});

describe.skipIf(!hasDb)("POST /api/auth/login + session", () => {
  it("logs in with valid credentials and returns a safe profile", async () => {
    const app = createApp();
    const email = track(uniqueEmail());
    const password = "correctpassword123";
    await request(app)
      .post("/api/auth/register")
      .send({ username: uniqueUsername(), email, password });

    const agent = request.agent(app);
    const res = await agent.post("/api/auth/login").send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(email);
    expect(res.body.data.user.passwordHash).toBeUndefined();

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(email);
  });

  it("accepts email in any casing at login", async () => {
    const app = createApp();
    const email = track(uniqueEmail());
    await request(app)
      .post("/api/auth/register")
      .send({ username: uniqueUsername(), email, password: "correctpassword123" });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: email.toUpperCase(), password: "correctpassword123" });
    expect(res.status).toBe(200);
  });

  it("returns a generic error for wrong passwords and unknown accounts", async () => {
    const app = createApp();
    const email = track(uniqueEmail());
    await request(app)
      .post("/api/auth/register")
      .send({ username: uniqueUsername(), email, password: "correctpassword123" });

    const wrong = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "wrongpassword1234" });
    const unknown = await request(app)
      .post("/api/auth/login")
      .send({ email: uniqueEmail(), password: "wrongpassword1234" });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toBe(unknown.body.message);
    expect(JSON.stringify(wrong.body)).not.toContain("passwordHash");
  });

  it("rejects unauthenticated /me with 401 and tampered cookies", async () => {
    const app = createApp();
    expect((await request(app).get("/api/auth/me")).status).toBe(401);

    const tampered = await request(app)
      .get("/api/auth/me")
      .set("Cookie", "codepulse_session=this.is.not.a.valid.token");
    expect(tampered.status).toBe(401);
  });

  it("logs out: clears the cookie and the session stops working", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const email = track(uniqueEmail());
    await agent.post("/api/auth/register").send({
      username: uniqueUsername(),
      email,
      password: "correctpassword123",
    });

    expect((await agent.get("/api/auth/me")).status).toBe(200);

    const logout = await agent.post("/api/auth/logout");
    expect(logout.status).toBe(200);
    expect(logout.body.success).toBe(true);
    const cleared = (logout.headers["set-cookie"] as unknown as string[]).join(";");
    expect(cleared).toMatch(/codepulse_session=/);

    expect((await agent.get("/api/auth/me")).status).toBe(401);
  });
});
