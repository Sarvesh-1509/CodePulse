import type { PlatformId } from "@codepulse/shared";
import { assertDatabaseConfigured, prisma } from "../../db/prisma";
import { computeStreaks, shiftDayKey, toDayKey } from "../../utils/streaks";
import {
  fetchUnifiedActivity,
  type UnifiedEventRow,
} from "../../utils/activity";
import { CURRENT_CPR_FORMULA_VERSION } from "../../utils/cpr";
import type {
  AnalyticsRange,
  AnalyticsSummaryDto,
  ContestEntryDto,
  CprSnapshotDto,
  NativeRatingPointDto,
  PeriodComparisonDto,
  PlatformBreakdownDto,
  TrendBucketDto,
} from "@codepulse/shared";
import { RANGE_DAYS } from "./schemas";

/**
 * Analytics reads (Module 12). Every aggregate derives from persisted
 * verified rows (ActivityEvent, ContestResult, PlatformStats,
 * RatingSnapshot, LinkedAccount). Ranges with no data report zeros plus
 * explicit coverage notes — history is never invented, backfilled, or
 * backdated. No cross-module imports: all reads go through Prisma plus
 * utils/streaks day math.
 */

export interface ResolvedWindow {
  range: AnalyticsRange | "custom";
  start: string;
  end: string;
  timezone: string;
}

export function resolveWindow(
  range: AnalyticsRange | undefined,
  start: string | undefined,
  end: string | undefined,
  explicitTimezone: string | undefined,
  storedTimezone: string | undefined,
  now: Date = new Date()
): ResolvedWindow {
  const timezone = explicitTimezone ?? storedTimezone ?? "UTC";
  if (range !== undefined) {
    const days = RANGE_DAYS[range];
    const endKey = toDayKey(now, timezone);
    return { range, start: shiftDayKey(endKey, -(days - 1)), end: endKey, timezone };
  }
  return { range: "custom", start: start as string, end: end as string, timezone };
}

/** Padded fetch window so timezone bucketing never clips edge days. */
function paddedBounds(start: string, end: string): { gte: Date; lte: Date } {
  return {
    gte: new Date(`${shiftDayKey(start, -1)}T00:00:00.000Z`),
    lte: new Date(`${shiftDayKey(end, 1)}T00:00:00.000Z`),
  };
}

async function fetchEvents(
  userId: string,
  start: string,
  end: string
): Promise<{ countRows: UnifiedEventRow[]; solvedRows: UnifiedEventRow[] }> {
  const { gte, lte } = paddedBounds(start, end);
  return fetchUnifiedActivity(userId, gte, lte);
}

export interface WindowTotals {
  events: number;
  activeDays: number;
  solved: number;
  contests: number;
}

function summarizeEvents(
  countRows: UnifiedEventRow[],
  solvedRows: UnifiedEventRow[],
  timezone: string,
  start: string,
  end: string
): WindowTotals & { activeDaySet: Set<string> } {
  const days = new Set<string>();
  const solved = new Set<string>();
  let contests = 0;
  let count = 0;
  for (const e of countRows) {
    const key = toDayKey(e.occurredAt, timezone);
    if (key < start || key > end) continue;
    count += 1;
    days.add(key);
    if (e.activityType === "CONTEST_PARTICIPATION") contests += 1;
  }
  // Solved sets always use the unfiltered PROBLEM_SOLVED rows: recent
  // per-problem rows on calendar-covered days are dropped from counts
  // (already represented) but never from solved metrics.
  for (const e of solvedRows) {
    const key = toDayKey(e.occurredAt, timezone);
    if (key < start || key > end) continue;
    if (e.problemIdentifier) {
      solved.add(`${e.platform}::${e.problemIdentifier}`);
    }
  }
  return { events: count, activeDays: days.size, solved: solved.size, contests, activeDaySet: days };
}

type BucketKind = "daily" | "weekly" | "monthly";

function bucketKindForSpan(spanDays: number): BucketKind {
  if (spanDays <= 31) return "daily";
  if (spanDays <= 120) return "weekly";
  return "monthly";
}

export interface TrendBucket extends TrendBucketDto {
  kind: BucketKind;
}

function summarizeRows(
  countRows: UnifiedEventRow[],
  solvedRows: UnifiedEventRow[],
  timezone: string
): WindowTotals {
  // Rows are pre-bucketed by the caller: each row counts exactly once
  // toward exactly one bucket. Day keys come from occurredAt so weekly and
  // monthly buckets report true distinct active days.
  const days = new Set<string>();
  const solved = new Set<string>();
  let contests = 0;
  for (const r of countRows) {
    days.add(toDayKey(r.occurredAt, timezone));
    if (r.activityType === "CONTEST_PARTICIPATION") contests += 1;
  }
  for (const r of solvedRows) {
    if (r.problemIdentifier) {
      solved.add(`${r.platform}::${r.problemIdentifier}`);
    }
  }
  return { events: countRows.length, activeDays: days.size, solved: solved.size, contests };
}

