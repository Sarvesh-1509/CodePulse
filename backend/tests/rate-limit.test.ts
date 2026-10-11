import { afterAll, describe, expect, it } from "vitest";
import express, { type RequestHandler } from "express";
import request from "supertest";
import { prisma } from "../src/db/prisma";
import { createApp } from "../src/app";
import {
  createConnectLimiter,
  createInvitationLimiter,
  createInvitationValidateLimiter,
  createReadLimiter,
  createSyncLimiter,
} from "../src/modules/auth/rateLimit";
import { databaseAvailable, cleanupUsers, uniqueEmail } from "./db";

const hasDb = await databaseAvailable();
const trackedEmails: string[] = [];

afterAll(async () => {
  await cleanupUsers(trackedEmails);
  await prisma.$disconnect();
});

/**
 * Mount a single limiter factory on a throwaway route. The limits under
 * test are too high to trip honestly through the real routes within one
 * test (30 connects would need 30 bcrypt registrations), so these cases
 * assert the configured behavior of each factory: the trip point, the
 * 429 response shape, and counter isolation between instances. Route
 * wiring (which limiter guards which endpoint) is asserted in the
 * module suites via 429-sensitive paths and documented in the README.
 */
function limitedApp(limiter: RequestHandler) {
  const app = express();
  app.use("/t", limiter, (_req, res) => res.status(200).json({ success: true }));
  return app;
}

async function hitLimit(app: ReturnType<typeof limitedApp>, times: number) {
  let lastStatus = 0;
  for (let i = 0; i < times; i += 1) {
    const res = await request(app).get("/t");
    lastStatus = res.status;
    if (lastStatus !== 200) return { trippedAt: i + 1, res };
  }
  return { trippedAt: -1, res: null };
}

describe.skipIf(!hasDb)("login rate limiting", () => {
  it("returns 429 after too many login attempts", async () => {
    // Fresh app = fresh limiter counters, isolated from other test files.
    const app = createApp();
    const attempt = () =>
      request(app)
        .post("/api/auth/login")
        .send({ email: uniqueEmail("ratelimit"), password: "wrongpassword1234" });

    // Limit is 10 per 10 minutes; unknown accounts fail fast (no bcrypt cost).
    for (let i = 0; i < 10; i++) {
      const res = await attempt();
      expect(res.status).toBe(401);
    }

    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(limited.body.success).toBe(false);
  });
});

describe.skipIf(!hasDb)("registration rate limiting", () => {
  // 21 bcrypt-12 hashes need wall-clock time; the timeout is explicit and
  // bounded rather than global.
  it("returns 429 after 20 registrations in an hour", { timeout: 120_000 }, async () => {
    const app = createApp();
    for (let i = 0; i < 20; i += 1) {
      const email = uniqueEmail("ratelimitreg");
      trackedEmails.push(email);
      const res = await request(app).post("/api/auth/register").send({
        username: `rluser${Date.now().toString(36)}${i}`,
        email,
        password: "validpassword123",
      });
      expect(res.status).toBe(201);
    }
    const limited = await request(app).post("/api/auth/register").send({
      username: `rluser${Date.now().toString(36)}x`,
      email: uniqueEmail("ratelimitreg"),
      password: "validpassword123",
    });
    expect(limited.status).toBe(429);
    expect(limited.body.success).toBe(false);
    expect(limited.body.message).toMatch(/registration/i);
  });
});

describe("limiter factories", () => {
  it("trips the connect limiter on the 31st request with a safe shape", async () => {
    const app = limitedApp(createConnectLimiter());
    const { trippedAt, res } = await hitLimit(app, 31);
    expect(trippedAt).toBe(31);
    expect(res?.body).toMatchObject({ success: false });
    expect(String(res?.body.message)).toMatch(/connection/i);
  });

  it("trips the sync limiter on the 21st request", async () => {
    const app = limitedApp(createSyncLimiter());
    const { trippedAt } = await hitLimit(app, 21);
    expect(trippedAt).toBe(21);
  });

  it("trips invitation creation on the 21st and validation on the 61st request", async () => {
    const create = await hitLimit(limitedApp(createInvitationLimiter()), 21);
    expect(create.trippedAt).toBe(21);
    const validate = await hitLimit(limitedApp(createInvitationValidateLimiter()), 61);
    expect(validate.trippedAt).toBe(61);
  });

  it("trips the public leaderboard read limiter on the 301st request", async () => {
    const app = limitedApp(createReadLimiter());
    const { trippedAt, res } = await hitLimit(app, 301);
    expect(trippedAt).toBe(301);
    expect(res?.body.success).toBe(false);
  });

  it("keeps counters isolated per instance (the documented reset semantics)", async () => {
    // Limiters are created fresh per application: exhausting one instance
    // must not affect another, which is also how counters reset on restart.
    const exhausted = limitedApp(createSyncLimiter());
    const fresh = limitedApp(createSyncLimiter());
    const { trippedAt } = await hitLimit(exhausted, 21);
    expect(trippedAt).toBe(21);
    const res = await request(fresh).get("/t");
    expect(res.status).toBe(200);
  });
});
