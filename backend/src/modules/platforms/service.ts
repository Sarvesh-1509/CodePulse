import { Prisma, type LinkedAccount, type PlatformStats } from "@prisma/client";
import type {
  LinkedAccountDto,
  PlatformId,
  PlatformStatsDto,
} from "@codepulse/shared";
import { assertDatabaseConfigured, prisma } from "../../db/prisma";
import { conflict, HttpError } from "../../utils/httpError";
import {
  PlatformError,
  type PlatformErrorKind,
} from "./errors";
import type {
  FetchOptions,
  PlatformAdapter,
  SyncBundle,
} from "./adapters";
import { isPlatformAvailable, normalizePlatformUsername } from "./registry";
import { createCodeforcesAdapter } from "../codeforces/service";
import { createLeetCodeAdapter } from "../leetcode/service";
import { createCodechefAdapter } from "../codechef/service";
import { createGeeksforgeeksAdapter } from "../geeksforgeeks/service";
import { createHackerrankAdapter } from "../hackerrank/service";
import { env } from "../../config/env";

/**
 * Platform account orchestration (Module 3).
 *
 * Owns ALL database access for linked accounts. Adapters only fetch;
 * every write below runs in a short transaction after the network calls
 * complete. Deletion policy: disconnecting deletes the LinkedAccount row
 * and cascades to PlatformStats, ActivityEvents, and ContestResults —
 * imported data is a derived cache of the connection, so it goes with it.
 * The CodePulse user is never touched.
 */

export type AdapterMap = Partial<Record<PlatformId, PlatformAdapter>>;

export function createDefaultAdapters(): AdapterMap {
  return {
    CODEFORCES: createCodeforcesAdapter({ timeoutMs: env.CODEFORCES_TIMEOUT_MS }),
    LEETCODE: createLeetCodeAdapter({ timeoutMs: env.LEETCODE_TIMEOUT_MS }),
    CODECHEF: createCodechefAdapter({ timeoutMs: env.CODECHEF_TIMEOUT_MS }),
    GEEKSFORGEEKS: createGeeksforgeeksAdapter({ timeoutMs: env.GEEKSFORGEEKS_TIMEOUT_MS }),
    HACKERRANK: createHackerrankAdapter({ timeoutMs: env.HACKERRANK_TIMEOUT_MS }),
  };
}

// --- Serialization (Prisma Decimal -> JSON-safe numbers) ---

function toStatsDto(stats: PlatformStats | null): PlatformStatsDto | null {
  if (!stats) return null;
  return {
    totalSolved: stats.totalSolved,
    contestRating: stats.contestRating ? stats.contestRating.toNumber() : null,
    contestsAttended: stats.contestsAttended,
    currentStreak: stats.currentStreak,
    longestStreak: stats.longestStreak,
    additional:
      stats.additionalStats !== null &&
      typeof stats.additionalStats === "object" &&
      !Array.isArray(stats.additionalStats)
        ? (stats.additionalStats as Record<string, unknown>)
        : {},
    fetchedAt: stats.fetchedAt ? stats.fetchedAt.toISOString() : null,
  };
}

type AccountWithStats = LinkedAccount & { stats: PlatformStats | null };

export function toAccountDto(account: AccountWithStats): LinkedAccountDto {
  return {
    platform: account.platform as PlatformId,
    platformUsername: account.platformUsername,
    connectionStatus: account.connectionStatus,
    lastSyncedAt: account.lastSyncedAt ? account.lastSyncedAt.toISOString() : null,
    lastSyncError: account.lastSyncError,
    stale: account.connectionStatus === "ERROR",
    stats: toStatsDto(account.stats),
  };
}

// --- Error mapping (sanitized, no upstream internals reach clients) ---

const PLATFORM_ERROR_STATUS: Record<PlatformErrorKind, number> = {
  "invalid-username": 400,
  "not-found": 400,
  "rate-limited": 429,
  timeout: 502,
  network: 502,
  upstream: 502,
  unsupported: 400,
  "invalid-response": 502,
};

function toHttpError(err: unknown, fallback: string): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof PlatformError) {
    // All PlatformError messages are hand-written safe strings (no
    // payloads, stacks, or secrets), so they can go to clients directly.
    return new HttpError(PLATFORM_ERROR_STATUS[err.kind], err.message);
  }
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    return conflict(
      "This platform account is already linked. Disconnect it first to replace it."
    );
  }
  return new HttpError(502, fallback);
}

