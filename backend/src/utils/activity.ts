import { prisma } from "../db/prisma";
import { toDayKey } from "./streaks";

/**
 * Unified activity reads: ActivityEvent rows merged with DailyActivity
 * day-level aggregates (currently LeetCode submission calendar only).
 *
 * Why this exists: recent per-problem rows and calendar day counts overlap
 * on shared days (a recent accepted submission is also inside its calendar
 * day's submission count). Summing both would double-count. The merge rule,
 * applied identically by every consumer below, is:
 *
 * - A LeetCode PROBLEM_SOLVED or SUBMISSION event row whose UTC day has a
 *   verified DailyActivity row for the same linked account is dropped from
 *   day-count metrics — the calendar count represents that day.
 * - Solved sets always use the unfiltered PROBLEM_SOLVED rows, so no
 *   identifiable solve is ever lost from solved metrics.
 * - Calendar days expand as UTC-midnight instants typed SUBMISSION with no
 *   problem identifier: they feed day counts, active-day sets, streaks, and
 *   trends — never solved sets (solved requires PROBLEM_SOLVED plus an
 *   identifier) and never contest counts (type-gated).
 *
 * Timezone convention (documented, single rule): LeetCode calendar days are
 * UTC calendar days. They enter pipelines as UTC-midnight instants, so in
 * non-UTC request timezones a calendar day can attribute to the adjacent
 * local day. Day-granular upstream data cannot be localized exactly; UTC is
 * the documented convention (it also matches the leaderboard UTC bucketing).
 * Exact-timestamp events keep the request's effective timezone as before.
 */

/** Row shape for day-count metrics. Mirrors the analytics EventRow shape. */
export interface UnifiedEventRow {
  occurredAt: Date;
  platform: string;
  activityType: string;
  problemIdentifier: string | null;
}

export interface UnifiedActivity {
  /** Rows for counts, buckets, trends, and streaks (overlap removed). */
  countRows: UnifiedEventRow[];
  /** All PROBLEM_SOLVED rows with identifiers (unfiltered) for solved sets. */
  solvedRows: UnifiedEventRow[];
}

/** UTC-day key for coverage matching (calendar-native space). */
function utcDayKey(at: Date): string {
  return toDayKey(at, "UTC");
}

export interface EventRowInput {
  occurredAt: Date;
  platform: string;
  activityType: string;
  problemIdentifier: string | null;
  linkedAccountId: string;
}

export interface DailyRowInput {
  linkedAccountId: string;
  platform: string;
  date: Date;
  submissions: number;
}

/**
 * Pure merge of event rows with day-level aggregates. Separated from
 * fetching so multi-user consumers (leaderboards) can reuse the exact
 * same overlap rule without N+1 queries.
 */
export function mergeActivityRows(
  events: EventRowInput[],
  dailyRows: DailyRowInput[]
): UnifiedActivity {
  // Coverage: UTC days with a verified daily row, per linked account.
  const covered = new Set<string>();
  for (const d of dailyRows) {
    covered.add(`${d.linkedAccountId}::${utcDayKey(d.date)}`);
  }

  const countRows: UnifiedEventRow[] = [];
  const solvedRows: UnifiedEventRow[] = [];
  for (const e of events) {
    const row: UnifiedEventRow = {
      occurredAt: e.occurredAt,
      platform: e.platform,
      activityType: e.activityType,
      problemIdentifier: e.problemIdentifier,
    };
    if (e.activityType === "PROBLEM_SOLVED" && e.problemIdentifier) {
      solvedRows.push(row);
    }
    if (
      e.platform === "LEETCODE" &&
      (e.activityType === "PROBLEM_SOLVED" || e.activityType === "SUBMISSION") &&
      covered.has(`${e.linkedAccountId}::${utcDayKey(e.occurredAt)}`)
    ) {
      continue;
    }
    countRows.push(row);
  }

  for (const d of dailyRows) {
    for (let i = 0; i < d.submissions; i += 1) {
      countRows.push({
        occurredAt: d.date,
        platform: d.platform,
        activityType: "SUBMISSION",
        problemIdentifier: null,
      });
    }
  }
  countRows.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  return { countRows, solvedRows };
}

export async function fetchUnifiedActivity(
  userId: string,
  gte?: Date,
  lte?: Date
): Promise<UnifiedActivity> {
  // Daily padding absorbs timezone shifts between UTC calendar days and
  // the caller's effective-timezone window; callers still apply their own
  // exact range filters to the merged rows.
  // Omitted bounds mean "unbounded" (all-time reads): no date filter is
  // sent at all, because out-of-range timestamps are rejected at the
  // engine level even when the database could store them.
  const pad = 2 * 86_400_000;
  const eventRange: { gte?: Date; lte?: Date } = {};
  if (gte !== undefined) eventRange.gte = gte;
  if (lte !== undefined) eventRange.lte = lte;
  const hasEventBounds = eventRange.gte !== undefined || eventRange.lte !== undefined;
  const dateRange: { gte?: Date; lte?: Date } = {};
  if (gte !== undefined) dateRange.gte = new Date(gte.getTime() - pad);
  if (lte !== undefined) dateRange.lte = new Date(lte.getTime() + pad);
  const hasDateBounds = dateRange.gte !== undefined || dateRange.lte !== undefined;
  const [events, dailyRows] = await Promise.all([
    prisma.activityEvent.findMany({
      where: { userId, ...(hasEventBounds ? { occurredAt: eventRange } : {}) },
      select: {
        occurredAt: true,
        platform: true,
        activityType: true,
        problemIdentifier: true,
        linkedAccountId: true,
      },
      orderBy: { occurredAt: "asc" },
    }),
    prisma.dailyActivity.findMany({
      where: {
        userId,
        ...(hasDateBounds ? { date: dateRange } : {}),
      },
      select: { linkedAccountId: true, platform: true, date: true, submissions: true },
      orderBy: { date: "asc" },
    }),
  ]);
  return mergeActivityRows(events, dailyRows);
}