export async function getTrends(
  userId: string,
  window: ResolvedWindow
): Promise<{ buckets: TrendBucket[]; kind: BucketKind; range: { start: string; end: string }; timezone: string }> {
  assertDatabaseConfigured();
  const { countRows, solvedRows } = await fetchEvents(userId, window.start, window.end);
  const spanDays =
    Math.round(
      (Date.parse(`${window.end}T00:00:00Z`) - Date.parse(`${window.start}T00:00:00Z`)) / 86_400_000
    ) + 1;
  const kind = bucketKindForSpan(spanDays);

  const groups = new Map<string, UnifiedEventRow[]>();
  const solvedGroups = new Map<string, UnifiedEventRow[]>();
  const order: string[] = [];
  if (kind === "daily") {
    for (let key = window.start; ; key = shiftDayKey(key, 1)) {
      groups.set(key, []);
      order.push(key);
      if (key === window.end) break;
    }
  } else if (kind === "weekly") {
    for (let key = window.start; ; key = shiftDayKey(key, 7)) {
      const endKey = shiftDayKey(key, 6) > window.end ? window.end : shiftDayKey(key, 6);
      const id = `week:${key}`;
      groups.set(id, []);
      order.push(id);
      void endKey;
      if (shiftDayKey(key, 7) > window.end) break;
    }
  } else {
    let cursor = `${window.start.slice(0, 7)}-01`;
    while (cursor <= window.end) {
      const id = `month:${cursor.slice(0, 7)}`;
      if (!groups.has(id)) {
        groups.set(id, []);
        order.push(id);
      }
      cursor = shiftDayKey(cursor, 32).slice(0, 7) + "-01";
    }
  }

  // Assign each in-range row to its bucket by calendar position. Solved
  // rows ride alongside so per-bucket solved sets stay complete even
  // where count rows were overlap-dropped.
  const assign = (rows: UnifiedEventRow[], target: Map<string, UnifiedEventRow[]>) => {
    for (const e of rows) {
      const key = toDayKey(e.occurredAt, window.timezone);
      if (key < window.start || key > window.end) continue;
      let id: string;
      if (kind === "daily") {
        id = key;
      } else if (kind === "weekly") {
        const offset =
          Math.round((Date.parse(`${key}T00:00:00Z`) - Date.parse(`${window.start}T00:00:00Z`)) / 86_400_000);
        id = order[Math.floor(offset / 7)] ?? order[order.length - 1];
      } else {
        id = `month:${key.slice(0, 7)}`;
      }
      let list = target.get(id);
      if (!list) {
        list = [];
        target.set(id, list);
      }
      list.push(e);
    }
  };
  assign(countRows, groups);
  assign(solvedRows, solvedGroups);

  const buckets: TrendBucket[] = order.map((id) => {
    const rows = groups.get(id) ?? [];
    const solved = solvedGroups.get(id) ?? [];
    const s = summarizeRows(rows, solved, window.timezone);
    const spanStart = kind === "daily" ? id : id.split(":")[1];
    const spanEnd =
      kind === "daily" ? id : kind === "weekly"
        ? (shiftDayKey(spanStart, 6) > window.end ? window.end : shiftDayKey(spanStart, 6))
        : spanStart.slice(0, 7);
    return {
      kind,
      start: kind === "monthly" ? spanStart.slice(0, 7) : spanStart,
      end: kind === "monthly" ? spanEnd : spanEnd,
      events: s.events,
      activeDays: s.activeDays,
      solved: s.solved,
      contests: s.contests,
    };
  });
  return { buckets, kind, range: { start: window.start, end: window.end }, timezone: window.timezone };
}

