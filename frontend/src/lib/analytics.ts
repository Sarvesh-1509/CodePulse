import type { AnalyticsRange } from "@codepulse/shared";

/**
 * Pure analytics helpers (Module 12). No DOM, no fetch: safe to unit test
 * in the node environment and safe to use from client components.
 *
 * Mirrors the backend contract in backend/src/modules/analytics/schemas.ts:
 * a request carries EITHER a preset range OR an explicit start/end pair
 * (never both, never a half pair). Custom spans cap at 366 days and may
 * not end in the future. The backend re-validates everything; these
 * helpers only give immediate feedback and build correct query strings.
 */

export const ANALYTICS_PRESETS: readonly AnalyticsRange[] = ["7d", "30d", "90d", "1y"];

export const PRESET_LABELS: Record<AnalyticsRange, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  "1y": "1 year",
};

export interface AnalyticsSelection {
  mode: "preset" | "custom";
  preset: AnalyticsRange;
  start: string;
  end: string;
  timezone: string;
}

export const DEFAULT_SELECTION: AnalyticsSelection = {
  mode: "preset",
  preset: "30d",
  start: "",
  end: "",
  timezone: "",
};

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRealCalendarDate(value: string): boolean {
  if (!DAY_KEY_PATTERN.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const check = new Date(Date.UTC(y, m - 1, d, 12));
  return (
    check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d
  );
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Validate a custom start/end pair. Returns an error message, or null when
 * the pair is usable. Empty strings are reported as missing (not valid).
 */
export function validateCustomRange(start: string, end: string): string | null {
  if (start === "" || end === "") {
    return "Custom ranges need both a start and an end date.";
  }
  if (!isRealCalendarDate(start) || !isRealCalendarDate(end)) {
    return "Use real calendar dates in YYYY-MM-DD format.";
  }
  if (start > end) {
    return "The start date must be on or before the end date.";
  }
  const spanDays =
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;
  if (spanDays > 366) {
    return "Custom ranges cover at most 366 days.";
  }
  if (end > todayKey()) {
    return "The end date cannot be in the future.";
  }
  return null;
}

/** Validate a selection before any request is sent. Null means sendable. */
export function validateSelection(selection: AnalyticsSelection): string | null {
  if (selection.mode === "preset") return null;
  return validateCustomRange(selection.start, selection.end);
}

export interface AnalyticsQuery {
  range?: AnalyticsRange;
  start?: string;
  end?: string;
  timezone?: string;
}

/** Selection → query object. Never mixes preset with start/end. */
export function toQuery(selection: AnalyticsSelection): AnalyticsQuery {
  const timezone = selection.timezone.trim() === "" ? undefined : selection.timezone.trim();
  if (selection.mode === "preset") {
    return timezone === undefined ? { range: selection.preset } : { range: selection.preset, timezone };
  }
  const query: AnalyticsQuery = { start: selection.start, end: selection.end };
  if (timezone !== undefined) query.timezone = timezone;
  return query;
}

/** Query object → URL query string (leading `?`, or "" when empty). */
export function toQueryString(query: AnalyticsQuery): string {
  const params = new URLSearchParams();
  if (query.range !== undefined) params.set("range", query.range);
  if (query.start !== undefined) params.set("start", query.start);
  if (query.end !== undefined) params.set("end", query.end);
  if (query.timezone !== undefined) params.set("timezone", query.timezone);
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

/**
 * Format a delta percentage for the comparison table. Null (no previous
 * data, or a zero denominator) renders as "n/a" — never as 0% or ∞%.
 */
export function formatDelta(delta: number | null): string {
  if (delta === null || Number.isNaN(delta)) return "n/a";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta}%`;
}

/** Compact x-axis label: daily/weekly buckets show MM-DD, monthly YYYY-MM. */
export function shortBucketLabel(bucket: { start: string; end: string }): string {
  if (bucket.start.length === 7) return bucket.start;
  return bucket.start.slice(5);
}

/** Full bucket span label for tooltips ("Jun 1 – Jun 7" style stays ISO). */
export function bucketSpanLabel(bucket: { start: string; end: string }): string {
  if (bucket.start.length === 7) return bucket.start;
  return bucket.start === bucket.end ? bucket.start : `${bucket.start} – ${bucket.end}`;
}
