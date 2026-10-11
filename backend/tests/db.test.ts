import { afterAll, describe, expect, it } from "vitest";
import { HttpError } from "../src/utils/httpError";
import { assertDatabaseConfigured, prisma } from "../src/db/prisma";
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

describe("database configuration guard", () => {
  it("fails clearly (503, actionable message) when DATABASE_URL is missing", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(() => assertDatabaseConfigured()).toThrow(HttpError);
      try {
        assertDatabaseConfigured();
      } catch (err) {
        expect((err as HttpError).status).toBe(503);
        expect((err as Error).message).toMatch(/DATABASE_URL/);
      }

      const { registerUser } = await import("../src/modules/auth/service");
      await expect(
        registerUser({
          username: "nodbuser",
          email: "nodb@example.com",
          password: "validpassword123",
        })
      ).rejects.toMatchObject({ status: 503 });
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
  });
});

describe.skipIf(!hasDb)("database (Prisma + PostgreSQL)", () => {
  it("connects to PostgreSQL", async () => {
    const rows = await prisma.$queryRaw<{ one: number }[]>`SELECT 1 AS one`;
    expect(rows[0].one).toBe(1);
  });

  it("enforces unique usernames and emails", async () => {
    const email = uniqueEmail();
    const username = uniqueUsername();
    trackedEmails.push(email);

    await prisma.user.create({
      data: { username, email, passwordHash: "hash" },
    });

    await expect(
      prisma.user.create({
        data: { username: uniqueUsername(), email, passwordHash: "hash" },
      })
    ).rejects.toMatchObject({ code: "P2002" });

    await expect(
      prisma.user.create({
        data: { username, email: uniqueEmail(), passwordHash: "hash" },
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("enforces one linked account per platform per user", async () => {
    const email = uniqueEmail();
    trackedEmails.push(email);
    const user = await prisma.user.create({
      data: { username: uniqueUsername(), email, passwordHash: "hash" },
    });

    await prisma.linkedAccount.create({
      data: { userId: user.id, platform: "LEETCODE", platformUsername: "lc1" },
    });

    await expect(
      prisma.linkedAccount.create({
        data: { userId: user.id, platform: "LEETCODE", platformUsername: "lc2" },
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("keeps unavailable platform metrics as NULL (not zero)", async () => {
    const email = uniqueEmail();
    trackedEmails.push(email);
    const user = await prisma.user.create({
      data: { username: uniqueUsername(), email, passwordHash: "hash" },
    });
    const account = await prisma.linkedAccount.create({
      data: { userId: user.id, platform: "CODEFORCES", platformUsername: "cf1" },
    });
    const stats = await prisma.platformStats.create({
      data: { linkedAccountId: account.id },
    });

    expect(stats.totalSolved).toBeNull();
    expect(stats.contestRating).toBeNull();
    expect(stats.currentStreak).toBeNull();
  });

  it("cascades deletes so no orphaned rows remain", async () => {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: { username: uniqueUsername(), email, passwordHash: "hash" },
    });
    const account = await prisma.linkedAccount.create({
      data: { userId: user.id, platform: "CODECHEF", platformUsername: "cc1" },
    });
    await prisma.platformStats.create({
      data: { linkedAccountId: account.id, totalSolved: 42 },
    });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.linkedAccount.findUnique({ where: { id: account.id } })).toBeNull();
    expect(
      await prisma.platformStats.findFirst({ where: { linkedAccountId: account.id } })
    ).toBeNull();
  });

  it("reports database health without credentials", async () => {
    const { checkDatabase } = await import("../src/db/prisma");
    const status = await checkDatabase();
    expect(status.database).toBe("connected");
    expect(JSON.stringify(status)).not.toMatch(/codepulse_dev_pw|postgres/i);
  });
});
