import { createHash } from "node:crypto";
import type { PlatformId } from "@codepulse/shared";

/**
 * CodePulse Rating formula v1.0.0 (Module 10) — pure and deterministic.
 *
 * Fully specified in docs/cpr-formula.md. This module contains no I/O:
 * callers gather inputs from the database, this computes numbers. Same
 * inputs always yield same outputs (asserted by fixed-fixture tests).
 */

import { CURRENT_CPR_FORMULA_VERSION } from "../../utils/cpr";

/** Re-exported from utils/cpr so leaderboard code never imports this module. */
export const FORMULA_VERSION = CURRENT_CPR_FORMULA_VERSION;

/** Realistic per-platform rating ceilings used for normalization. */
export const RATING_CEILINGS: Readonly<Record<string, number>> = {
  CODEFORCES: 4000,
  LEETCODE: 3500,
  CODECHEF: 4000,
};

export const SOLVING_CAP = 10000;
export const CONTEST_PARTICIPATION_CAP = 50;
export const ACTIVE_DAYS_WINDOW = 90;
export const ACTIVE_DAYS_TARGET = 45;
export const STREAK_TARGET = 30;

const WEIGHTS = { contest: 0.4, solving: 0.35, consistency: 0.25 } as const;
type ComponentName = keyof typeof WEIGHTS;

export interface RatingInput {
  platform: PlatformId;
  /** Native contest rating, or null when unavailable. */
  contestRating: number | null;
  /** Solved total, or null when the platform reports none. */
  totalSolved: number | null;
  /** Attended contests, or null when the platform reports none. */
  contestsAttended: number | null;
}

export interface ConsistencyInput {
  /** Distinct active days in the trailing window. */
  activeDays90: number;
  /** All-time longest verified run. */
  longestStreak: number;
  /** False when no usable activity history exists at all. */
  hasHistory: boolean;
}

export interface FormulaInputs {
  ratings: RatingInput[];
  consistency: ConsistencyInput;
  nowIso: string;
}

export interface FormulaResult {
  rating: number | null;
  components: { contest: number | null; solving: number | null; consistency: number | null };
  available: ComponentName[];
  provisional: boolean;
  inputsHash: string;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

function contestComponent(ratings: RatingInput[]): number | null {
  const normalized: number[] = [];
  let contests = 0;
  let hasContests = false;
  for (const r of ratings) {
    if (r.contestRating !== null && Number.isFinite(r.contestRating)) {
      const ceiling = RATING_CEILINGS[r.platform] ?? 4000;
      normalized.push(clamp01(r.contestRating / ceiling));
    }
    if (r.contestsAttended !== null && Number.isFinite(r.contestsAttended)) {
      hasContests = true;
      contests += Math.max(0, r.contestsAttended);
    }
  }
  if (normalized.length === 0) return null;
  const mean = normalized.reduce((a, b) => a + b, 0) / normalized.length;
  const participation = hasContests ? Math.min(1, contests / CONTEST_PARTICIPATION_CAP) : 0;
  return round2(1000 * (0.75 * mean + 0.25 * participation));
}

function solvingComponent(ratings: RatingInput[]): number | null {
  let total = 0;
  let any = false;
  for (const r of ratings) {
    if (r.totalSolved !== null && Number.isFinite(r.totalSolved)) {
      any = true;
      total += Math.max(0, r.totalSolved);
    }
  }
  if (!any) return null;
  return round2((1000 * Math.log10(1 + total)) / Math.log10(1 + SOLVING_CAP));
}

function consistencyComponent(input: ConsistencyInput): number | null {
  if (!input.hasHistory) return null;
  const days = clamp01(input.activeDays90 / ACTIVE_DAYS_TARGET);
  const streak = clamp01(input.longestStreak / STREAK_TARGET);
  return round2(1000 * (0.6 * days + 0.4 * streak));
}

function canonicalInputs(args: FormulaInputs): string {
  const ratings = [...args.ratings]
    .map((r) => [
      r.platform,
      r.contestRating !== null ? round2(r.contestRating) : null,
      r.totalSolved,
      r.contestsAttended,
    ] as const)
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return JSON.stringify({
    v: FORMULA_VERSION,
    ratings,
    consistency: {
      activeDays90: args.consistency.activeDays90,
      longestStreak: args.consistency.longestStreak,
      hasHistory: args.consistency.hasHistory,
    },
  });
}

export function hashInputs(args: FormulaInputs): string {
  return createHash("sha256").update(canonicalInputs(args)).digest("hex");
}

export function calculateCpr(args: FormulaInputs): FormulaResult {
  const components = {
    contest: contestComponent(args.ratings),
    solving: solvingComponent(args.ratings),
    consistency: consistencyComponent(args.consistency),
  };
  const available = (Object.keys(components) as ComponentName[]).filter(
    (k) => components[k] !== null
  );
  if (available.length === 0) {
    return {
      rating: null,
      components,
      available,
      provisional: true,
      inputsHash: hashInputs(args),
    };
  }
  const weightSum = available.reduce((sum, k) => sum + WEIGHTS[k], 0);
  const rating = round2(
    available.reduce((sum, k) => sum + (components[k] as number) * WEIGHTS[k], 0) / weightSum
  );
  return {
    rating: Math.min(1000, Math.max(0, rating)),
    components,
    available,
    provisional: available.length < 3,
    inputsHash: hashInputs(args),
  };
}
