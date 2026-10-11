import { describe, expect, it } from "vitest";
import {
  buildDayBuckets,
  computeStreaks,
  isDayKey,
  shiftDayKey,
  toDayKey,
} from "./streaks";
import { HttpError } from "./httpError";

function utc(iso: string): Date {
  return new Date(iso);
}

describe("toDayKey / shiftDayKey", () => {
  it("keys UTC instants in the requested timezone", () => {
    // 2026-01-01T00:30Z is still Dec 31 in New York.
    expect(toDayKey(utc("2026-01-01T00:30:00Z"), "UTC")).toBe("2026-01-01");
    expect(toDayKey(utc("2026-01-01T00:30:00Z"), "America/New_York")).toBe("2025-12-31");
  });

  it("shifts across month boundaries without DST drift", () => {
    expect(shiftDayKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDayKey("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("validates day keys", () => {
    expect(isDayKey("2026-01-31")).toBe(true);
    expect(isDayKey("2026-02-30")).toBe(false);
    expect(isDayKey("not-a-date")).toBe(false);
  });

  it("rejects invalid timezones with 400", () => {
    expect(() => toDayKey(utc("2026-01-01T00:00:00Z"), "Mars/Olympus")).toThrow(HttpError);
    try {
      toDayKey(utc("2026-01-01T00:00:00Z"), "Mars/Olympus");
    } catch (err) {
      expect((err as HttpError).status).toBe(400);
    }
  });
});

describe("computeStreaks", () => {
  const NOW = utc("2026-06-15T12:00:00Z");

  it("counts a current streak ending today", () => {
    const r = computeStreaks({
      activeInstants: [utc("2026-06-13T10:00:00Z"), utc("2026-06-14T10:00:00Z"), utc("2026-06-15T10:00:00Z")],
      timeZone: "UTC",
      now: NOW,
    });
    expect(r).toMatchObject({ current: 3, longest: 3, totalActiveDays: 3, todayActive: true });
  });

  it("keeps the streak alive when only yesterday is active", () => {
    const r = computeStreaks({
      activeInstants: [utc("2026-06-13T10:00:00Z"), utc("2026-06-14T10:00:00Z")],
      timeZone: "UTC",
      now: NOW,
    });
    expect(r).toMatchObject({ current: 2, longest: 2, totalActiveDays: 2, todayActive: false });
  });

  it("expires the streak when today and yesterday are both quiet", () => {
    const r = computeStreaks({
      activeInstants: [utc("2026-06-10T10:00:00Z"), utc("2026-06-11T10:00:00Z"), utc("2026-06-12T10:00:00Z")],
      timeZone: "UTC",
      now: NOW,
    });
    expect(r).toMatchObject({ current: 0, longest: 3, totalActiveDays: 3, todayActive: false });
  });

  it("measures the longest run across gaps", () => {
    const r = computeStreaks({
      activeInstants: [
        utc("2026-06-01T10:00:00Z"),
        utc("2026-06-02T10:00:00Z"),
        utc("2026-06-05T10:00:00Z"),
        utc("2026-06-06T10:00:00Z"),
        utc("2026-06-07T10:00:00Z"),
        utc("2026-06-08T10:00:00Z"),
      ],
      timeZone: "UTC",
      now: NOW,
    });
    expect(r.longest).toBe(4);
    expect(r.totalActiveDays).toBe(6);
    expect(r.current).toBe(0);
  });

  it("counts multiple events and platforms on one day only once", () => {
    const r = computeStreaks({
      activeInstants: [
        utc("2026-06-15T01:00:00Z"),
        utc("2026-06-15T12:00:00Z"),
        utc("2026-06-15T23:00:00Z"),
      ],
      timeZone: "UTC",
      now: NOW,
    });
    expect(r).toMatchObject({ current: 1, longest: 1, totalActiveDays: 1, todayActive: true });
  });

  it("handles empty history", () => {
    const r = computeStreaks({ activeInstants: [], timeZone: "UTC", now: NOW });
    expect(r).toMatchObject({ current: 0, longest: 0, totalActiveDays: 0, todayActive: false });
  });

  it("is deterministic for identical inputs", () => {
    const input = {
      activeInstants: [utc("2026-06-14T22:00:00Z"), utc("2026-06-15T01:00:00Z")],
      timeZone: "Asia/Kolkata",
      now: NOW,
    } as const;
    expect(computeStreaks({ ...input, activeInstants: [...input.activeInstants] })).toEqual(
      computeStreaks({ ...input, activeInstants: [...input.activeInstants] })
    );
  });

  it("treats a 23-hour spring-forward day as a single day", () => {
    // US DST 2026-03-08: clocks jump 02:00 -> 03:00 in America/New_York.
    const r = computeStreaks({
      activeInstants: [utc("2026-03-08T06:30:00Z"), utc("2026-03-08T08:30:00Z")],
      timeZone: "America/New_York",
      now: utc("2026-03-08T12:00:00Z"),
    });
    expect(r.totalActiveDays).toBe(1);
    expect(r.current).toBe(1);
  });

  it("treats a 25-hour fall-back day as a single day", () => {
    // US DST ends 2026-11-01: 01:00-02:00 happens twice in America/New_York.
    const r = computeStreaks({
      activeInstants: [utc("2026-11-01T04:30:00Z"), utc("2026-11-01T06:30:00Z")],
      timeZone: "America/New_York",
      now: utc("2026-11-01T12:00:00Z"),
    });
    expect(r.totalActiveDays).toBe(1);
    expect(r.current).toBe(1);
  });

  it("keeps midnight-boundary events on their own calendar days", () => {
    const r = computeStreaks({
      activeInstants: [utc("2026-06-14T23:59:00Z"), utc("2026-06-15T00:01:00Z")],
      timeZone: "UTC",
      now: NOW,
    });
    expect(r.totalActiveDays).toBe(2);
    expect(r.current).toBe(2);
  });
});

describe("buildDayBuckets", () => {
  it("fills gaps with zero-count days inside the range only", () => {
    const buckets = buildDayBuckets(
      [
        { occurredAt: utc("2026-06-13T10:00:00Z"), platform: "CODEFORCES" },
        { occurredAt: utc("2026-06-13T11:00:00Z"), platform: "LEETCODE" },
        { occurredAt: utc("2026-06-10T10:00:00Z"), platform: "CODEFORCES" },
      ],
      "UTC",
      "2026-06-12",
      "2026-06-14"
    );
    expect(buckets.map((b) => [b.date, b.count])).toEqual([
      ["2026-06-12", 0],
      ["2026-06-13", 2],
      ["2026-06-14", 0],
    ]);
    expect(buckets[1].platforms).toEqual(["CODEFORCES", "LEETCODE"]);
  });

  it("rejects inverted or malformed ranges", () => {
    expect(() =>
      buildDayBuckets([], "UTC", "2026-06-14", "2026-06-12")
    ).toThrow(HttpError);
    expect(() => buildDayBuckets([], "UTC", "nope", "2026-06-12")).toThrow(HttpError);
  });
});
