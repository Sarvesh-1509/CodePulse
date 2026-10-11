import type {
  ActivityCoverageDto,
  ActivityDayDto,
  ActivityTotalsDto,
  ActivityTypeDto,
  PlatformCoverageDto,
  PlatformId,
  RecentActivityItemDto,
  StreakDto,
} from "@codepulse/shared";
import { assertDatabaseConfigured, prisma } from "../../db/prisma";
import { buildDayBuckets, computeStreaks, shiftDayKey, toDayKey } from "../../utils/streaks";
import { fetchUnifiedActivity, type UnifiedEventRow } from "../../utils/activity";

/**
 * Unified activity reads (Module 9).
 *
 * All rows here were verified at import time by platform adapters; only
 * verified events are ever stored, so every row below counts as qualifying
 * activity. Nothing is invented: gaps mean "no stored events", and the
 * separate coverage payload tells callers whether history is complete,
 * partial, unavailable, or errored.
 */

// Platforms whose adapters import reliably dated activity events.
const ACTIVITY_PLATFORMS: ReadonlySet<string> = new Set(["CODEFORCES", "LEETCODE"]);

function platformName(platform: PlatformId): string {
  switch (platform) {
    case "CODEFORCES": return "Codeforces";
    case "LEETCODE": return "LeetCode";
    case "CODECHEF": return "CodeChef";
    case "GEEKSFORGEEKS": return "GeeksforGeeks";
    case "HACKERRANK": return "HackerRank";
  }
}

export function resolveTimezone(explicit: string | undefined, stored: string | undefined): string {
  if (explicit) return explicit;
  if (stored) return stored;
  return "UTC";
}

interface AccountCoverageRow {
  platform: PlatformId;
  platformUsername: string;
  connectionStatus: string;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
  truncated: boolean;
  eventCount: number;
  earliestEventAt: Date | null;
  latestEventAt: Date | null;
  calendarDays: number;
  calendarFrom: Date | null;
  calendarTo: Date | null;
}

async function accountCoverageRows(userId: string): Promise<AccountCoverageRow[]> {
  const accounts = await prisma.linkedAccount.findMany({
    where: { userId },
    include: { stats: true },
    orderBy: { createdAt: "asc" },
  });
  const rows: AccountCoverageRow[] = [];
  for (const account of accounts) {
    const agg = await prisma.activityEvent.aggregate({
      where: { linkedAccountId: account.id },
      _count: { _all: true },
      _min: { occurredAt: true },
      _max: { occurredAt: true },
    });
    const extra = account.stats?.additionalStats;
    const truncated =
      typeof extra === "object" && extra !== null && !Array.isArray(extra)
        ? (extra as Record<string, unknown>).truncated === true
        : false;
    const calendar = await prisma.dailyActivity.aggregate({
      where: { linkedAccountId: account.id },
      _count: { _all: true },
      _min: { date: true },
      _max: { date: true },
    });
    rows.push({
      platform: account.platform as PlatformId,
      platformUsername: account.platformUsername,
      connectionStatus: account.connectionStatus,
      lastSyncedAt: account.lastSyncedAt,
      lastSyncError: account.lastSyncError,
      truncated,
      eventCount: agg._count._all,
      earliestEventAt: agg._min.occurredAt,
      latestEventAt: agg._max.occurredAt,
      calendarDays: calendar._count._all,
      calendarFrom: calendar._min.date,
      calendarTo: calendar._max.date,
    });
  }
  return rows;
}

