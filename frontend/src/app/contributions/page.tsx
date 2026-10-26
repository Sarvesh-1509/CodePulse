"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  getActivityDays,
  getActivityStreak,
  getAnalyticsCompare,
  getAnalyticsPlatforms,
  getAnalyticsSummary,
  getAnalyticsTrends,
  getRecentActivity,
  logoutRequest,
  type ActivityDaysData,
  type ActivityStreakData,
  type AnalyticsPlatformsData,
  type AnalyticsTrendsData,
  type AnalyticsSummaryDto,
  type PeriodComparisonDto,
  type RecentActivityData,
} from "@/lib/api";
import ActivityHeatmap from "@/components/activity-heatmap";
import RecentActivity from "@/components/recent-activity";
import { Button } from "@/components/ui/button";
import {
  chartableContributionRows,
  contributionPlatformRows,
  formatContributionDelta,
  mostActivePlatform,
  mostActiveTrendDay,
  PLATFORM_LABELS,
} from "@/lib/contributions";
import type { ActivityCoverageDto } from "@codepulse/shared";

type Period = "30d" | "90d" | "1y";

const PERIOD_LABELS: Record<Period, string> = {
  "30d": "30 days",
  "90d": "90 days",
  "1y": "1 year",
};

function toMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function Section({
  title,
  description,
  loading,
  error,
  onRetry,
  children,
}: {
  title: string;
  description?: string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      {loading && <p className="mt-4 text-sm text-muted">Loading…</p>}
      {!loading && error && (
        <div className="mt-4">
          <p role="alert" className="text-sm text-red-300">{error}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>Retry</Button>
        </div>
      )}
      {!loading && !error && <div className="mt-4">{children}</div>}
    </section>
  );
}

