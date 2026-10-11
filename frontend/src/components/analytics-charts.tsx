"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ActivityCoverageDto, ActivityDayDto, ActivityTotalsDto } from "@codepulse/shared";
import { toSolvedChartData } from "@/lib/dashboard";

interface AnalyticsChartsProps {
  days: ActivityDayDto[] | null;
  totals: ActivityTotalsDto | null;
  coverage: ActivityCoverageDto | null;
  loading: boolean;
}

const PLATFORM_LABELS: Record<string, string> = {
  CODEFORCES: "Codeforces",
  LEETCODE: "LeetCode",
  CODECHEF: "CodeChef",
  GEEKSFORGEEKS: "GFG",
  HACKERRANK: "HackerRank",
};

const TICK_STYLE = { fill: "#8b98a5", fontSize: 11 } as const;
const TOOLTIP_STYLE = {
  backgroundColor: "#11181f",
  border: "1px solid #1f2a33",
  borderRadius: 8,
  fontSize: 12,
} as const;

export default function AnalyticsCharts({ days, totals, coverage, loading }: AnalyticsChartsProps) {
  const last30 = useMemo(() => {
    if (!days || days.length === 0) return [];
    return days.slice(-30).map((d) => ({
      date: d.date.slice(5),
      full: d.date,
      activities: d.count,
    }));
  }, [days]);

  const solvedRows = useMemo(() => toSolvedChartData(totals), [totals]);
  const byPlatform = useMemo(
    () =>
      solvedRows.map((row) => ({
        platform: PLATFORM_LABELS[row.platform] ?? row.platform,
        solved: row.solved,
        official: row.official,
      })),
    [solvedRows]
  );

  // Platforms whose imported history is known-incomplete: their bars are
  // lower bounds, not lifetime totals. Never invent the missing part.
  const partialNotes = useMemo(() => {
    if (!coverage) return [];
    return coverage.platforms
      .filter((p) => p.connected && p.history !== "complete" && p.history !== "empty")
      .map((p) => p.historyNote)
      .filter((note, index, all) => note.length > 0 && all.indexOf(note) === index);
  }, [coverage]);

  const hasTrend = last30.some((d) => d.activities > 0);

  return (
    <section aria-label="Progress analytics" className="rounded-lg border border-border bg-surface p-5">
      <h2 className="text-xl font-semibold tracking-tight">Progress</h2>

      {loading && <p className="mt-4 text-sm text-muted">Loading analytics…</p>}

      {!loading && (
        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium text-slate-200">Daily activity · last 30 days</h3>
            {!hasTrend ? (
              <p className="mt-2 text-sm text-muted">No activity in the last 30 days.</p>
            ) : (
              <div className="mt-2 h-48" role="img" aria-label="Bar chart of daily activity over the last 30 days">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={last30} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                    <CartesianGrid stroke="#1f2a33" vertical={false} />
                    <XAxis dataKey="date" tick={TICK_STYLE} interval={6} />
                    <YAxis tick={TICK_STYLE} allowDecimals={false} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "#e6edf3" }} />
                    <Bar dataKey="activities" fill="#22d3ee" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
          <div>
            <h3 className="text-sm font-medium text-slate-200">Unique problems solved</h3>
            <p className="mt-1 text-xs text-muted">
              Individually tracked accepted solutions, deduplicated per problem. Official
              platform totals can be higher where history is windowed — see the tooltip.
            </p>
            {byPlatform.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No solved problems recorded yet.</p>
            ) : (
              <div className="mt-2 h-48" role="img" aria-label="Bar chart of unique problems solved by platform">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={byPlatform}
                    layout="vertical"
                    margin={{ top: 4, right: 12, bottom: 0, left: 8 }}
                  >
                    <CartesianGrid stroke="#1f2a33" horizontal={false} />
                    <XAxis type="number" tick={TICK_STYLE} allowDecimals={false} />
                    <YAxis type="category" dataKey="platform" tick={TICK_STYLE} width={80} />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      labelStyle={{ color: "#e6edf3" }}
                      formatter={(value, _name, entry) => {
                        const official = (entry?.payload as { official?: number | null } | undefined)
                          ?.official;
                        return [
                          official !== undefined && official !== null && official !== value
                            ? `${value} tracked · ${official} official total`
                            : `${value} problems`,
                          "Solved",
                        ];
                      }}
                    />
                    <Bar dataKey="solved" fill="#22d3ee" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {partialNotes.length > 0 && (
              <div className="mt-3 rounded-md border border-amber-900 bg-amber-950/40 px-3 py-2" role="note">
                <p className="text-xs font-medium text-amber-300">Uneven history coverage</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-amber-200/90">
                  {partialNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