export function toPlatformCoverage(row: AccountCoverageRow): PlatformCoverageDto {
  const name = platformName(row.platform);
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const calendarRange =
    row.calendarDays > 0 && row.calendarFrom && row.calendarTo
      ? ` Calendar covers ${iso(row.calendarFrom)!.slice(0, 10)} to ${iso(row.calendarTo)!.slice(0, 10)} (${row.calendarDays} active days).`
      : "";
  const base = {
    platform: row.platform,
    connected: true,
    status: row.connectionStatus,
    lastSyncedAt: iso(row.lastSyncedAt),
    hasSyncError: row.connectionStatus === "ERROR",
    eventCount: row.eventCount,
    earliestEventAt: iso(row.earliestEventAt),
    latestEventAt: iso(row.latestEventAt),
    calendarDays: row.calendarDays,
    calendarFrom: iso(row.calendarFrom),
    calendarTo: iso(row.calendarTo),
  };
  if (row.connectionStatus === "ERROR") {
    return { ...base, history: "error", historyNote: `${name} sync failed; showing last synced data.` };
  }
  if (!ACTIVITY_PLATFORMS.has(row.platform)) {
    return { ...base, history: "unavailable", historyNote: `${name} does not expose dated activity.` };
  }
  if (row.lastSyncedAt === null && row.eventCount === 0) {
    return { ...base, history: "never-synced", historyNote: `${name} has not been synced yet.` };
  }
  if (row.eventCount === 0) {
    return { ...base, history: "empty", historyNote: `No ${name} activity found in the covered window.` };
  }
  if (row.platform === "LEETCODE") {
    return { ...base, history: "partial", historyNote: `${name} per-problem history covers a recent window; daily activity comes from the full submission calendar.${calendarRange}` };
  }
  if (row.truncated) {
    return { ...base, history: "partial", historyNote: `${name} history was truncated by upstream limits; early days may be missing.` };
  }
  return { ...base, history: "complete", historyNote: `${name} history is complete for the covered range.` };
}

export async function getCoverage(userId: string): Promise<ActivityCoverageDto> {
  assertDatabaseConfigured();
  const rows = await accountCoverageRows(userId);
  const platforms = rows.map(toPlatformCoverage);
  const complete = rows.length > 0 && platforms.every((p) => p.history === "complete" || p.history === "empty");
  return {
    complete,
    connectedPlatforms: rows.map((r) => r.platform),
    platformsWithHistory: rows.filter((r) => r.eventCount > 0).map((r) => r.platform),
    platforms,
  };
}

export interface StreakSummary {
  streak: StreakDto;
  coverage: ActivityCoverageDto;
}

export async function getStreakSummary(
  userId: string,
  storedTimezone: string | undefined,
  explicitTimezone?: string,
  now: Date = new Date()
): Promise<StreakSummary> {
  assertDatabaseConfigured();
  const timezone = resolveTimezone(explicitTimezone, storedTimezone);
  // Merged instants: calendar-covered LeetCode days enter as UTC-midnight
  // instants (sets dedupe, so no double count); recent per-problem rows on
  // those days are already represented and excluded by the helper.
  const { countRows } = await fetchUnifiedActivity(userId);
  const streak = computeStreaks({
    activeInstants: countRows.map((e) => e.occurredAt),
    timeZone: timezone,
    now,
  });
  const coverage = await getCoverage(userId);
  return { streak, coverage };
}

export interface DaysSummary {
  days: ActivityDayDto[];
  range: { start: string; end: string };
  timezone: string;
}

