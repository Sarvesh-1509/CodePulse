import { Prisma } from "@prisma/client";
import { assertDatabaseConfigured, prisma } from "../../db/prisma";
import { HttpError } from "../../utils/httpError";
import { computeStreaks } from "../../utils/streaks";
import {
  mergeActivityRows,
  type DailyRowInput,
  type EventRowInput,
} from "../../utils/activity";
import { CURRENT_CPR_FORMULA_VERSION } from "../../utils/cpr";
import type {
  LeaderboardEntryDto,
  LeaderboardMetric,
  LeaderboardPageDto,
  LeaderboardPeriod,
  LeaderboardUserDto,
} from "@codepulse/shared";
import { PERIOD_DAYS } from "./schemas";

/**
 * Leaderboard rankings (Module 14).
 *
 * Every board ranks trusted persisted values only — clients never submit
 * scores, and no endpoint accepts a score from the request. Ties share a
 * rank using standard competition ranking ("1224"); the streak board orders
 * tied scores by longest streak, then username ascending is the final
 * deterministic sort so pages are stable across reloads.
 *
 * - Global boards show only users who opted in via showOnLeaderboard.
 *   Entries carry public identity fragments only (never email, platform
 *   logins, or secrets).
 * - Room boards show room members (the room's documented social contract)
 *   and require membership; non-members get 404, never a peek.
 * - CPR boards admit only snapshots stamped with the current formula
 *   version; older versions stay readable as personal history but never
 *   mix into one ranking.
 * - Activity-family boards use UTC calendar days so every viewer sees the
 *   same board regardless of timezone (documented; personal streak views
 *   still use the user's own timezone).
 *
 * No cross-module imports: ranking math and version constant live in
 * utils/, all reads go through the Prisma singleton directly.
 */

const MAX_BOARD_ROWS = 2000;

interface ScoredRow {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  score: number;
  /**
   * Metric-specific tiebreak, ordered descending before username. Only the
   * streak board sets it (longest streak); ranks still depend on score
   * alone, so tied scores share a rank in deterministic tiebreak order.
   */
  tiebreak?: number;
  provisional?: boolean;
  detail: LeaderboardEntryDto["detail"];
}

function toUserDto(row: ScoredRow): LeaderboardUserDto {
  return {
    id: row.userId,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
  };
}

/**
 * Assign competition ranks ("1224") to rows pre-sorted by score desc,
 * tiebreak desc, username asc. Pure and unit-tested through the API suite.
 */
export function applyRanks(rows: ScoredRow[]): LeaderboardEntryDto[] {
  const entries: LeaderboardEntryDto[] = [];
  let rank = 0;
  let previousScore: number | null = null;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (previousScore === null || row.score !== previousScore) {
      rank = i + 1;
      previousScore = row.score;
    }
    entries.push({
      rank,
      user: toUserDto(row),
      score: row.score,
      ...(row.provisional !== undefined ? { provisional: row.provisional } : {}),
      detail: row.detail,
    });
  }
  return entries;
}

function sortScored(rows: ScoredRow[]): ScoredRow[] {
  return [...rows].sort(
    (a, b) =>
      b.score - a.score ||
      (b.tiebreak ?? 0) - (a.tiebreak ?? 0) ||
      (a.username < b.username ? -1 : 1)
  );
}

interface BoardScope {
  type: "global" | "room";
  roomId?: string;
}

async function requireRoomMember(roomId: string, userId: string): Promise<void> {
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
  });
  if (!membership) {
    throw new HttpError(404, "Room not found.");
  }
}

