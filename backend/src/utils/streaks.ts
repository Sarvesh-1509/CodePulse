import { HttpError } from "./httpError";

/**
 * Pure calendar-day streak math (Module 9).
 *
 * Lives in utils (not in any feature module) so both the activity service
 * and the rating service can share it without cross-module imports.
 *
 * Timezone policy (documented, single rule everywhere):
 * - A "day" is a calendar day in ONE effective timezone: the request's
 *   `timezone` query value when present and valid, else the user's stored
 *   `timezone`, else "UTC".
 * - Day keys are derived with Intl.DateTimeFormat in that zone, so DST
 *   transitions are handled by the platform locale database: a 23-hour or
 *   25-hour civil day is still exactly one bucket.
 * - The calculation is anchored at an explicit `now` (default: new Date()),
 *   which makes it fully deterministic and unit-testable.
 * - A streak is "alive" when today has activity, or when today is still
 *   open and yesterday has activity. Documentation states this wherever
 *   the current streak is shown: an alive streak with an inactive today
 *   means "keep it going today".
 */

const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

export function isValidTimezone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function assertValidTimezone(timeZone: string): void {
  if (!isValidTimezone(timeZone)) {
    throw new HttpError(400, "Enter a valid IANA timezone (e.g. UTC, Europe/Berlin).");
  }
}

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  assertValidTimezone(timeZone);
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Calendar-day key `YYYY-MM-DD` for an instant in the given timezone. */
export function toDayKey(instant: Date, timeZone: string): string {
  return formatterFor(timeZone).format(instant);
}

/** Shift a `YYYY-MM-DD` key by whole calendar days (DST-immune: UTC noon math). */
export function shiftDayKey(key: string, deltaDays: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d, 12) + deltaDays * DAY_MS);
  return shifted.toISOString().slice(0, 10);
}

export function isDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const check = new Date(Date.UTC(y, m - 1, d, 12));
  return (
    check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d
  );
}

export interface StreakInput {
  /** Instants with at least one qualifying, verified activity. */
  activeInstants: Iterable<Date>;
  timeZone: string;
  now?: Date;
}

export interface StreakResult {
  current: number;
  longest: number;
  totalActiveDays: number;
  todayActive: boolean;
  timezone: string;
  asOf: string;
}

export function computeStreaks(input: StreakInput): StreakResult {
  const { timeZone } = input;
  assertValidTimezone(timeZone);
  const now = input.now ?? new Date();
  const days = new Set<string>();
  for (const instant of input.activeInstants) {
    if (Number.isNaN(instant.getTime())) continue;
    days.add(toDayKey(instant, timeZone));
  }

  const todayKey = toDayKey(now, timeZone);
  const yesterdayKey = shiftDayKey(todayKey, -1);
  const todayActive = days.has(todayKey);

  let current = 0;
  if (todayActive || days.has(yesterdayKey)) {
    let cursor = todayActive ? todayKey : yesterdayKey;
    while (days.has(cursor)) {
      current += 1;
      cursor = shiftDayKey(cursor, -1);
    }
  }

  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const key of [...days].sort()) {
    if (previous !== null && shiftDayKey(previous, 1) === key) {
      run += 1;
    } else {
      run = 1;
    }
    if (run > longest) longest = run;
    previous = key;
  }

  return {
    current,
    longest,
    totalActiveDays: days.size,
    todayActive,
    timezone: timeZone,
    asOf: now.toISOString(),
  };
}

export interface DayBucketInput {
  occurredAt: Date;
  platform: string;
}

export interface DayBucket {
  date: string;
  count: number;
  platforms: string[];
}

/**
 * Bucket events into per-day totals over an inclusive [startKey, endKey]
 * range. Days without events are included with count 0 — callers decide
 * how to render "no recorded activity" vs "history unavailable" using the
 * separate coverage payload (never invent activity; zeros here mean only
 * "no stored events that day").
 */
export function buildDayBuckets(
  events: DayBucketInput[],
  timeZone: string,
  startKey: string,
  endKey: string
): DayBucket[] {
  assertValidTimezone(timeZone);
  if (!isDayKey(startKey) || !isDayKey(endKey) || startKey > endKey) {
    throw new HttpError(400, "Provide a valid start/end date range (YYYY-MM-DD, start on or before end).");
  }
  const counts = new Map<string, { count: number; platforms: Set<string> }>();
  for (const event of events) {
    if (Number.isNaN(event.occurredAt.getTime())) continue;
    const key = toDayKey(event.occurredAt, timeZone);
    if (key < startKey || key > endKey) continue;
    let bucket = counts.get(key);
    if (!bucket) {
      bucket = { count: 0, platforms: new Set<string>() };
      counts.set(key, bucket);
    }
    bucket.count += 1;
    bucket.platforms.add(event.platform);
  }
  const buckets: DayBucket[] = [];
  for (let key = startKey; ; key = shiftDayKey(key, 1)) {
    const bucket = counts.get(key);
    buckets.push({
      date: key,
      count: bucket?.count ?? 0,
      platforms: bucket ? [...bucket.platforms].sort() : [],
    });
    if (key === endKey) break;
  }
  return buckets;
}
