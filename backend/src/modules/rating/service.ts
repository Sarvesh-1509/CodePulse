import type { PlatformId } from "@codepulse/shared";
import { assertDatabaseConfigured, prisma } from "../../db/prisma";
import { computeStreaks, toDayKey } from "../../utils/streaks";
import { fetchUnifiedActivity } from "../../utils/activity";
import {
  ACTIVE_DAYS_WINDOW,
  calculateCpr,
  FORMULA_VERSION,
  type ConsistencyInput,
  type RatingInput,
} from "./formula";
import type { CprDto, CprSnapshotDto } from "@codepulse/shared";

/**
 * CodePulse Rating service (Module 10).
 *
 * Recalculation is lazy and idempotent: every read recomputes from current
 * database state, and a new RatingSnapshot row is inserted ONLY when the
 * canonical inputs hash differs from the latest snapshot. Repeated
 * recalculation with unchanged data returns the existing row (created:false)
 * instead of duplicating it. Sync failures never touch snapshots — this
 * module only reads already-persisted platform data — so previously valid
 * inputs always survive upstream outages.
 *
 * No cross-module imports: activity math comes from utils/streaks, and all
 * reads go through the Prisma singleton directly.
 */

export interface RatingResult {
  rating: CprDto;
  snapshotCreated: boolean;
}

interface GatheredInputs {
  ratings: RatingInput[];
  consistency: ConsistencyInput;
  connectedPlatforms: PlatformId[];
  platformsWithRating: PlatformId[];
  platformsWithActivity: PlatformId[];
  totalEvents: number;
  historyComplete: boolean;
  notes: string[];
}

const ACTIVITY_PLATFORMS: ReadonlySet<string> = new Set(["CODEFORCES", "LEETCODE"]);

async function gatherInputs(
  userId: string,
  timezone: string,
  now: Date
): Promise<GatheredInputs> {
  const accounts = await prisma.linkedAccount.findMany({
    where: { userId },
    include: { stats: true },
    orderBy: { createdAt: "asc" },
  });

  const ratings: RatingInput[] = [];
  const connectedPlatforms: PlatformId[] = [];
  const platformsWithRating: PlatformId[] = [];
  const notes: string[] = [];

  for (const account of accounts) {
    const platform = account.platform as PlatformId;
    connectedPlatforms.push(platform);
    const stats = account.stats;
    const contestRating =
      stats?.contestRating !== null && stats?.contestRating !== undefined
        ? stats.contestRating.toNumber()
        : null;
    const totalSolved = stats?.totalSolved ?? null;
    const contestsAttended = stats?.contestsAttended ?? null;
    if (contestRating !== null) platformsWithRating.push(platform);
    ratings.push({ platform, contestRating, totalSolved, contestsAttended });
  }

  const capable = accounts.filter((a) => ACTIVITY_PLATFORMS.has(a.platform));
  const syncedCapable = capable.filter((a) => a.lastSyncedAt !== null);
  // Merged instants: calendar-covered days enter as UTC-midnight instants
  // (sets dedupe, so recent per-problem rows on those days are represented
  // once); totalEvents counts every merged row, i.e. real submissions.
  const { countRows: unifiedRows } = await fetchUnifiedActivity(userId);
  const totalEvents = unifiedRows.length;

  let consistency: ConsistencyInput;
  let platformsWithActivity: PlatformId[] = [];
  let historyComplete: boolean;
  const windowStart = new Date(now.getTime() - ACTIVE_DAYS_WINDOW * 86_400_000);

  if (capable.length === 0) {
    consistency = { activeDays90: 0, longestStreak: 0, hasHistory: false };
    historyComplete = accounts.length === 0;
    if (accounts.length > 0) {
      notes.push("Connected platforms do not expose dated activity, so consistency cannot be measured.");
    } else {
      notes.push("Connect a coding platform to enable activity tracking.");
    }
  } else if (syncedCapable.length === 0) {
    consistency = { activeDays90: 0, longestStreak: 0, hasHistory: false };
    historyComplete = false;
    notes.push("Activity-capable accounts have never synced, so history is unknown (not zero).");
  } else {
    const events = unifiedRows.map((e) => e.occurredAt);
    const streak = computeStreaks({
      activeInstants: events,
      timeZone: timezone,
      now,
    });
    const activeDays90 = new Set<string>();
    for (const at of events) {
      if (at >= windowStart) activeDays90.add(toDayKey(at, timezone));
    }
    consistency = {
      activeDays90: activeDays90.size,
      longestStreak: streak.longest,
      hasHistory: true,
    };
    const distinctPlatforms = await prisma.activityEvent.groupBy({
      by: ["platform"],
      where: { userId },
    });
    const dailyPlatforms = await prisma.dailyActivity.groupBy({
      by: ["platform"],
      where: { userId },
    });
    platformsWithActivity = [
      ...new Set([
        ...distinctPlatforms.map((r) => r.platform as PlatformId),
        ...dailyPlatforms.map((r) => r.platform as PlatformId),
      ]),
    ];
    const truncated = capable.some((a) => {
      const extra = a.stats?.additionalStats;
      return (
        typeof extra === "object" && extra !== null && !Array.isArray(extra) &&
        (extra as Record<string, unknown>).truncated === true
      );
    });
    const leetcodeConnected = capable.some((a) => a.platform === "LEETCODE");
    historyComplete = !truncated && !leetcodeConnected;
    if (truncated) {
      notes.push("Codeforces history was truncated by upstream limits; early days may be missing.");
    }
    if (leetcodeConnected) {
      notes.push(
        "LeetCode per-problem history covers a recent window; daily activity comes from the full submission calendar."
      );
    }
  }

  return {
    ratings,
    consistency,
    connectedPlatforms,
    platformsWithRating,
    platformsWithActivity,
    totalEvents,
    historyComplete,
    notes,
  };
}