async function roomMemberIds(roomId: string): Promise<string[]> {
  const members = await prisma.roomMember.findMany({
    where: { roomId },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

async function cprRows(scope: BoardScope): Promise<ScoredRow[]> {
  // Latest snapshot per user, then filter in code: keeps one query while
  // staying portable (no DISTINCT ON dialect lock-in beyond Postgres).
  const snapshots = await prisma.ratingSnapshot.findMany({
    orderBy: [{ userId: "asc" }, { calculatedAt: "desc" }],
    take: MAX_BOARD_ROWS * 2,
    include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true, showOnLeaderboard: true } } },
  });
  const latest = new Map<string, (typeof snapshots)[number]>();
  for (const s of snapshots) {
    if (!latest.has(s.userId)) latest.set(s.userId, s);
  }
  const rows: ScoredRow[] = [];
  for (const s of latest.values()) {
    if (s.formulaVersion !== CURRENT_CPR_FORMULA_VERSION) continue;
    if (scope.type === "global" && !s.user.showOnLeaderboard) continue;
    const meta =
      s.coverageMetadata !== null &&
      typeof s.coverageMetadata === "object" &&
      !Array.isArray(s.coverageMetadata)
        ? (s.coverageMetadata as Record<string, unknown>)
        : null;
    const coverage = meta?.coverage as Record<string, unknown> | undefined;
    const available = Array.isArray(coverage?.componentsAvailable)
      ? (coverage.componentsAvailable as string[])
      : ["contest", "solving", "consistency"];
    rows.push({
      userId: s.userId,
      username: s.user.username,
      displayName: s.user.displayName,
      avatarUrl: s.user.avatarUrl,
      score: s.rating.toNumber(),
      provisional: available.length < 3,
      detail: { rating: s.rating.toNumber() },
    });
  }
  if (scope.type === "room" && scope.roomId) {
    const ids = new Set(await roomMemberIds(scope.roomId));
    return rows.filter((r) => ids.has(r.userId));
  }
  return rows;
}

interface ActivityAgg {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  showOnLeaderboard: boolean;
  events: number;
  activeDays: number;
  solved: number;
}

async function activityAggs(
  scope: BoardScope,
  start: Date,
  end: Date
): Promise<ActivityAgg[]> {
  // One aggregate query: UTC calendar days keep the board identical for
  // every viewer (documented; personal views use the member timezone).
  // Prisma.parameterize via template tag — no string interpolation of input.
  //
  // Day-level aggregates (DailyActivity, currently LeetCode calendar only)
  // are unioned in as one row per submission so counts are complete, while
  // LeetCode event rows on calendar-covered days are excluded — those
  // submissions are already inside the day's calendar count. Solved sets
  // still use only PROBLEM_SOLVED rows with identifiers (see below), so
  // calendar counts never leak into solved metrics.
  const memberFilter =
    scope.type === "room" && scope.roomId
      ? Prisma.sql`AND e."userId" IN (SELECT "userId" FROM "RoomMember" WHERE "roomId" = ${scope.roomId}::uuid)`
      : Prisma.empty;
  const optInFilter =
    scope.type === "global" ? Prisma.sql`AND u."showOnLeaderboard" = true` : Prisma.empty;
  const rows = await prisma.$queryRaw<
    Array<{
      userId: string;
      username: string;
      displayName: string | null;
      avatarUrl: string | null;
      showOnLeaderboard: boolean;
      events: bigint;
      activeDays: bigint;
      solved: bigint;
    }>
  >`
    SELECT
      e."userId" AS "userId",
      u.username AS username,
      u."displayName" AS "displayName",
      u."avatarUrl" AS "avatarUrl",
      u."showOnLeaderboard" AS "showOnLeaderboard",
      COUNT(*) AS events,
      COUNT(DISTINCT (e."occurredAt" AT TIME ZONE 'UTC')::date) AS "activeDays",
      -- Platform-scoped identifiers: the same problem id on two platforms
      -- (e.g. Codeforces "1A" vs CodeChef "1A") counts twice, matching the
      -- analytics service platform-plus-identifier dedup rule.
      COUNT(DISTINCT (e.platform::text || '::' || e."problemIdentifier")) FILTER (
        WHERE e."activityType" = 'PROBLEM_SOLVED' AND e."problemIdentifier" IS NOT NULL
      ) AS solved
    FROM (
      SELECT ev."userId", ev.platform, ev."activityType", ev."problemIdentifier", ev."occurredAt"
      FROM "ActivityEvent" ev
      WHERE NOT (
        ev.platform = 'LEETCODE'
        AND ev."activityType" IN ('PROBLEM_SOLVED', 'SUBMISSION')
        AND EXISTS (
          SELECT 1 FROM "DailyActivity" d
          WHERE d."linkedAccountId" = ev."linkedAccountId"
            AND d.date = (ev."occurredAt" AT TIME ZONE 'UTC')::date
        )
      )
      UNION ALL
      -- timezone('UTC', date) pins UTC midnight explicitly: a bare
      -- date::timestamptz cast would use the session timezone instead.
      SELECT d."userId", d.platform, 'SUBMISSION', NULL::text, timezone('UTC', d.date)
      FROM "DailyActivity" d
      JOIN LATERAL generate_series(1, d.submissions) ON true
    ) e
    JOIN "User" u ON u.id = e."userId"
    WHERE e."occurredAt" >= ${start} AND e."occurredAt" < ${end}
    ${memberFilter}
    ${optInFilter}
    GROUP BY e."userId", u.username, u."displayName", u."avatarUrl", u."showOnLeaderboard"
    HAVING COUNT(*) > 0
    LIMIT ${MAX_BOARD_ROWS}
  `;
  return rows.map((r) => ({
    userId: r.userId,
    username: r.username,
    displayName: r.displayName,
    avatarUrl: r.avatarUrl,
    showOnLeaderboard: r.showOnLeaderboard,
    events: Number(r.events),
    activeDays: Number(r.activeDays),
    solved: Number(r.solved),
  }));
}