const PLATFORM_DISPLAY_NAMES: Record<PlatformId, string> = {
  CODEFORCES: "Codeforces",
  LEETCODE: "LeetCode",
  CODECHEF: "CodeChef",
  GEEKSFORGEEKS: "GeeksforGeeks",
  HACKERRANK: "HackerRank",
};

export function platformDisplayName(platform: PlatformId): string {
  return PLATFORM_DISPLAY_NAMES[platform];
}

function requireAdapter(
  adapters: AdapterMap,
  platform: PlatformId
): PlatformAdapter {
  if (!isPlatformAvailable(platform)) {
    throw new HttpError(
      400,
      `${platformDisplayName(platform)} integration is not available yet.`
    );
  }
  const adapter = adapters[platform];
  if (!adapter) {
    throw new HttpError(502, "Platform integration is temporarily unavailable.");
  }
  return adapter;
}

// --- Reads ---

export async function listLinkedAccounts(
  userId: string
): Promise<LinkedAccountDto[]> {
  assertDatabaseConfigured();
  const accounts = await prisma.linkedAccount.findMany({
    where: { userId },
    include: { stats: true },
    orderBy: { createdAt: "asc" },
  });
  return accounts.map(toAccountDto);
}

// --- Shared persistence (short transaction, only after fetch completes) ---

/** Insert batch size so large calendar backfills stay in safe transactions. */
const PERSIST_CHUNK_SIZE = 1000;

type Txn = Prisma.TransactionClient;

/**
 * Resolve the solved-problem total as the union of already-stored keys and
 * newly fetched keys. Used ONLY for incremental refreshes (Codeforces with
 * a known sinceId): those fetch a window, and a total recomputed from the
 * window alone would shrink the known count. Full fetches and authoritative
 * aggregate bundles (LeetCode, GFG) keep the bundle value untouched.
 */
async function resolveTotalSolved(
  db: Pick<Txn, "activityEvent">,
  linkedAccountId: string,
  bundle: SyncBundle
): Promise<number | null> {
  const windowKeys = new Set<string>();
  for (const a of bundle.activities) {
    if (a.type === "PROBLEM_SOLVED" && a.problemId) windowKeys.add(a.problemId);
  }
  // Fast path: no submission-derived data in this bundle — keep the value.
  if (windowKeys.size === 0) return bundle.stats.totalSolved;
  const stored = await db.activityEvent.findMany({
    where: {
      linkedAccountId,
      activityType: "PROBLEM_SOLVED",
      problemIdentifier: { not: null },
    },
    select: { problemIdentifier: true },
  });
  for (const row of stored) {
    if (row.problemIdentifier) windowKeys.add(row.problemIdentifier);
  }
  return windowKeys.size;
}