export async function getSummary(
  userId: string,
  window: ResolvedWindow,
  now: Date = new Date()
): Promise<AnalyticsSummaryDto> {
  assertDatabaseConfigured();
  const { countRows, solvedRows } = await fetchEvents(userId, window.start, window.end);
  const { activeDaySet: _dropped, ...totals } = summarizeEvents(
    countRows,
    solvedRows,
    window.timezone,
    window.start,
    window.end
  );

  const accounts = await prisma.linkedAccount.findMany({
    where: { userId },
    include: { stats: true },
    orderBy: { createdAt: "asc" },
  });

  const perPlatform: PlatformBreakdownDto[] = [];
  let totalSolvedAllTime = 0;
  let contestsAttended = 0;
  const coverageNotes: string[] = [];
  for (const account of accounts) {
    const stats = account.stats;
    if (stats?.totalSolved != null) totalSolvedAllTime += stats.totalSolved;
    if (stats?.contestsAttended != null) contestsAttended += stats.contestsAttended;
    const inWindow = (at: Date) => {
      const key = toDayKey(at, window.timezone);
      return key >= window.start && key <= window.end;
    };
    const platformEvents = countRows.filter(
      (e) => e.platform === account.platform && inWindow(e.occurredAt)
    );
    const solved = new Set(
      solvedRows
        .filter((e) => e.platform === account.platform && inWindow(e.occurredAt))
        .map((e) => e.problemIdentifier as string)
    );
    const days = new Set(
      platformEvents.map((e) => toDayKey(e.occurredAt, window.timezone))
    );
    // Calendar-sourced rows (SUBMISSION, no problem id): day-level counts,
    // never unique solves. Computed over the same window so the two
    // "solved" columns stay comparable period-to-period.
    const calendarRows = platformEvents.filter((e) => e.activityType === "SUBMISSION");
    const calendarDays = new Set(
      calendarRows.map((e) => toDayKey(e.occurredAt, window.timezone))
    );
    perPlatform.push({
      platform: account.platform as PlatformId,
      events: platformEvents.length,
      solved: solved.size,
      contests: platformEvents.filter((e) => e.activityType === "CONTEST_PARTICIPATION").length,
      activeDays: days.size,
      currentRating: stats?.contestRating != null ? stats.contestRating.toNumber() : null,
      // Official all-time solved total reported by the platform itself.
      // Unlike `solved` (individually identified problems in this window),
      // this survives windowed history — e.g. LeetCode reports 164 here
      // while only ~20 recent problems are individually identifiable.
      totalSolvedAllTime: stats?.totalSolved ?? null,
      calendarSubmissions: calendarRows.length,
      calendarDays: calendarDays.size,
      lastSyncedAt: account.lastSyncedAt ? account.lastSyncedAt.toISOString() : null,
    });
    if (account.connectionStatus === "ERROR") {
      coverageNotes.push(`${account.platform}: last sync failed; showing last synced data.`);
    } else if (account.lastSyncedAt === null) {
      coverageNotes.push(`${account.platform}: never synced; no verified history yet.`);
    }
  }

  const streak = computeStreaks({
    activeInstants: countRows
      .filter((e) => {
        const key = toDayKey(e.occurredAt, window.timezone);
        return key >= window.start && key <= window.end;
      })
      .map((e) => e.occurredAt),
    timeZone: window.timezone,
    now,
  });

  const latestSnapshot = await prisma.ratingSnapshot.findFirst({
    where: { userId },
    orderBy: { calculatedAt: "desc" },
  });

  return {
    range: { start: window.start, end: window.end },
    timezone: window.timezone,
    totals: { ...totals, totalSolvedAllTime },
    perPlatform,
    streak: { current: streak.current, longest: streak.longest },
    cpr: {
      rating: latestSnapshot ? latestSnapshot.rating.toNumber() : null,
      calculatedAt: latestSnapshot ? latestSnapshot.calculatedAt.toISOString() : null,
      provisional: false,
    },
    contestsAttended,
    coverageNotes,
  };
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export async function getCompare(
  userId: string,
  window: ResolvedWindow,
  now: Date = new Date()
): Promise<PeriodComparisonDto> {
  assertDatabaseConfigured();
  const spanDays =
    Math.round(
      (Date.parse(`${window.end}T00:00:00Z`) - Date.parse(`${window.start}T00:00:00Z`)) / 86_400_000
    ) + 1;
  const prevEnd = shiftDayKey(window.start, -1);
  const prevStart = shiftDayKey(prevEnd, -(spanDays - 1));

  const [currentUnified, previousUnified] = await Promise.all([
    fetchEvents(userId, window.start, window.end),
    fetchEvents(userId, prevStart, prevEnd),
  ]);
  const current = summarizeEvents(
    currentUnified.countRows,
    currentUnified.solvedRows,
    window.timezone,
    window.start,
    window.end
  );
  const previous = summarizeEvents(
    previousUnified.countRows,
    previousUnified.solvedRows,
    window.timezone,
    prevStart,
    prevEnd
  );

  const currentCpr = await prisma.ratingSnapshot.findFirst({
    where: { userId },
    orderBy: { calculatedAt: "desc" },
  });
  const previousCpr = await prisma.ratingSnapshot.findFirst({
    where: { userId, calculatedAt: { lte: new Date(`${prevEnd}T23:59:59.999Z`) } },
    orderBy: { calculatedAt: "desc" },
  });

  const hasPrevious =
    previous.events > 0 || previousCpr !== null;
  // When nothing is recorded for the previous window but the user does
  // have imported calendar history elsewhere, say "insufficient history"
  // for that window explicitly instead of implying zero activity.
  let previousNote: string | null = hasPrevious
    ? null
    : "Previous period has no recorded activity or rating snapshot, so no comparison is reported.";
  if (!hasPrevious) {
    const calendarCount = await prisma.dailyActivity.count({ where: { userId } });
    if (calendarCount > 0) {
      previousNote =
        "Insufficient history for the previous period: no activity is recorded there, " +
        "even though calendar history exists for other dates. Missing data is not zero activity.";
    }
  }
  const result: PeriodComparisonDto = {
    range: window.range,
    timezone: window.timezone,
    current: {
      start: window.start,
      end: window.end,
      events: current.events,
      activeDays: current.activeDays,
      solved: current.solved,
      contests: current.contests,
    },
    previous: hasPrevious
      ? {
          start: prevStart,
          end: prevEnd,
          events: previous.events,
          activeDays: previous.activeDays,
          solved: previous.solved,
          contests: previous.contests,
        }
      : null,
    deltaPct: {
      events: hasPrevious ? pctChange(current.events, previous.events) : null,
      activeDays: hasPrevious ? pctChange(current.activeDays, previous.activeDays) : null,
      solved: hasPrevious ? pctChange(current.solved, previous.solved) : null,
      contests: hasPrevious ? pctChange(current.contests, previous.contests) : null,
    },
    previousNote,
  };
  if (currentCpr || previousCpr) {
    result.cpr = {
      current: currentCpr ? currentCpr.rating.toNumber() : null,
      previous: previousCpr ? previousCpr.rating.toNumber() : null,
    };
  }
  return result;
}

export async function getContests(
  userId: string,
  limit: number,
  offset: number
): Promise<{ items: ContestEntryDto[]; pagination: { limit: number; offset: number; total: number } }> {
  assertDatabaseConfigured();
  const where = { linkedAccount: { userId } };
  const [total, rows] = await Promise.all([
    prisma.contestResult.count({ where }),
    prisma.contestResult.findMany({
      where,
      include: { linkedAccount: { select: { platform: true, platformUsername: true } } },
      orderBy: [{ contestedAt: "desc" }, { id: "desc" }],
      take: limit,
      skip: offset,
    }),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      platform: r.platform as PlatformId,
      platformUsername: r.linkedAccount.platformUsername,
      contestName: r.contestName,
      contestedAt: r.contestedAt.toISOString(),
      ratingBefore: r.ratingBefore,
      ratingChange: r.ratingChange,
      ratingAfter: r.ratingAfter,
      rank: r.rank,
    })),
    pagination: { limit, offset, total },
  };
}