function toCprDto(
  result: ReturnType<typeof calculateCpr>,
  gathered: GatheredInputs,
  calculatedAt: string | null,
  snapshotCreated: boolean
): CprDto {
  const components = (
    ["contest", "solving", "consistency"] as const
  ).filter((k) => result.components[k] !== null) as Array<"contest" | "solving" | "consistency">;
  return {
    rating: result.rating,
    status: result.rating === null ? "unavailable" : result.provisional ? "provisional" : "ready",
    provisional: result.provisional,
    components: result.components,
    coverage: {
      componentsAvailable: components,
      connectedPlatforms: gathered.connectedPlatforms,
      platformsWithRating: gathered.platformsWithRating,
      platformsWithActivity: gathered.platformsWithActivity,
      totalEvents: gathered.totalEvents,
      historyComplete: gathered.historyComplete,
      notes: gathered.notes,
    },
    formulaVersion: FORMULA_VERSION,
    calculatedAt,
    snapshotCreated,
  };
}

export async function getOrRefreshRating(
  userId: string,
  storedTimezone: string | undefined,
  now: Date = new Date()
): Promise<RatingResult> {
  assertDatabaseConfigured();
  const timezone = storedTimezone ?? "UTC";
  const gathered = await gatherInputs(userId, timezone, now);
  const result = calculateCpr({
    ratings: gathered.ratings,
    consistency: gathered.consistency,
    nowIso: now.toISOString(),
  });

  if (result.rating === null) {
    return {
      rating: toCprDto(result, gathered, null, false),
      snapshotCreated: false,
    };
  }

  const latest = await prisma.ratingSnapshot.findFirst({
    where: { userId },
    orderBy: { calculatedAt: "desc" },
  });
  const latestHash =
    latest?.coverageMetadata !== null &&
    typeof latest?.coverageMetadata === "object" &&
    !Array.isArray(latest?.coverageMetadata)
      ? ((latest.coverageMetadata as Record<string, unknown>).inputsHash as string | undefined)
      : undefined;

  if (latest && latestHash === result.inputsHash && latest.formulaVersion === FORMULA_VERSION) {
    return {
      rating: toCprDto(result, gathered, latest.calculatedAt.toISOString(), false),
      snapshotCreated: false,
    };
  }

  const created = await prisma.ratingSnapshot.create({
    data: {
      userId,
      rating: result.rating,
      contestScore: result.components.contest ?? 0,
      problemSolvingScore: result.components.solving ?? 0,
      consistencyScore: result.components.consistency ?? 0,
      formulaVersion: FORMULA_VERSION,
      coverageMetadata: {
        coverage: {
          componentsAvailable: (Object.keys(result.components) as Array<"contest" | "solving" | "consistency">).filter(
            (k) => result.components[k] !== null
          ),
          connectedPlatforms: gathered.connectedPlatforms,
          platformsWithRating: gathered.platformsWithRating,
          platformsWithActivity: gathered.platformsWithActivity,
          totalEvents: gathered.totalEvents,
          historyComplete: gathered.historyComplete,
          notes: gathered.notes,
        },
        inputsHash: result.inputsHash,
      },
    },
  });
  return {
    rating: toCprDto(result, gathered, created.calculatedAt.toISOString(), true),
    snapshotCreated: true,
  };
}

export async function getRatingHistory(
  userId: string,
  limit: number
): Promise<CprSnapshotDto[]> {
  assertDatabaseConfigured();
  const rows = await prisma.ratingSnapshot.findMany({
    where: { userId },
    orderBy: { calculatedAt: "desc" },
    take: limit,
  });
  return rows.map((r) => {
    const meta =
      r.coverageMetadata !== null &&
      typeof r.coverageMetadata === "object" &&
      !Array.isArray(r.coverageMetadata)
        ? (r.coverageMetadata as Record<string, unknown>)
        : null;
    const available = Array.isArray((meta?.coverage as Record<string, unknown> | undefined)?.componentsAvailable)
      ? ((meta?.coverage as Record<string, unknown>).componentsAvailable as string[])
      : ["contest", "solving", "consistency"];
    const component = (name: "contest" | "solving" | "consistency", stored: number): number | null =>
      available.includes(name) ? stored : null;
    return {
      id: r.id,
      rating: r.rating.toNumber(),
      components: {
        contest: component("contest", r.contestScore.toNumber()),
        solving: component("solving", r.problemSolvingScore.toNumber()),
        consistency: component("consistency", r.consistencyScore.toNumber()),
      },
      formulaVersion: r.formulaVersion,
      calculatedAt: r.calculatedAt.toISOString(),
    };
  });
}
