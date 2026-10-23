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
import {
  createContest,
  getContest,
  getAttempt,
  publishContest,
  regenerateContest,
  startContest,
  completeProblem,
  getResults,
} from "../src/modules/contests/service";

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

async function user(prefix = "mod15"): Promise<TestUser & { app: ReturnType<typeof createApp> }> {
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

async function createRoom(agent: TestUser["agent"], name = "Contest room") {
  const res = await agent.post("/api/rooms").send({ name });
  expect(res.status).toBe(201);
  return res.body.data.room as { id: string; name: string; myRole: string };
}

const UNKNOWN_UUID = "00000000-0000-4000-8000-000000000000";

describe.skipIf(!hasDb)("contests authentication", () => {
  it("rejects unauthenticated requests", async () => {
    const app = createApp();
    expect((await request(app).post("/api/contests").send({ name: "x" })).status).toBe(401);
    expect((await request(app).get(`/api/contests/${UNKNOWN_UUID}`)).status).toBe(401);
    expect((await request(app).post(`/api/contests/${UNKNOWN_UUID}/start`)).status).toBe(401);
  });
});

describe.skipIf(!hasDb)("contest creation and lifecycle", () => {
  it("creates a draft contest with auto-selected problems", async () => {
    const { agent, id } = await user("mod15c");
    const room = await createRoom(agent);
    const res = await agent.post("/api/contests").send({
      roomId: room.id,
      name: "Weekend Warm-up",
      difficulty: "EASY",
      topics: ["Arrays"],
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const contest = res.body.data.contest;
    expect(contest.status).toBe("DRAFT");
    expect(contest.name).toBe("Weekend Warm-up");
    expect(contest.problems).toHaveLength(3);
    const ids = new Set(contest.problems.map((p) => p.id));
    expect(ids.size).toBe(3);
    for (const p of contest.problems) {
      expect(p.platform).toBe("LEETCODE");
      expect(p.url).toMatch(/^https:\/\/leetcode\.com\//);
    }
  });

  it("hides contests from non-members", async () => {
    const { agent, id } = await user("mod15h");
    const bob = await user("mod15i");
    const room = await createRoom(agent);
    const res = await agent.post("/api/contests").send({ roomId: room.id, name: "Private" });
    expect(res.status).toBe(201);
    const contestId = res.body.data.contest.id;
    // Bob is not a member.
    expect((await bob.agent.get(`/api/contests/${contestId}`)).status).toBe(404);
    expect((await bob.agent.post(`/api/contests/${contestId}/start`)).status).toBe(404);
  });

  it("regenerates problems only for the creator on a draft", async () => {
    const { agent } = await user("mod15r");
    const room = await createRoom(agent);
    const res = await agent.post("/api/contests").send({
      roomId: room.id,
      name: "Regen",
      difficulty: "EASY",
      topics: ["Arrays"],
    });
    const contestId = res.body.data.contest.id;
    const before = res.body.data.contest.problems.map((p) => p.id).sort();
    expect(before).toHaveLength(3);

    const regen = await agent.post(`/api/contests/${contestId}/regenerate`);
    expect(regen.status).toBe(200);
    const after = regen.body.data.contest.problems.map((p) => p.id).sort();
    expect(after).toHaveLength(3);
    // Regeneration picks from the same catalog; every id is a valid UUID.
    for (const id of after) {
      expect(/^[0-9a-f-]{36}$/.test(id)).toBe(true);
    }

    const published = await agent.post(`/api/contests/${contestId}/publish`);
    expect(published.status).toBe(200);
    expect(published.body.data.contest.status).toBe("PUBLISHED");

    // Publishing again is an error.
    const again = await agent.post(`/api/contests/${contestId}/publish`);
    expect(again.status).toBe(400);

    // Regenerating a published contest is an error.
    const regenAgain = await agent.post(`/api/contests/${contestId}/regenerate`);
    expect(regenAgain.status).toBe(400);
  });

  it("non-creator cannot publish or regenerate", async () => {
    const { agent: ownerAgent } = await user("mod15o");
    const { agent: memberAgent } = await user("mod15m");
    const room = await createRoom(ownerAgent);
    // member joins the room
    const invite = await ownerAgent.post(`/api/rooms/${room.id}/invitations`).send({});
    // member accepts via token link
    await memberAgent.post(`/api/rooms/invitations/${invite.body.data.token}/accept`);

    const res = await ownerAgent.post("/api/contests").send({
      roomId: room.id,
      name: "Owned",
    });
    const contestId = res.body.data.contest.id;

    const regen = await memberAgent.post(`/api/contests/${contestId}/regenerate`);
    expect(regen.status).toBe(403);
    const pub = await memberAgent.post(`/api/contests/${contestId}/publish`);
    expect(pub.status).toBe(403);
  });

  it("start creates one attempt per participant with a 90-minute deadline", async () => {
    const { agent } = await user("mod15s");
    const room = await createRoom(agent);
    const res = await agent.post("/api/contests").send({ roomId: room.id, name: "Timed" });
    await agent.post(`/api/contests/${res.body.data.contest.id}/publish`);

    const start1 = await agent.post(`/api/contests/${res.body.data.contest.id}/start`);
    expect(start1.status).toBe(201);
    const attempt = start1.body.data.attempt;
    expect(attempt.status).toBe("IN_PROGRESS");
    expect(attempt.problems).toHaveLength(3);
    const deadline = new Date(attempt.deadlineAt!);
    const now = new Date();
    const diffMs = deadline.getTime() - now.getTime();
    expect(diffMs).toBeGreaterThan(85 * 60 * 1000);
    expect(diffMs).toBeLessThan(95 * 60 * 1000);

    // Second start returns the same attempt (idempotent / one per participant).
    const start2 = await agent.post(`/api/contests/${res.body.data.contest.id}/start`);
    expect(start2.status).toBe(201);
    expect(start2.body.data.attempt.id).toBe(attempt.id);
  });

  it("records manual problem completion and marks the attempt complete", async () => {
    const { agent } = await user("mod15p");
    const room = await createRoom(agent);
    const res = await agent.post("/api/contests").send({ roomId: room.id, name: "Complete" });
    const contestId = res.body.data.contest.id;
    await agent.post(`/api/contests/${contestId}/publish`);
    await agent.post(`/api/contests/${contestId}/start`);

    const problemId = res.body.data.contest.problems[0].id;
    const comp1 = await agent.post(
      `/api/contests/${contestId}/attempt/problems/${problemId}/complete`
    );
    expect(comp1.status).toBe(200);
    expect(comp1.body.data.attempt.problemsCompleted).toBe(1);
    expect(comp1.body.data.attempt.score).toBe(100);

    // Repeating completion is idempotent.
    const comp2 = await agent.post(
      `/api/contests/${contestId}/attempt/problems/${problemId}/complete`
    );
    expect(comp2.status).toBe(200);
    expect(comp2.body.data.attempt.problemsCompleted).toBe(1);
  });

  it("returns results with a leaderboard and room analytics", async () => {
    const { agent } = await user("mod15r2");
    const room = await createRoom(agent);
    const res = await agent.post("/api/contests").send({ roomId: room.id, name: "Results" });
    const contestId = res.body.data.contest.id;
    await agent.post(`/api/contests/${contestId}/publish`);
    await agent.post(`/api/contests/${contestId}/start`);
    for (const p of res.body.data.contest.problems) {
      await agent.post(`/api/contests/${contestId}/attempt/problems/${p.id}/complete`);
    }

    const results = await agent.get(`/api/contests/${contestId}/results`);
    expect(results.status).toBe(200);
    const data = results.body.data.results;
    expect(data.startedCount).toBe(1);
    expect(data.completedCount).toBe(1);
    expect(data.leaderboard).toHaveLength(1);
    expect(data.leaderboard[0].rank).toBe(1);
    expect(data.leaderboard[0].problemsCompleted).toBe(3);
    expect(data.leaderboard[0].score).toBe(300);
    expect(data.provisional).toBe(false);
  });
});

describe.skipIf(!hasDb)("contest service expiry (direct)", () => {
  it("marks an in-progress attempt expired when the deadline passes", async () => {
    const { agent, id } = await user("mod15e");
    const room = await createRoom(agent);
    const res = await agent.post("/api/contests").send({ roomId: room.id, name: "Expiry" });
    const contestId = res.body.data.contest.id;
    await agent.post(`/api/contests/${contestId}/publish`);

    const problemId = (await agent.get(`/api/contests/${contestId}`)).body.data.contest
      .problems[0].id;

    // Far-future now: attempt is still in progress.
    const farFuture = new Date(Date.now() + 10 * 60 * 60 * 1000);
    const attempt = await startContest(id, contestId, farFuture);
    expect(attempt.status).toBe("IN_PROGRESS");

    // Past-the-deadline now: completion is rejected and attempt expires.
    const tooLate = new Date(new Date(attempt.deadlineAt!).getTime() + 60 * 1000);
    await expect(
      completeProblem(id, contestId, problemId, tooLate)
    ).rejects.toMatchObject({ status: 400 });

    const expired = await getAttempt(id, contestId, tooLate);
    expect(expired.status).toBe("EXPIRED");
  });
});
