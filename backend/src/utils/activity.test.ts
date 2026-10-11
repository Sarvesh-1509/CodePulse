import { describe, expect, it } from "vitest";
import {
  mergeActivityRows,
  type DailyRowInput,
  type EventRowInput,
} from "./activity";

/**
 * Pure unit tests for the calendar/event overlap merge. No database, no
 * network, fully deterministic UTC-day fixtures.
 */

const DAY_A = new Date(Date.UTC(2025, 0, 6, 0, 0, 0)); // Monday
const DAY_B = new Date(Date.UTC(2025, 0, 7, 0, 0, 0)); // Tuesday

function solved(
  linkedAccountId: string,
  at: Date,
  problemId = "two-sum"
): EventRowInput {
  return {
    occurredAt: at,
    platform: "LEETCODE",
    activityType: "PROBLEM_SOLVED",
    problemIdentifier: problemId,
    linkedAccountId,
  };
}

function cfSolved(linkedAccountId: string, at: Date): EventRowInput {
  return {
    occurredAt: at,
    platform: "CODEFORCES",
    activityType: "PROBLEM_SOLVED",
    problemIdentifier: "1A",
    linkedAccountId,
  };
}

function daily(linkedAccountId: string, date: Date, submissions: number): DailyRowInput {
  return { linkedAccountId, platform: "LEETCODE", date, submissions };
}

describe("mergeActivityRows overlap rule", () => {
  it("drops LeetCode per-problem rows on calendar-covered days from counts only", () => {
    const recent = solved("acct-1", new Date(Date.UTC(2025, 0, 6, 15, 30, 0)));
    const { countRows, solvedRows } = mergeActivityRows(
      [recent],
      [daily("acct-1", DAY_A, 5)]
    );
    // The calendar count (5) represents the day; the recent row is not added.
    expect(countRows).toHaveLength(5);
    expect(countRows.every((r) => r.activityType === "SUBMISSION")).toBe(true);
    // ...but the identifiable solve survives in solved sets.
    expect(solvedRows).toHaveLength(1);
    expect(solvedRows[0].problemIdentifier).toBe("two-sum");
  });

  it("keeps LeetCode rows on days without calendar coverage", () => {
    const recent = solved("acct-1", new Date(Date.UTC(2025, 0, 6, 15, 30, 0)));
    const { countRows, solvedRows } = mergeActivityRows(
      [recent],
      [daily("acct-1", DAY_B, 2)]
    );
    // Different day: the event counts normally plus the calendar expansion.
    expect(countRows).toHaveLength(1 + 2);
    expect(solvedRows).toHaveLength(1);
  });

  it("scopes coverage per linked account, never globally", () => {
    const recent = solved("acct-2", new Date(Date.UTC(2025, 0, 6, 15, 30, 0)));
    const { countRows } = mergeActivityRows(
      [recent],
      [daily("acct-1", DAY_A, 5)]
    );
    // Another account's calendar must not suppress this account's rows.
    expect(countRows).toHaveLength(1 + 5);
  });

  it("never drops other platforms or contest rows", () => {
    const cf = cfSolved("acct-cf", new Date(Date.UTC(2025, 0, 6, 12, 0, 0)));
    const contest: EventRowInput = {
      occurredAt: new Date(Date.UTC(2025, 0, 6, 12, 0, 0)),
      platform: "LEETCODE",
      activityType: "CONTEST_PARTICIPATION",
      problemIdentifier: "Weekly 400",
      linkedAccountId: "acct-1",
    };
    const { countRows, solvedRows } = mergeActivityRows(
      [cf, contest],
      [daily("acct-1", DAY_A, 5)]
    );
    expect(countRows).toHaveLength(2 + 5);
    expect(solvedRows.map((r) => r.problemIdentifier)).toEqual(["1A"]);
  });

  it("drops legacy SUBMISSION event rows on covered days", () => {
    const legacy: EventRowInput = {
      occurredAt: new Date(Date.UTC(2025, 0, 6, 0, 0, 0)),
      platform: "LEETCODE",
      activityType: "SUBMISSION",
      problemIdentifier: null,
      linkedAccountId: "acct-1",
    };
    const { countRows } = mergeActivityRows([legacy], [daily("acct-1", DAY_A, 5)]);
    expect(countRows).toHaveLength(5);
  });

  it("expands calendar days as UTC-midnight SUBMISSION rows without identifiers", () => {
    const { countRows, solvedRows } = mergeActivityRows([], [daily("acct-1", DAY_A, 3)]);
    expect(countRows).toHaveLength(3);
    for (const r of countRows) {
      expect(r.activityType).toBe("SUBMISSION");
      expect(r.problemIdentifier).toBeNull();
      expect(r.platform).toBe("LEETCODE");
      expect(r.occurredAt.getTime()).toBe(DAY_A.getTime());
    }
    expect(solvedRows).toEqual([]);
  });

  it("returns rows sorted by instant", () => {
    const { countRows } = mergeActivityRows(
      [solved("acct-1", new Date(Date.UTC(2025, 0, 7, 12, 0, 0)))],
      [daily("acct-1", DAY_A, 1)]
    );
    const times = countRows.map((r) => r.occurredAt.getTime());
    expect(times).toEqual([DAY_A.getTime(), Date.UTC(2025, 0, 7, 12, 0, 0)]);
  });

  it("handles empty inputs without inventing rows", () => {
    expect(mergeActivityRows([], [])).toEqual({ countRows: [], solvedRows: [] });
  });
});
