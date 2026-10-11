import type { ActivityDayDto, ActivityTotalsDto, PlatformId } from "@codepulse/shared";

/**
 * Pure dashboard helpers (Module 11). No DOM, no fetch: safe to unit test
 * in the node environment and safe to render from client components.
 */

export interface HeatmapCell {
  date: string;
  count: number;
  /** 0 = no recorded activity; 1-4 = quartiles of the observed max. */
  level: 0 | 1 | 2 | 3 | 4;
}

/** Sunday-first week columns, GitHub-style. Empty cells are null. */
export type HeatmapWeek = Array<HeatmapCell | null>;

/** 0 for empty days; otherwise the quartile (1-4) of the observed max. */
export function intensityLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function parseDayKey(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/**
 * Lay trailing day buckets into Sunday-first week columns. Days outside the
 * input range render as null cells (not as zero-activity days) so the grid
 * never invents history.
 */
export function buildHeatmapWeeks(days: ActivityDayDto[]): HeatmapWeek[] {
  if (days.length === 0) return [];
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : 1));
  const max = sorted.reduce((m, d) => Math.max(m, d.count), 0);
  const seen = new Set<string>();
  const weeks: HeatmapWeek[] = [];
  let week: HeatmapWeek = [];
  for (const day of sorted) {
    // Defensive: the API never sends duplicates or unordered days.
    if (seen.has(day.date)) continue;
    seen.add(day.date);
    const weekday = parseDayKey(day.date).getUTCDay();
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
    if (week.length > weekday) {
      // A gap crossed a week boundary: close this week with nulls first so
      // later days land in the correct weekday columns.
      while (week.length < 7) week.push(null);
      weeks.push(week);
      week = [];
    }
    while (week.length < weekday) week.push(null);
    week.push({
      date: day.date,
      count: day.count,
      level: intensityLevel(day.count, max),
    });
  }
  while (week.length > 0 && week.length < 7) week.push(null);
  if (week.length > 0) weeks.push(week);
  return weeks;
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function formatRating(rating: number | null): string {
  if (rating === null) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(rating);
}

export function formatDayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Short human summary for screen readers and tooltips. */
export function activitySummary(totalActiveDays: number, totalEvents: number): string {
  if (totalActiveDays === 0) return "No recorded coding activity yet.";
  const days = totalActiveDays === 1 ? "1 active day" : `${totalActiveDays} active days`;
  const events = totalEvents === 1 ? "1 activity" : `${formatCount(totalEvents)} activities`;
  return `${days}, ${events} total.`;
}

export interface SolvedChartRow {
  platform: PlatformId;
  solved: number;
  /** Official platform-reported lifetime total, if the platform gave one. */
  official: number | null;
}

/**
 * Rows for the "Unique problems solved" chart: distinct solved problems per
 * platform, sorted descending. Platforms without any solved rows are absent
 * (never a fabricated zero). Each row also carries the platform's official
 * lifetime total when reported, so the UI can distinguish individually
 * tracked solves from the authoritative count. Pure and unit-tested; the
 * component only maps labels and renders.
 */
export function toSolvedChartData(totals: ActivityTotalsDto | null): SolvedChartRow[] {
  if (!totals) return [];
  const official = totals.officialSolvedByPlatform ?? {};
  return (Object.entries(totals.uniqueSolvedByPlatform) as Array<[PlatformId, number]>)
    .filter((entry): entry is [PlatformId, number] => typeof entry[1] === "number")
    .map(([platform, solved]) => ({
      platform,
      solved,
      official: typeof official[platform] === "number" ? official[platform] as number : null,
    }))
    .sort((a, b) => b.solved - a.solved);
}