async function persistBundle(
  tx: Txn,
  userId: string,
  linkedAccountId: string,
  platform: PlatformId,
  bundle: SyncBundle
): Promise<void> {
  await tx.platformStats.upsert({
    where: { linkedAccountId },
    create: {
      linkedAccountId,
      totalSolved: bundle.stats.totalSolved,
      contestRating: bundle.stats.contestRating,
      contestsAttended: bundle.stats.contestsAttended,
      currentStreak: bundle.stats.currentStreak,
      longestStreak: bundle.stats.longestStreak,
      additionalStats: bundle.stats.extra as Prisma.InputJsonValue,
      fetchedAt: new Date(),
    },
    update: {
      // Null incoming stats mean "unknown", never "zero" or "wiped": keep
      // the last known good value when a drifted response omits a metric
      // the platform previously reported (e.g. a LeetCode sync whose stats
      // selection came back empty must not erase the stored solved total).
      ...(bundle.stats.totalSolved != null ? { totalSolved: bundle.stats.totalSolved } : {}),
      ...(bundle.stats.contestRating != null ? { contestRating: bundle.stats.contestRating } : {}),
      ...(bundle.stats.contestsAttended != null
        ? { contestsAttended: bundle.stats.contestsAttended }
        : {}),
      ...(bundle.stats.currentStreak != null ? { currentStreak: bundle.stats.currentStreak } : {}),
      ...(bundle.stats.longestStreak != null ? { longestStreak: bundle.stats.longestStreak } : {}),
      additionalStats: bundle.stats.extra as Prisma.InputJsonValue,
      fetchedAt: new Date(),
    },
  });

  // Chunked inserts: calendar backfills can carry thousands of rows and
  // one giant createMany risks oversized transactions. Chunks share the
  // same idempotency (skipDuplicates on stable external ids).
  for (let i = 0; i < bundle.activities.length; i += PERSIST_CHUNK_SIZE) {
    await tx.activityEvent.createMany({
      data: bundle.activities.slice(i, i + PERSIST_CHUNK_SIZE).map((a) => ({
        userId,
        linkedAccountId,
        platform,
        externalActivityId: a.externalId,
        activityType: a.type,
        problemIdentifier: a.problemId,
        difficulty: a.difficulty,
        occurredAt: a.occurredAt,
      })),
      skipDuplicates: true,
    });
  }

  if (bundle.contests.length > 0) {
    await tx.contestResult.createMany({
      data: bundle.contests.map((c) => ({
        linkedAccountId,
        platform,
        externalContestId: c.externalId,
        contestName: c.name,
        contestedAt: c.contestedAt,
        ratingBefore: c.ratingBefore,
        ratingChange: c.ratingChange,
        ratingAfter: c.ratingAfter,
        rank: c.rank,
      })),
      skipDuplicates: true,
    });
  }

  // Day-level aggregates (currently LeetCode calendar only). Upserts keyed
  // by (account, platform, date) make repeat imports idempotent: counts are
  // overwritten with the latest verified value, never summed.
  const daily = bundle.dailyActivity;
  if (daily && daily.days.length > 0) {
    for (let i = 0; i < daily.days.length; i += PERSIST_CHUNK_SIZE) {
      await Promise.all(
        daily.days.slice(i, i + PERSIST_CHUNK_SIZE).map((d) =>
          tx.dailyActivity.upsert({
            where: {
              linkedAccountId_platform_date: {
                linkedAccountId,
                platform,
                date: d.date,
              },
            },
            create: {
              userId,
              linkedAccountId,
              platform,
              date: d.date,
              submissions: d.submissions,
              source: `${platform}_CALENDAR`,
              syncedAt: new Date(),
            },
            update: {
              submissions: d.submissions,
              source: `${platform}_CALENDAR`,
              syncedAt: new Date(),
            },
          })
        )
      );
    }
  }

  // Superseded per-submission expansions: for each UTC day in this
  // import, the legacy one-row-per-submission SUBMISSION events (if any)
  // are removed because the day aggregate above now represents them —
  // keeping both would double-count the day. Their information (day +
  // count) is fully preserved above, PROBLEM_SOLVED and contest rows are
  // untouched, and the delete runs in the same transaction as the upserts.
  // Deletion is strictly per imported day: SUBMISSION rows for days this
  // import does not vouch for (e.g. filtered by the client's date guards,
  // or vanished upstream) are preserved, never wiped. A failed import
  // erases nothing because persist never runs for it.
  if (daily?.complete && daily.days.length > 0) {
    const dayBounds = daily.days.map((d) => {
      const start = new Date(d.date);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + 86_400_000);
      return { occurredAt: { gte: start, lt: end } };
    });
    await tx.activityEvent.deleteMany({
      where: {
        linkedAccountId,
        platform,
        activityType: "SUBMISSION",
        OR: dayBounds,
      },
    });
  }
}

async function loadAccountDto(linkedAccountId: string): Promise<LinkedAccountDto> {
  const full = await prisma.linkedAccount.findUniqueOrThrow({
    where: { id: linkedAccountId },
    include: { stats: true },
  });
  return toAccountDto(full);
}

// --- Connect ---

export interface ConnectResult {
  account: LinkedAccountDto;
  truncated: boolean;
}

export async function connectAccount(
  userId: string,
  platform: PlatformId,
  rawUsername: string,
  adapters: AdapterMap = createDefaultAdapters()
): Promise<ConnectResult> {
  assertDatabaseConfigured();
  const adapter = requireAdapter(adapters, platform);
  const username = normalizePlatformUsername(platform, rawUsername);

  const existing = await prisma.linkedAccount.findUnique({
    where: { userId_platform: { userId, platform } },
  });
  if (existing) {
    throw conflict(
      `A ${platformDisplayName(platform)} account is already linked. Disconnect it first to connect a different username.`
    );
  }

  // Verify against the real platform BEFORE creating any row: a failed
  // lookup must never leave a falsely verified connection behind.
  let bundle: SyncBundle;
  try {
    bundle = await adapter.fetchAll(username);
  } catch (err) {
    throw toHttpError(err, "Could not verify the platform account. Please try again later.");
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const account = await tx.linkedAccount.create({
        data: {
          userId,
          platform,
          platformUsername: bundle.canonicalUsername,
          connectionStatus: "CONNECTED",
          lastSyncedAt: new Date(),
          lastSyncError: null,
        },
      });
      await persistBundle(tx, userId, account.id, platform, bundle);
      return account;
    });
    return {
      account: await loadAccountDto(created.id),
      truncated: bundle.stats.truncated ?? false,
    };
  } catch (err) {
    // Includes the P2002 race path: two concurrent connects, one wins.
    throw toHttpError(err, "Could not save the platform account. Please try again later.");
  }
}