export async function getPlatformsBreakdown(
  userId: string,
  window: ResolvedWindow
): Promise<{ platforms: PlatformBreakdownDto[]; range: ResolvedWindow }> {
  assertDatabaseConfigured();
  const summary = await getSummary(userId, window);
  return { platforms: summary.perPlatform, range: window };
}

export async function getNativeRatings(
  userId: string
): Promise<{ ratings: NativeRatingPointDto[]; cpr: CprSnapshotDto[] }> {
  assertDatabaseConfigured();
  const contests = await prisma.contestResult.findMany({
    where: { linkedAccount: { userId }, ratingAfter: { not: null } },
    include: { linkedAccount: { select: { platform: true } } },
    orderBy: { contestedAt: "asc" },
    take: 500,
  });
  const snapshots = await prisma.ratingSnapshot.findMany({
    where: { userId },
    orderBy: { calculatedAt: "asc" },
    take: 500,
  });
  return {
    ratings: contests.map((c) => ({
      date: c.contestedAt.toISOString().slice(0, 10),
      platform: c.linkedAccount.platform as PlatformId,
      contestName: c.contestName,
      ratingAfter: c.ratingAfter,
      rank: c.rank,
    })),
    cpr: snapshots.map((s) => ({
      id: s.id,
      rating: s.rating.toNumber(),
      components: {
        contest: s.contestScore.toNumber(),
        solving: s.problemSolvingScore.toNumber(),
        consistency: s.consistencyScore.toNumber(),
      },
      formulaVersion: s.formulaVersion,
      calculatedAt: s.calculatedAt.toISOString(),
    })),
  };
}
