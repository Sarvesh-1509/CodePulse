/**
 * Shared analytics contracts for CodePulse (Module 12).
 *
 * Serializable DTOs shared by the backend API and the Next.js frontend.
 * No server-only imports here: the frontend must be able to use them.
 * Every aggregate derives from persisted verified rows; ranges with no
 * data report zeros with explicit coverage notes, never invented values.
 */

import type { PlatformId } from "./platforms";

export type AnalyticsRange = "7d" | "30d" | "90d" | "1y";

export interface TrendBucketDto {
  /** Bucket start (ISO date for daily/weekly, YYYY-MM for monthly). */
  start: string;
  end: string;
  events: number;
  activeDays: number;
  solved: number;
  contests: number;
}

export interface ActivityTrendsDto {
  buckets: TrendBucketDto[];
  kind: "daily" | "weekly" | "monthly";
  range: { start: string; end: string };
  timezone: string;
}

export interface PlatformBreakdownDto {
  platform: PlatformId;
  events: number;
  solved: number;
  contests: number;
  activeDays: number;
  currentRating: number | null;
  /**
   * Official all-time solved total reported by the platform (null when the
   * platform never reported one). Unlike `solved` — individually identified
   * problems in the selected window — this is the authoritative lifetime
   * count and may legitimately exceed it where history is windowed.
   */
  totalSolvedAllTime: number | null;
  /**
   * Calendar-reported submissions in the selected window (LeetCode daily
   * activity). Day-level counts with no problem attribution: they must
   * never be labeled unique solves. Absent when the platform has no
   * calendar import.
   */
  calendarSubmissions?: number;
  /** Distinct calendar-covered days in the selected window, if any. */
  calendarDays?: number;
  lastSyncedAt: string | null;
}

export interface PeriodTotalsDto {
  events: number;
  activeDays: number;
  solved: number;
  contests: number;
}

export interface PeriodComparisonDto {
  range: AnalyticsRange | "custom";
  timezone: string;
  current: { start: string; end: string } & PeriodTotalsDto;
  previous: ({ start: string; end: string } & PeriodTotalsDto) | null;
  /** Null when the previous period has no data (never divide by zero). */
  deltaPct: {
    events: number | null;
    activeDays: number | null;
    solved: number | null;
    contests: number | null;
  };
  previousNote: string | null;
  /** Latest vs latest-at-previous-period-end CPR, when snapshots exist. */
  cpr?: { current: number | null; previous: number | null };
}

export interface AnalyticsSummaryDto {
  range: { start: string; end: string };
  timezone: string;
  totals: PeriodTotalsDto & { totalSolvedAllTime: number };
  perPlatform: PlatformBreakdownDto[];
  streak: { current: number; longest: number };
  cpr: { rating: number | null; calculatedAt: string | null; provisional: boolean };
  contestsAttended: number;
  coverageNotes: string[];
}

export interface ContestEntryDto {
  id: string;
  platform: PlatformId;
  platformUsername: string;
  contestName: string;
  contestedAt: string;
  ratingBefore: number | null;
  ratingChange: number | null;
  ratingAfter: number | null;
  rank: number | null;
}

export interface NativeRatingPointDto {
  date: string;
  platform: PlatformId;
  contestName: string;
  ratingAfter: number | null;
  rank: number | null;
}
