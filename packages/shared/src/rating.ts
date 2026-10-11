/**
 * Shared CodePulse Rating (CPR) contracts (Module 10).
 *
 * CPR is a CodePulse-defined metric on a 0-1000 scale. It is NOT an
 * official rating from any competitive-programming platform.
 * Serializable DTOs only: no server-only imports here.
 */

import type { PlatformId } from "./platforms";

export type CprStatus = "ready" | "provisional" | "unavailable";

export interface CprComponentsDto {
  /** 0-1000 or null when no usable rating data exists. */
  contest: number | null;
  /** 0-1000 or null when no solved counts exist. */
  solving: number | null;
  /** 0-1000 or null when no usable activity history exists. */
  consistency: number | null;
}

export interface CprCoverageDto {
  componentsAvailable: Array<"contest" | "solving" | "consistency">;
  connectedPlatforms: PlatformId[];
  platformsWithRating: PlatformId[];
  platformsWithActivity: PlatformId[];
  totalEvents: number;
  historyComplete: boolean;
  notes: string[];
}

export interface CprDto {
  /** 0-1000, or null when no component could be calculated. */
  rating: number | null;
  status: CprStatus;
  /** True when fewer than all three components were available. */
  provisional: boolean;
  components: CprComponentsDto;
  coverage: CprCoverageDto;
  formulaVersion: string;
  calculatedAt: string | null;
  /** True when recalculation stored a new snapshot row. */
  snapshotCreated?: boolean;
}

export interface CprSnapshotDto {
  id: string;
  rating: number;
  /**
   * Component values, or null for components that were unavailable when the
   * snapshot was taken (resolved from stored coverage — raw columns hold 0
   * as a NOT NULL placeholder and must never be read as real scores).
   */
  components: CprComponentsDto;
  formulaVersion: string;
  calculatedAt: string;
}