export default function ContributionsPage() {
  const router = useRouter();
  const [period, setPeriod] = useState<Period>("90d");
  const [summary, setSummary] = useState<AnalyticsSummaryDto | null>(null);
  const [comparison, setComparison] = useState<PeriodComparisonDto | null>(null);
  const [platforms, setPlatforms] = useState<AnalyticsPlatformsData | null>(null);
  const [trends, setTrends] = useState<AnalyticsTrendsData | null>(null);
  const [days, setDays] = useState<ActivityDaysData | null>(null);
  const [streakData, setStreakData] = useState<ActivityStreakData | null>(null);
  const [recent, setRecent] = useState<RecentActivityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const query = { range: period };
    const results = await Promise.allSettled([
      getAnalyticsSummary(query),
      getAnalyticsCompare(query),
      getAnalyticsPlatforms(query),
      getAnalyticsTrends(query),
      getActivityDays(period === "30d" ? 30 : period === "90d" ? 90 : 365),
      getActivityStreak(),
      getRecentActivity({ limit: 20 }),
    ]);
    const unauthorized = results.find(
      (result) => result.status === "rejected" && result.reason instanceof ApiError && result.reason.status === 401
    );
    if (unauthorized) {
      router.replace("/login");
      return;
    }
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length === results.length) {
      setError(toMessage(failures[0].reason, "Failed to load contributions."));
    } else {
      const [summaryResult, compareResult, platformsResult, trendsResult, daysResult, streakResult, recentResult] = results;
      if (summaryResult.status === "fulfilled") setSummary(summaryResult.value);
      if (compareResult.status === "fulfilled") setComparison(compareResult.value);
      if (platformsResult.status === "fulfilled") setPlatforms(platformsResult.value);
      if (trendsResult.status === "fulfilled") setTrends(trendsResult.value);
      if (daysResult.status === "fulfilled") setDays(daysResult.value);
      if (streakResult.status === "fulfilled") setStreakData(streakResult.value);
      if (recentResult.status === "fulfilled") setRecent(recentResult.value);
      if (failures.length > 0) setError("Some contribution sections could not be loaded. Retry to refresh them.");
    }
    setLoading(false);
  }, [period, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const coverage: ActivityCoverageDto | null = streakData?.coverage ?? null;
  const platformRows = useMemo(() => contributionPlatformRows(platforms, coverage), [platforms, coverage]);
  const chartRows = useMemo(() => chartableContributionRows(platformRows), [platformRows]);
  const activePlatform = useMemo(() => mostActivePlatform(chartRows), [chartRows]);
  const activeDay = useMemo(() => mostActiveTrendDay(trends), [trends]);
  const coverageNotes = useMemo(
    () => coverage?.platforms.filter((item) => item.history !== "complete" && item.history !== "empty") ?? [],
    [coverage]
  );

  async function onLogout() {
    await logoutRequest().catch(() => undefined);
    router.replace("/login");
  }

  function retry() {
    void load();
  }

  if (loading && !summary && !days) {
    return <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center px-6"><p className="text-muted">Loading contributions…</p></main>;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">CodePulse</Link>
        <nav aria-label="Authenticated navigation" className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild><Link href="/dashboard">Dashboard</Link></Button>
          <Button variant="outline" size="sm" asChild><Link href="/analytics">Analytics</Link></Button>
          <Button variant="outline" size="sm" asChild><Link href="/rooms">Rooms</Link></Button>
          <Button variant="outline" size="sm" asChild><Link href="/leaderboards">Leaderboards</Link></Button>
          <Button variant="outline" size="sm" onClick={onLogout}>Log out</Button>
        </nav>
      </header>

      <section className="py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs text-cyan-300">Verified contribution history</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Personal contributions</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              Understand your coding consistency across connected platforms. Activity events and
              submission activity are counted separately from unique problems solved.
            </p>
          </div>
          <div role="group" aria-label="Contribution period" className="flex gap-2">
            {(Object.keys(PERIOD_LABELS) as Period[]).map((value) => (
              <Button key={value} size="sm" variant={period === value ? "default" : "outline"} aria-pressed={period === value} onClick={() => setPeriod(value)}>
                {PERIOD_LABELS[value]}
              </Button>
            ))}
          </div>
        </div>
        {error && (
          <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-md border border-amber-900 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
            <span>{error}</span><Button variant="outline" size="sm" onClick={retry}>Retry</Button>
          </div>
        )}
      </section>

      <section aria-label="Contribution summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Verified activities", summary?.totals.events ?? "—", "Events, not solved problems"],
          ["Active days", summary?.totals.activeDays ?? "—", "Days with recorded activity"],
          ["Current streak", summary ? `${summary.streak.current} days` : "—", summary?.timezone ?? "Effective timezone"],
          ["Longest streak", summary ? `${summary.streak.longest} days` : "—", "Within selected period"],
        ].map(([label, value, note]) => (
          <div key={label} className="rounded-lg border border-border bg-surface p-4">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-2 font-mono text-2xl text-slate-100">{value}</p>
            <p className="mt-1 text-xs text-muted">{note}</p>
          </div>
        ))}
      </section>

      <div className="mt-4">
        <ActivityHeatmap
          days={days?.days ?? null}
          coverage={coverage}
          totalEvents={summary?.totals.events ?? 0}
          totalActiveDays={summary?.totals.activeDays ?? 0}
          loading={loading && !days}
          error={days ? null : error}
          onRetry={retry}
          rangeLabel={PERIOD_LABELS[period]}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Change from the previous period" description="The equivalent period immediately before the selected range." loading={!comparison && !error} error={comparison ? null : error} onRetry={retry}>
          {comparison && (
            <>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ["Activities", comparison.deltaPct.events],
                  ["Active days", comparison.deltaPct.activeDays],
                  ["Unique solved", comparison.deltaPct.solved],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border border-border px-3 py-3">
                    <p className="text-xs text-muted">{label}</p>
                    <p className="mt-1 font-mono text-lg">{formatContributionDelta(value as number | null)}</p>
                  </div>
                ))}
              </div>
              {comparison.previousNote && <p role="note" className="mt-3 text-xs text-amber-200/90">{comparison.previousNote}</p>}
            </>
          )}
        </Section>

        <Section title="Contribution insights" description="Deterministic observations from verified records only." loading={!summary && !trends && !platforms && !error} error={summary || trends || platforms ? null : error} onRetry={retry}>
          <ul className="space-y-3 text-sm">
            <li><span className="font-medium text-slate-100">Activity trend: </span>
              {comparison?.deltaPct.events === null ? "There is not enough previous history to compare activity." : `${formatContributionDelta(comparison?.deltaPct.events ?? null)} versus the previous period.`}
            </li>
            <li><span className="font-medium text-slate-100">Most active platform: </span>
              {activePlatform ? `${activePlatform.label} with ${activePlatform.events} verified events.` : "No recorded activity in this period."}
            </li>
            <li><span className="font-medium text-slate-100">Most active trend bucket: </span>
              {activeDay ? `${activeDay.start} with ${activeDay.events} events.` : "No supported activity peak is available."}
            </li>
          </ul>
        </Section>
      </div>

      <div className="mt-4">
        <Section title="By platform" description="Counts come from persisted activity records. A dash means the platform does not provide usable dated activity, not zero activity." loading={!platforms && !error} error={platforms ? null : error} onRetry={retry}>
          {platformRows.length === 0 ? (
            <p className="text-sm text-muted">No platforms connected yet. Connect a coding profile from your dashboard to begin.</p>
          ) : (
            <>
              {chartRows.length > 0 && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Platform contribution bars">
                  {chartRows.map((row) => (
                    <div key={row.platform} className="rounded-md border border-border p-3">
                      <p className="truncate text-xs text-muted">{row.label}</p>
                      <p className="mt-1 font-mono text-xl text-cyan-300">{row.events}</p>
                      <div className="mt-2 h-1.5 rounded-full bg-white/5">
                        <div className="h-1.5 rounded-full bg-cyan-400" style={{ width: `${Math.max(4, Math.round((row.events / Math.max(chartRows[0].events, 1)) * 100))}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-sm">
                  <caption className="sr-only">Contribution counts by connected platform</caption>
                  <thead><tr className="border-b border-border text-xs text-muted">
                    <th className="py-2 pr-4 font-medium">Platform</th><th className="py-2 pr-4 font-medium">Activities</th><th className="py-2 pr-4 font-medium">Active days</th><th className="py-2 pr-4 font-medium">Tracked solved</th><th className="py-2 font-medium">Coverage</th>
                  </tr></thead>
                  <tbody>{platformRows.map((row) => (
                    <tr key={row.platform} className="border-b border-border/50 last:border-0">
                      <td className="py-2 pr-4 font-medium">{PLATFORM_LABELS[row.platform]}</td>
                      <td className="py-2 pr-4">{row.history === "unavailable" || row.history === "never-synced" ? "—" : row.events}</td>
                      <td className="py-2 pr-4">{row.history === "unavailable" || row.history === "never-synced" ? "—" : row.activeDays}</td>
                      <td className="py-2 pr-4">{row.solved}</td>
                      <td className="py-2 text-xs text-muted"><span className="capitalize">{row.history.replace("-", " ")}</span>{row.historyNote && <span className="ml-1">· {row.historyNote}</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          )}
          {coverageNotes.length > 0 && (
            <p role="note" className="mt-3 text-xs text-amber-200/90">
              History is uneven across platforms. Missing or partial history is shown explicitly and is never treated as zero coding.
            </p>
          )}
        </Section>
      </div>

      <div className="mt-4">
        <RecentActivity
          items={recent?.items ?? null}
          total={recent?.pagination.total ?? 0}
          loading={!recent && !error}
          error={recent ? null : error}
          loadingMore={false}
          hasMore={false}
          onRetry={retry}
          onLoadMore={() => undefined}
        />
      </div>
    </main>
  );
}