// --- Disconnect ---

export async function disconnectAccount(
  userId: string,
  platform: PlatformId
): Promise<{ platform: PlatformId; platformUsername: string }> {
  assertDatabaseConfigured();
  const existing = await prisma.linkedAccount.findUnique({
    where: { userId_platform: { userId, platform } },
  });
  if (!existing) {
    throw new HttpError(404, "No linked account found for this platform.");
  }
  // Ownership is structural (userId in the key): another user's rows are
  // unreachable by construction. Cascade removes stats, activities, contests.
  await prisma.linkedAccount.delete({ where: { id: existing.id } });
  return { platform, platformUsername: existing.platformUsername };
}

// --- Sync ---

/**
 * Single-instance guard against concurrent syncs of the same account.
 * A second request while one is in flight gets 409 (never a second fetch).
 */
const syncLocks = new Set<string>();

export interface SyncResult {
  account: LinkedAccountDto;
  truncated: boolean;
}

/** Highest numeric upstream id already imported (Codeforces `cf-<id>`). */
async function getMaxKnownSubmissionId(
  linkedAccountId: string
): Promise<number | undefined> {
  const rows = await prisma.activityEvent.findMany({
    where: { linkedAccountId, externalActivityId: { startsWith: "cf-" } },
    select: { externalActivityId: true },
  });
  let max: number | undefined;
  for (const row of rows) {
    const id = Number((row.externalActivityId ?? "").slice(3));
    if (Number.isInteger(id) && (max === undefined || id > max)) max = id;
  }
  return max;
}

const MAX_SYNC_ERROR_LENGTH = 300;

function sanitizeSyncError(err: unknown): string {
  if (err instanceof PlatformError) return err.message.slice(0, MAX_SYNC_ERROR_LENGTH);
  if (err instanceof HttpError) return err.message.slice(0, MAX_SYNC_ERROR_LENGTH);
  return "Synchronization failed. Please try again later.";
}

export async function syncAccount(
  userId: string,
  platform: PlatformId,
  adapters: AdapterMap = createDefaultAdapters()
): Promise<SyncResult> {
  assertDatabaseConfigured();
  const adapter = requireAdapter(adapters, platform);

  const account = await prisma.linkedAccount.findUnique({
    where: { userId_platform: { userId, platform } },
  });
  if (!account) {
    throw new HttpError(404, "No linked account found for this platform.");
  }

  if (syncLocks.has(account.id)) {
    throw conflict("A synchronization is already in progress for this account.");
  }
  syncLocks.add(account.id);
  try {
    await prisma.linkedAccount.update({
      where: { id: account.id },
      data: { connectionStatus: "SYNCING" },
    });

    const sinceId =
      platform === "CODEFORCES"
        ? await getMaxKnownSubmissionId(account.id)
        : undefined;
    const fetchOptions: FetchOptions =
      platform === "CODEFORCES" ? { sinceId } : {};

    let bundle: SyncBundle;
    try {
      bundle = await adapter.fetchAll(account.platformUsername, fetchOptions);
    } catch (err) {
      // Failed refresh: preserve stats + lastSyncedAt, record sanitized error.
      await prisma.linkedAccount.update({
        where: { id: account.id },
        data: { connectionStatus: "ERROR", lastSyncError: sanitizeSyncError(err) },
      });
      throw toHttpError(err, "Synchronization failed. Previous data is preserved.");
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Incremental refreshes fetch only new submissions, so a total
      // recomputed from the window alone would shrink the known count.
      // Union with stored keys instead; full fetches keep the bundle value.
      if (sinceId !== undefined) {
        bundle.stats.totalSolved = await resolveTotalSolved(tx, account.id, bundle);
      }
      await persistBundle(tx, userId, account.id, platform, bundle);
      return tx.linkedAccount.update({
        where: { id: account.id },
        data: {
          platformUsername: bundle.canonicalUsername,
          connectionStatus: "CONNECTED",
          lastSyncedAt: new Date(),
          lastSyncError: null,
        },
        include: { stats: true },
      });
    });

    return {
      account: toAccountDto(updated),
      truncated: bundle.stats.truncated ?? false,
    };
  } finally {
    syncLocks.delete(account.id);
  }
}