export async function getActivityDays(
  userId: string,
  storedTimezone: string | undefined,
  days: number,
  endKey: string | undefined,
  explicitTimezone?: string,
  now: Date = new Date()
): Promise<DaysSummary> {
  assertDatabaseConfigured();
  const timezone = resolveTimezone(explicitTimezone, storedTimezone);
  // Clamp future end dates to local today instead of rejecting them:
  // timezones ahead of UTC would otherwise trip a UTC-anchored check.
  const todayKey = toDayKey(now, timezone);
  const end = endKey && endKey <= todayKey ? endKey : todayKey;
  const start = shiftDayKey(end, -(days - 1));
  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T23:59:59.999Z`);
  const { countRows } = await fetchUnifiedActivity(userId, startDate, endDate);
  // buildDayBuckets counts rows per day and re-applies the range in the
  // effective timezone; calendar instants carry their platform already.
  const buckets = buildDayBuckets(
    countRows.map((e) => ({ occurredAt: e.occurredAt, platform: e.platform })),
    timezone,
    start,
    end
  );
  return {
    // Platform values originate from linked-account platform ids, so they
    // are valid PlatformIds by construction.
    days: buckets.map((b) => ({
      ...b,
      platforms: b.platforms as PlatformId[],
    })) as ActivityDayDto[],
    range: { start, end },
    timezone,
  };
}

export interface RecentSummary {
  items: RecentActivityItemDto[];
  pagination: { limit: number; offset: number; total: number };
}

export async function getRecentActivity(
  userId: string,
  limit: number,
  offset: number,
  platform?: PlatformId,
  type?: ActivityTypeDto
): Promise<RecentSummary> {
  assertDatabaseConfigured();
  const where = {
    userId,
    ...(platform ? { platform } : {}),
    ...(type ? { activityType: type } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.activityEvent.count({ where }),
    prisma.activityEvent.findMany({
      where,
      include: { linkedAccount: { select: { platformUsername: true } } },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: limit,
      skip: offset,
    }),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      platform: r.platform as PlatformId,
      type: r.activityType as RecentActivityItemDto["type"],
      problemIdentifier: r.problemIdentifier,
      difficulty: r.difficulty,
      occurredAt: r.occurredAt.toISOString(),
      platformUsername: r.linkedAccount.platformUsername,
    })),
    pagination: { limit, offset, total },
  };
}

export async function getActivityTotals(userId: string): Promise<ActivityTotalsDto> {
  assertDatabaseConfigured();
  // Merged rows so calendar-covered days count once (calendar counts win;
  // recent per-problem rows on those days are represented already). Solved
  // sets always use the unfiltered PROBLEM_SOLVED rows; official totals
  // come from platform-reported stats, never from row counts.
  const [{ countRows, solvedRows }, linkedAccounts] = await Promise.all([
    fetchUnifiedActivity(userId),
    // Official per-platform solved totals reported by the platforms
    // themselves. Individually identified solves above can legitimately lag
    // these where upstream history is windowed (e.g. LeetCode recent list).
    prisma.linkedAccount.findMany({
      where: { userId },
      select: { platform: true, stats: { select: { totalSolved: true } } },
    }),
  ]);
  const byPlatform: Partial<Record<PlatformId, number>> = {};
  const byType: Partial<Record<ActivityTypeDto, number>> = {};
  for (const row of countRows) {
    const platform = row.platform as PlatformId;
    byPlatform[platform] = (byPlatform[platform] ?? 0) + 1;
    const type = row.activityType as ActivityTypeDto;
    byType[type] = (byType[type] ?? 0) + 1;
  }
  const solvedKeys = new Map<string, Set<string>>();
  for (const row of solvedRows) {
    // Non-null by helper contract (PROBLEM_SOLVED with identifier); the
    // guard keeps TypeScript honest if the contract ever relaxes.
    if (row.problemIdentifier === null) continue;
    let keys = solvedKeys.get(row.platform);
    if (!keys) {
      keys = new Set<string>();
      solvedKeys.set(row.platform, keys);
    }
    keys.add(row.problemIdentifier);
  }
  const uniqueSolvedByPlatform: Partial<Record<PlatformId, number>> = {};
  for (const [platform, keys] of solvedKeys) {
    uniqueSolvedByPlatform[platform as PlatformId] = keys.size;
  }
  const officialSolvedByPlatform: Partial<Record<PlatformId, number>> = {};
  for (const account of linkedAccounts) {
    if (account.stats?.totalSolved != null) {
      officialSolvedByPlatform[account.platform as PlatformId] = account.stats.totalSolved;
    }
  }
  return {
    total: countRows.length,
    byPlatform,
    byType,
    uniqueSolvedByPlatform,
    officialSolvedByPlatform,
  };
}
