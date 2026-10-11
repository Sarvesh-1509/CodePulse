/**
 * Shared activity contracts for CodePulse (Module 9).
 *
 * Serializable DTOs shared by the backend API and the Next.js frontend.
 * No server-only imports here: the frontend must be able to use them.
 */

import type { PlatformId } from "./platforms";

export type ActivityTypeDto = "PROBLEM_SOLVED" | "CONTEST_PARTICIPATION" | "SUBMISSION";

export type ActivityHistoryState =
  | "complete"
  | "partial"
  | "unavailable"
  | "never-synced"
  | "empty"
  | "error";

export interface ActivityDayDto {
  /** Calendar date in the effective timezone, YYYY-MM-DD. */
  date: string;
  count: number;
  platforms: PlatformId[];
}

export interface ActivityTotalsDto {
  total: number;
  byPlatform: Partial<Record<PlatformId, number>>;
  byType: Partial<Record<ActivityTypeDto, number>>;
  /**
   * Distinct problems solved per platform: PROBLEM_SOLVED events with a
   * problem identifier, deduplicated by (platform, problemIdentifier).
   * Rejected submissions are never stored, so they cannot appear here;
   * CONTEST_PARTICIPATION rows are excluded. Platforms without any such
   * rows are absent from the map — never a fabricated zero.
   */
  uniqueSolvedByPlatform: Partial<Record<PlatformId, number>>;
  /**
   * Official all-time solved totals reported by each connected platform
   * (null stats stay absent, never zero). Individually identified solves
   * above can legitimately lag these where upstream history is windowed —
   * e.g. LeetCode reports 164 here while only ~20 recent problems carry
   * identifiers. Clients must label the two numbers distinctly.
   */
  officialSolvedByPlatform: Partial<Record<PlatformId, number>>;
}

export interface PlatformCoverageDto {
  platform: PlatformId;
  connected: boolean;
  status: string | null;
  lastSyncedAt: string | null;
  hasSyncError: boolean;
  eventCount: number;
  earliestEventAt: string | null;
  latestEventAt: string | null;
  history: ActivityHistoryState;
  historyNote: string;
  /**
   * Verified calendar-day coverage (currently LeetCode only). Absent when
   * the platform has no daily-activity import; a missing day means "no
   * verified activity", never an assumed zero — and a missing range means
   * "not imported", which callers must surface as a coverage gap.
   */
  calendarDays?: number;
  calendarFrom?: string | null;
  calendarTo?: string | null;
}

export interface ActivityCoverageDto {
  complete: boolean;
  connectedPlatforms: PlatformId[];
  platformsWithHistory: PlatformId[];
  platforms: PlatformCoverageDto[];
}

export interface StreakDto {
  current: number;
  longest: number;
  totalActiveDays: number;
  todayActive: boolean;
  /** IANA timezone the day boundaries were computed in. */
  timezone: string;
  /** ISO timestamp the calculation is anchored at ("now"). */
  asOf: string;
}

export interface RecentActivityItemDto {
  id: string;
  platform: PlatformId;
  type: ActivityTypeDto;
  problemIdentifier: string | null;
  difficulty: string | null;
  occurredAt: string;
  platformUsername: string;
}