async function streakRows(scope: BoardScope, now: Date): Promise<ScoredRow[]> {
  // Streaks need full histories, so bound the lookback to 365 days and say
  // so: ranking "current streak as best known from the trailing year".
  const since = new Date(now.getTime() - 365 * 86_400_000);
  const where: { occurredAt: { gte: Date }; userId?: { in: string[] } } = {
    occurredAt: { gte: since },
  };
  let memberIds: Set<string> | null = null;
  if (scope.type === "room" && scope.roomId) {
    memberIds = new Set(await roomMemberIds(scope.roomId));
    if (memberIds.size === 0) return [];
    where.userId = { in: [...memberIds] };
  }
  const [events, dailyRows] = await Promise.all([
    prisma.activityEvent.findMany({
      where,
      select: { userId: true, occurredAt: true, platform: true, activityType: true, problemIdentifier: true, linkedAccountId: true },
      orderBy: { occurredAt: "asc" },
      take: 200_000,
    }),
    prisma.dailyActivity.findMany({
      where: {
        ...(memberIds ? { userId: { in: [...memberIds] } } : {}),
        date: { gte: since },
      },
      select: { userId: true, linkedAccountId: true, platform: true, date: true, submissions: true },
      orderBy: { date: "asc" },
      take: 200_000,
    }),
  ]);
  // Day-level aggregates merge in as UTC-midnight instants; LeetCode event
  // rows on calendar-covered days are represented already (same overlap
  // rule as the single-user helper). Sets dedupe, so streaks count days.
  const byUserEvents = new Map<string, EventRowInput[]>();
  for (const e of events) {
    const list = byUserEvents.get(e.userId) ?? [];
    list.push(e);
    byUserEvents.set(e.userId, list);
  }
  const byUserDaily = new Map<string, DailyRowInput[]>();
  for (const d of dailyRows) {
    const list = byUserDaily.get(d.userId) ?? [];
    list.push(d);
    byUserDaily.set(d.userId, list);
  }
  const byUser = new Map<string, Date[]>();
  for (const userId of new Set([...byUserEvents.keys(), ...byUserDaily.keys()])) {
    const { countRows } = mergeActivityRows(
      byUserEvents.get(userId) ?? [],
      byUserDaily.get(userId) ?? []
    );
    byUser.set(
      userId,
      countRows.map((r) => r.occurredAt)
    );
  }
  const users = await prisma.user.findMany({
    where: { id: { in: [...byUser.keys()] } },
    select: { id: true, username: true, displayName: true, avatarUrl: true, showOnLeaderboard: true },
  });
  const rows: ScoredRow[] = [];
  for (const u of users) {
    if (scope.type === "global" && !u.showOnLeaderboard) continue;
    const streak = computeStreaks({ activeInstants: byUser.get(u.id) ?? [], timeZone: "UTC", now });
    if (streak.current <= 0 && streak.longest <= 0) continue;
    rows.push({
      userId: u.id,
      username: u.username,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      score: streak.current,
      // Longest streak breaks current-streak ties; the board-wide sort in
      // getBoard applies it (it must live on the row — a local sort here
      // would be discarded there).
      tiebreak: streak.longest,
      detail: { streak: streak.current, activeDays: streak.totalActiveDays },
    });
  }
  return rows;
}

