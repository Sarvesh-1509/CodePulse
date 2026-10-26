"use client";

import { useMemo } from "react";
import type { ActivityDayDto, ActivityCoverageDto } from "@codepulse/shared";
import { Button } from "@/components/ui/button";
import {
  activitySummary,
  buildHeatmapWeeks,
  formatDayLabel,
} from "@/lib/dashboard";

interface ActivityHeatmapProps {
  days: ActivityDayDto[] | null;
  coverage: ActivityCoverageDto | null;
  totalEvents: number;
  totalActiveDays: number;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  rangeLabel?: string;
}

const LEVEL_CLASSES: Record<number, string> = {
  0: "bg-white/5",
  1: "bg-cyan-950",
  2: "bg-cyan-800",
  3: "bg-cyan-500",
  4: "bg-cyan-300",
};

function cellLabel(date: string, count: number): string {
  const when = formatDayLabel(date);
  return count === 0 ? `${when}: no recorded activity` : `${when}: ${count} ${count === 1 ? "activity" : "activities"}`;
}

export default function ActivityHeatmap({
  days,
  coverage,
  totalEvents,
  totalActiveDays,
  loading,
  error,
  onRetry,
  rangeLabel = "last 12 months",
}: ActivityHeatmapProps) {
  const weeks = useMemo(() => buildHeatmapWeeks(days ?? []), [days]);
  const unavailable = coverage !== null && !coverage.complete;

  return (
    <section aria-label="Activity heatmap" className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Activity</h2>
        <span className="font-mono text-xs text-muted">{rangeLabel}</span>
      </div>

      {loading && <p className="mt-4 text-sm text-muted">Loading activity…</p>}

      {!loading && error && (
        <div className="mt-4">
          <p role="alert" className="text-sm text-red-300">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}

      {!loading && !error && days && (
        <div className="mt-4">
          {days.length === 0 || totalEvents === 0 ? (
            <p className="text-sm text-muted">
              No recorded coding activity yet. Connect a platform and sync it to start your timeline.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto pb-1">
                <div
                  className="grid min-w-max grid-flow-col auto-cols-max gap-[3px]"
                  role="img"
                  aria-label={`Coding activity heatmap. ${activitySummary(totalActiveDays, totalEvents)}`}
                >
                  {weeks.map((week, wi) => (
                    <div key={wi} className="grid grid-rows-7 gap-[3px]">
                      {week.map((cell, di) =>
                        cell === null ? (
                          <span key={di} className="h-3 w-3" aria-hidden="true" />
                        ) : (
                          <span
                            key={di}
                            title={cellLabel(cell.date, cell.count)}
                            aria-label={cellLabel(cell.date, cell.count)}
                            className={`h-3 w-3 rounded-[2px] ${LEVEL_CLASSES[cell.level]} border border-white/5`}
                          />
                        )
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-muted">
                <span>Less</span>
                <span className="flex gap-[3px]" aria-hidden="true">
                  {[0, 1, 2, 3, 4].map((level) => (
                    <span key={level} className={`h-3 w-3 rounded-[2px] ${LEVEL_CLASSES[level]} border border-white/5`} />
                  ))}
                </span>
                <span>More</span>
              </div>
            </>
          )}
          {unavailable && (
            <p className="mt-3 text-xs text-muted">
              Some history is unavailable (see Streaks for details) — empty squares mean “no recorded
              activity”, not “no coding”.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
