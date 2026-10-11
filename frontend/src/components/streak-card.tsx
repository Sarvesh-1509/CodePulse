"use client";

import type { ActivityCoverageDto, StreakDto } from "@codepulse/shared";
import { Button } from "@/components/ui/button";
import { activitySummary } from "@/lib/dashboard";

interface StreakCardProps {
  streak: StreakDto | null;
  coverage: ActivityCoverageDto | null;
  totalEvents: number;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export default function StreakCard({ streak, coverage, totalEvents, loading, error, onRetry }: StreakCardProps) {
  return (
    <section aria-label="Coding streaks" className="rounded-lg border border-border bg-surface p-5">
      <h2 className="text-xl font-semibold tracking-tight">Streaks</h2>

      {loading && <p className="mt-4 text-sm text-muted">Loading streaks…</p>}

      {!loading && error && (
        <div className="mt-4">
          <p role="alert" className="text-sm text-red-300">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}

      {!loading && !error && streak && (
        <div className="mt-4">
          <dl className="grid grid-cols-3 gap-2">
            <div className="rounded-md border border-border px-3 py-2">
              <dt className="text-xs text-muted">Current</dt>
              <dd className="mt-0.5 font-mono text-2xl text-slate-100">
                {streak.current}
                <span className="ml-1 font-sans text-xs text-muted">
                  {streak.current === 1 ? "day" : "days"}
                </span>
              </dd>
            </div>
            <div className="rounded-md border border-border px-3 py-2">
              <dt className="text-xs text-muted">Longest</dt>
              <dd className="mt-0.5 font-mono text-2xl text-slate-100">
                {streak.longest}
                <span className="ml-1 font-sans text-xs text-muted">
                  {streak.longest === 1 ? "day" : "days"}
                </span>
              </dd>
            </div>
            <div className="rounded-md border border-border px-3 py-2">
              <dt className="text-xs text-muted">Active days</dt>
              <dd className="mt-0.5 font-mono text-2xl text-slate-100">{streak.totalActiveDays}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-muted" role="status">
            {activitySummary(streak.totalActiveDays, totalEvents)}{" "}
            {streak.current > 0 && !streak.todayActive && "Keep it going today to extend the streak."}
            {streak.current > 0 && streak.todayActive && "Today already counts."}
          </p>
          <p className="mt-1 text-xs text-muted">
            Days use the {streak.timezone} timezone. A day counts with at least one verified activity.
          </p>
          {coverage && !coverage.complete && (
            <div className="mt-3 rounded-md border border-amber-900 bg-amber-950/40 px-3 py-2 text-sm text-amber-300">
              <p>Partial history — streaks reflect verified activity only.</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
                {coverage.platforms
                  .filter((p) => p.history !== "complete" && p.history !== "empty")
                  .map((p) => (
                    <li key={p.platform}>{p.historyNote}</li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