export interface BoardQuery {
  metric: LeaderboardMetric;
  period: LeaderboardPeriod;
  page: number;
  limit: number;
  now?: Date;
}

function periodBounds(period: LeaderboardPeriod, now: Date): { start: Date; end: Date; days: number } {
  const days = PERIOD_DAYS[period];
  const end = now;
  const start = new Date(now.getTime() - days * 86_400_000);
  return { start, end, days };
}

async function scoredRows(
  scope: BoardScope,
  metric: LeaderboardMetric,
  period: LeaderboardPeriod,
  now: Date
): Promise<ScoredRow[]> {
  if (metric === "cpr") {
    return cprRows(scope);
  }
  if (metric === "streak") {
    return streakRows(scope, now);
  }
  const { start, end } = periodBounds(period, now);
  const aggs = await activityAggs(scope, start, end);
  return aggs.flatMap((a): ScoredRow[] => {
    if (metric === "activity") {
      if (a.activeDays <= 0) return [];
      return [
        {
          userId: a.userId,
          username: a.username,
          displayName: a.displayName,
          avatarUrl: a.avatarUrl,
          score: a.activeDays,
          detail: { activeDays: a.activeDays, events: a.events },
        },
      ];
    }
    // "solved": distinct verified solves in the window.
    if (a.solved <= 0) return [];
    return [
      {
        userId: a.userId,
        username: a.username,
        displayName: a.displayName,
        avatarUrl: a.avatarUrl,
        score: a.solved,
        detail: { solved: a.solved, events: a.events },
      },
    ];
  });
}

function metricNote(metric: LeaderboardMetric, period: LeaderboardPeriod): string | null {
  if (metric === "cpr") {
    return `Latest CodePulse Rating snapshots (formula ${CURRENT_CPR_FORMULA_VERSION}); provisional rows are flagged.`;
  }
  if (metric === "streak") {
    return "Current streaks as best known from the trailing 365 days of verified activity (UTC days).";
  }
  const days = PERIOD_DAYS[period];
  if (metric === "activity") {
    return `Distinct active UTC days in the trailing ${days} days. Recent-window sources (LeetCode) only contribute their known history.`;
  }
  return `Distinct verified solved problems in the trailing ${days} days (UTC). Recent-window sources contribute only known history.`;
}

export async function getBoard(
  scope: BoardScope,
  viewerId: string | null,
  query: BoardQuery
): Promise<LeaderboardPageDto> {
  assertDatabaseConfigured();
  if (scope.type === "room" && !scope.roomId) {
    throw new HttpError(404, "Room not found.");
  }
  if (scope.type === "room" && viewerId === null) {
    throw new HttpError(401, "Authentication required.");
  }
  if (scope.type === "room" && scope.roomId && viewerId) {
    await requireRoomMember(scope.roomId, viewerId);
  }
  const now = query.now ?? new Date();
  const rows = sortScored(await scoredRows(scope, query.metric, query.period, now));
  const entries = applyRanks(rows);
  const total = entries.length;
  const start = (query.page - 1) * query.limit;
  const me =
    viewerId === null
      ? null
      : (entries.find((e) => e.user.id === viewerId) ?? null);
  return {
    metric: query.metric,
    period: query.metric === "cpr" || query.metric === "streak" ? null : query.period,
    formulaVersion: query.metric === "cpr" ? CURRENT_CPR_FORMULA_VERSION : null,
    entries: entries.slice(start, start + query.limit),
    pagination: { page: query.page, limit: query.limit, total },
    me,
    note: metricNote(query.metric, query.period),
  };
}
