"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ApiError,
  getAnalyticsCompare,
  getAnalyticsContests,
  getAnalyticsPlatforms,
  getAnalyticsRatings,
  getAnalyticsSummary,
  getAnalyticsTrends,
  logoutRequest,
  type AnalyticsContestsData,
  type AnalyticsPlatformsData,
  type AnalyticsRatingsData,
  type AnalyticsSummaryDto,
  type AnalyticsTrendsData,
  type PeriodComparisonDto,
} from "@/lib/api";
import {
  ANALYTICS_PRESETS,
  DEFAULT_SELECTION,
  PRESET_LABELS,
  bucketSpanLabel,
  formatDelta,
  shortBucketLabel,
  toQuery,
  validateSelection,
  type AnalyticsSelection,
} from "@/lib/analytics";
import { formatRating } from "@/lib/dashboard";
import { Button } from "@/components/ui/button";

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none";

const TICK_STYLE = { fill: "#8b98a5", fontSize: 11 } as const;
const TOOLTIP_STYLE = {
  backgroundColor: "#11181f",
  border: "1px solid #1f2a33",
  borderRadius: 8,
  fontSize: 12,
} as const;

const PLATFORM_LABELS: Record<string, string> = {
  CODEFORCES: "Codeforces",
  LEETCODE: "LeetCode",
  CODECHEF: "CodeChef",
  GEEKSFORGEEKS: "GFG",
  HACKERRANK: "HackerRank",
};

const CONTEST_PAGE_SIZE = 10;

function toMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function SectionCard({
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
          <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
      {!loading && !error && <div className="mt-4">{children}</div>}
    </section>
  );
}

function CoverageNotes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="mt-3 rounded-md border border-amber-900 bg-amber-950/40 px-3 py-2" role="note">
      <p className="text-xs font-medium text-amber-300">Incomplete history</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-amber-200/90">
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  );
}

interface SectionState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

function initialSection<T>(): SectionState<T> {
  return { data: null, error: null, loading: true };
}

export default function AnalyticsPage() {
  const router = useRouter();
  const [draft, setDraft] = useState<AnalyticsSelection>(DEFAULT_SELECTION);
  const [applied, setApplied] = useState<AnalyticsSelection>(DEFAULT_SELECTION);
  const [formError, setFormError] = useState<string | null>(null);

  const [summary, setSummary] = useState<SectionState<AnalyticsSummaryDto>>(initialSection);
  const [trends, setTrends] = useState<SectionState<AnalyticsTrendsData>>(initialSection);
  const [compare, setCompare] = useState<SectionState<PeriodComparisonDto>>(initialSection);
  const [platforms, setPlatforms] = useState<SectionState<AnalyticsPlatformsData>>(initialSection);
  const [ratings, setRatings] = useState<SectionState<AnalyticsRatingsData>>(initialSection);
  const [contests, setContests] = useState<SectionState<AnalyticsContestsData>>(initialSection);
  const [contestOffset, setContestOffset] = useState(0);

  const redirectIfUnauthorized = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return true;
      }
      return false;
    },
    [router]
  );

  const loadSummary = useCallback(
    async (selection: AnalyticsSelection) => {
      setSummary((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await getAnalyticsSummary(toQuery(selection));
        setSummary({ data, error: null, loading: false });
      } catch (err) {
        if (!redirectIfUnauthorized(err))
          setSummary({ data: null, error: toMessage(err, "Failed to load summary."), loading: false });
      }
    },
    [redirectIfUnauthorized]
  );

  const loadTrends = useCallback(
    async (selection: AnalyticsSelection) => {
      setTrends((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await getAnalyticsTrends(toQuery(selection));
        setTrends({ data, error: null, loading: false });
      } catch (err) {
        if (!redirectIfUnauthorized(err))
          setTrends({ data: null, error: toMessage(err, "Failed to load trends."), loading: false });
      }
    },
    [redirectIfUnauthorized]
  );

  const loadCompare = useCallback(
    async (selection: AnalyticsSelection) => {
      setCompare((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await getAnalyticsCompare(toQuery(selection));
        setCompare({ data, error: null, loading: false });
      } catch (err) {
        if (!redirectIfUnauthorized(err))
          setCompare({ data: null, error: toMessage(err, "Failed to load comparison."), loading: false });
      }
    },
    [redirectIfUnauthorized]
  );

  const loadPlatforms = useCallback(
    async (selection: AnalyticsSelection) => {
      setPlatforms((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await getAnalyticsPlatforms(toQuery(selection));
        setPlatforms({ data, error: null, loading: false });
      } catch (err) {
        if (!redirectIfUnauthorized(err))
          setPlatforms({ data: null, error: toMessage(err, "Failed to load platforms."), loading: false });
      }
    },
    [redirectIfUnauthorized]
  );

  const loadRatings = useCallback(async () => {
    setRatings((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await getAnalyticsRatings();
      setRatings({ data, error: null, loading: false });
    } catch (err) {
      if (!redirectIfUnauthorized(err))
        setRatings({ data: null, error: toMessage(err, "Failed to load ratings."), loading: false });
    }
  }, [redirectIfUnauthorized]);

  const loadContests = useCallback(
    async (offset: number) => {
      setContests((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await getAnalyticsContests({ limit: CONTEST_PAGE_SIZE, offset });
        setContests({ data, error: null, loading: false });
      } catch (err) {
        if (!redirectIfUnauthorized(err))
          setContests({ data: null, error: toMessage(err, "Failed to load contests."), loading: false });
      }
    },
    [redirectIfUnauthorized]
  );

  const loadAll = useCallback(
    (selection: AnalyticsSelection, offset: number) => {
      // Independent requests run in parallel; each section degrades on its
      // own so one failing call never blocks the rest of the page.
      void loadSummary(selection);
      void loadTrends(selection);
      void loadCompare(selection);
      void loadPlatforms(selection);
      void loadRatings();
      void loadContests(offset);
    },
    [loadSummary, loadTrends, loadCompare, loadPlatforms, loadRatings, loadContests]
  );

  useEffect(() => {
    loadAll(applied, contestOffset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied]);

  function applyPreset(preset: AnalyticsSelection["preset"]) {
    const next: AnalyticsSelection = { ...draft, mode: "preset", preset };
    setDraft(next);
    setFormError(null);
    setContestOffset(0);
    setApplied(next);
  }

  function applyCustom() {
    const next: AnalyticsSelection = { ...draft, mode: "custom" };
    const problem = validateSelection(next);
    if (problem) {
      setFormError(problem);
      return;
    }
    setFormError(null);
    setContestOffset(0);
    setApplied(next);
  }

  async function onLogout() {
    await logoutRequest().catch(() => undefined);
    router.replace("/login");
  }

  const trendChartData =
    trends.data?.buckets.map((b) => ({
      label: shortBucketLabel(b),
      full: bucketSpanLabel(b),
      Events: b.events,
      Solved: b.solved,
    })) ?? [];

  const hasTrend = trendChartData.some((d) => d.Events > 0);

  const cprChartData =
    ratings.data?.cpr.map((s) => ({
      date: s.calculatedAt.slice(0, 10),
      Rating: s.rating,
    })) ?? [];

  const contestTotal = contests.data?.pagination.total ?? 0;
  const contestPageCount = Math.max(1, Math.ceil(contestTotal / CONTEST_PAGE_SIZE));
  const contestPage = Math.floor(contestOffset / CONTEST_PAGE_SIZE) + 1;

  function changeContestPage(nextOffset: number) {
    setContestOffset(nextOffset);
    void loadContests(nextOffset);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-10">
      <header className="flex items-center justify-between border-b border-border pb-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          CodePulse
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/contributions">Contributions</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard">Dashboard</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/rooms">Rooms</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/leaderboards">Leaderboards</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={onLogout}>
            Log out
          </Button>
        </div>
      </header>

      <section className="py-8">
        <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
        <p className="mt-1 text-sm text-muted">
          Progress over time from verified synced data. Ranges with no recorded history show
          zeros with an explicit note — history is never invented or backfilled.
        </p>
      </section>

      <section aria-label="Date range" className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-medium text-slate-200">Date range</h2>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Range presets">
          {ANALYTICS_PRESETS.map((preset) => {
            const active = draft.mode === "preset" && draft.preset === preset;
            return (
              <Button
                key={preset}
                variant={active ? "default" : "outline"}
                size="sm"
                aria-pressed={active}
                onClick={() => applyPreset(preset)}
              >
                {PRESET_LABELS[preset]}
              </Button>
            );
          })}
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="analytics-start" className="mb-1 block text-xs text-slate-200">
              Start date
            </label>
            <input
              id="analytics-start"
              type="date"
              value={draft.start}
              max={draft.end || undefined}
              onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="analytics-end" className="mb-1 block text-xs text-slate-200">
              End date
            </label>
            <input
              id="analytics-end"
              type="date"
              value={draft.end}
              min={draft.start || undefined}
              onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="analytics-timezone" className="mb-1 block text-xs text-slate-200">
              Timezone (optional)
            </label>
            <input
              id="analytics-timezone"
              value={draft.timezone}
              onChange={(e) => setDraft((d) => ({ ...d, timezone: e.target.value }))}
              placeholder="UTC"
              className={inputClass}
            />
          </div>
          <div className="flex items-end">
            <Button variant="secondary" onClick={applyCustom}>
              Apply custom range
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">
          Custom ranges cover at most 366 days and cannot end in the future. Leave the timezone
          blank to use your profile timezone.
        </p>
        {formError && (
          <p role="alert" className="mt-2 text-sm text-red-300">
            {formError}
          </p>
        )}
      </section>

      <div className="mt-4">
        <SectionCard
          title="Overall progress"
          description={
            summary.data
              ? `Verified activity from ${summary.data.range.start} to ${summary.data.range.end} (${summary.data.timezone}).`
              : "Verified totals for the selected range."
          }
          loading={summary.loading}
          error={summary.error}
          onRetry={() => void loadSummary(applied)}
        >
          {summary.data &&
            (summary.data.totals.events === 0 ? (
              <p className="text-sm text-muted">
                No recorded activity in this range. Connect a platform and sync to start building
                history.
              </p>
            ) : (
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Coding events", String(summary.data.totals.events)],
                  ["Active days", String(summary.data.totals.activeDays)],
                  ["Unique solved", String(summary.data.totals.solved)],
                  ["Contest entries", String(summary.data.totals.contests)],
                  ["All-time solved", String(summary.data.totals.totalSolvedAllTime)],
                  ["Current streak", `${summary.data.streak.current}d`],
                  ["Longest streak", `${summary.data.streak.longest}d`],
                  [
                    "CPR",
                    summary.data.cpr.rating === null ? "—" : formatRating(summary.data.cpr.rating),
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border border-border px-3 py-2">
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className="mt-1 text-xl font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
            ))}
          {summary.data && summary.data.cpr.rating === null && (
            <p className="mt-3 text-xs text-muted">
              No CodePulse Rating snapshot yet — recalculate your rating from the dashboard once a
              platform is connected.
            </p>
          )}
          {summary.data && <CoverageNotes notes={summary.data.coverageNotes} />}
        </SectionCard>
      </div>

      <div className="mt-4">
        <SectionCard
          title="Activity trends"
          description={
            trends.data
              ? `${trends.data.kind === "daily" ? "Daily" : trends.data.kind === "weekly" ? "Weekly (7-day chunks from the range start)" : "Monthly"} buckets, ${trends.data.range.start} to ${trends.data.range.end}. Events include LeetCode calendar submission counts; Solved counts only individually identifiable accepted submissions.`
              : "Daily, weekly, or monthly buckets depending on the span."
          }
          loading={trends.loading}
          error={trends.error}
          onRetry={() => void loadTrends(applied)}
        >
          {!hasTrend ? (
            <p className="text-sm text-muted">No activity in this range.</p>
          ) : (
            <div className="h-64" role="img" aria-label="Chart of coding events and solved problems per bucket">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendChartData} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
                  <CartesianGrid stroke="#1f2a33" vertical={false} />
                  <XAxis dataKey="label" tick={TICK_STYLE} interval="preserveStartEnd" />
                  <YAxis tick={TICK_STYLE} allowDecimals={false} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    labelStyle={{ color: "#e6edf3" }}
                    labelFormatter={(_, payload) =>
                      payload?.[0]?.payload?.full ?? ""
                    }
                  />
                  <Legend />
                  <Bar dataKey="Events" fill="#22d3ee" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Solved" fill="#a78bfa" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-4">
        <SectionCard
          title="Platform breakdown"
          description="Only connected platforms are listed — a missing platform means no linked account, never zero activity."
          loading={platforms.loading}
          error={platforms.error}
          onRetry={() => void loadPlatforms(applied)}
        >
          {!platforms.data || platforms.data.platforms.length === 0 ? (
            <p className="text-sm text-muted">
              No connected platforms. Connect one from the dashboard to see per-platform progress.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted">
                    <th scope="col" className="py-2 pr-4 font-medium">Platform</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Events</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Solved (tracked)</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Solved (official)</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Cal. submissions</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Cal. days</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Contests</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Active days</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Native rating</th>
                    <th scope="col" className="py-2 font-medium">Last synced</th>
                  </tr>
                </thead>
                <tbody>
                  {platforms.data.platforms.map((p) => (
                    <tr key={p.platform} className="border-b border-border/50 last:border-0">
                      <td className="py-2 pr-4 font-medium">{PLATFORM_LABELS[p.platform] ?? p.platform}</td>
                      <td className="py-2 pr-4">{p.events}</td>
                      <td className="py-2 pr-4">{p.solved}</td>
                      <td className="py-2 pr-4">
                        {p.totalSolvedAllTime === null ? "—" : p.totalSolvedAllTime}
                      </td>
                      <td className="py-2 pr-4">
                        {p.calendarSubmissions === undefined || p.calendarSubmissions === null
                          ? "—"
                          : p.calendarSubmissions}
                      </td>
                      <td className="py-2 pr-4">
                        {p.calendarDays === undefined || p.calendarDays === null ? "—" : p.calendarDays}
                      </td>
                      <td className="py-2 pr-4">{p.contests}</td>
                      <td className="py-2 pr-4">{p.activeDays}</td>
                      <td className="py-2 pr-4">{p.currentRating === null ? "—" : formatRating(p.currentRating)}</td>
                      <td className="py-2 text-xs text-muted">
                        {p.lastSyncedAt === null ? "never synced" : p.lastSyncedAt.slice(0, 10)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted">
                “Solved (tracked)” counts individually identified problems in this range; “Solved
                (official)” is the platform-reported lifetime total. A gap means upstream history
                is windowed — e.g. LeetCode exposes ~20 recent problems while reporting the full
                total — not missing CodePulse data. “Cal. submissions/days” are LeetCode calendar
                day counts (no problem attribution): activity, not unique solves.
              </p>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-4">
        <SectionCard
          title="Period comparison"
          description="The selected range against the equal-length period right before it."
          loading={compare.loading}
          error={compare.error}
          onRetry={() => void loadCompare(applied)}
        >
          {compare.data && (
            <>
              <p className="text-xs text-muted">
                Current: {compare.data.current.start} to {compare.data.current.end}
                {compare.data.previous
                  ? ` · Previous: ${compare.data.previous.start} to ${compare.data.previous.end}`
                  : " · No previous-period history."}
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted">
                      <th scope="col" className="py-2 pr-4 font-medium">Metric</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Current</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Previous</th>
                      <th scope="col" className="py-2 font-medium">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        ["Coding events", "events"],
                        ["Active days", "activeDays"],
                        ["Unique solved", "solved"],
                        ["Contest entries", "contests"],
                      ] as const
                    ).map(([label, key]) => (
                      <tr key={key} className="border-b border-border/50 last:border-0">
                        <td className="py-2 pr-4 font-medium">{label}</td>
                        <td className="py-2 pr-4">{compare.data!.current[key]}</td>
                        <td className="py-2 pr-4">
                          {compare.data!.previous ? compare.data!.previous[key] : "—"}
                        </td>
                        <td className="py-2">{formatDelta(compare.data!.deltaPct[key])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {compare.data.previousNote && (
                <p role="note" className="mt-3 text-xs text-amber-200/90">
                  {compare.data.previousNote}
                </p>
              )}
              {compare.data.cpr && (
                <p className="mt-3 text-sm text-muted">
                  CPR:{" "}
                  {compare.data.cpr.current === null ? "—" : formatRating(compare.data.cpr.current)}{" "}
                  (current) vs{" "}
                  {compare.data.cpr.previous === null ? "—" : formatRating(compare.data.cpr.previous)}{" "}
                  (end of previous period).
                </p>
              )}
            </>
          )}
        </SectionCard>
      </div>

      <div className="mt-4">
        <SectionCard
          title="Rating progress"
          description="CodePulse Rating (CPR) is a CodePulse-defined metric — not an official rating from any platform. Native platform ratings are listed separately below."
          loading={ratings.loading}
          error={ratings.error}
          onRetry={() => void loadRatings()}
        >
          <h3 className="text-sm font-medium text-slate-200">CPR history</h3>
          {cprChartData.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              No CPR snapshots yet. Recalculate your rating from the dashboard to record the first
              one — snapshots are only stored going forward, never backfilled.
            </p>
          ) : (
            <div className="mt-2 h-56" role="img" aria-label="Line chart of CodePulse Rating over time">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cprChartData} margin={{ top: 4, right: 12, bottom: 0, left: -12 }}>
                  <CartesianGrid stroke="#1f2a33" vertical={false} />
                  <XAxis dataKey="date" tick={TICK_STYLE} interval="preserveStartEnd" />
                  <YAxis tick={TICK_STYLE} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "#e6edf3" }} />
                  <Line type="monotone" dataKey="Rating" stroke="#22d3ee" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <h3 className="mt-6 text-sm font-medium text-slate-200">Native platform ratings</h3>
          {!ratings.data || ratings.data.ratings.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              No rated contest results with a recorded rating yet.
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted">
                    <th scope="col" className="py-2 pr-4 font-medium">Date</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Platform</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Contest</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Rating after</th>
                    <th scope="col" className="py-2 font-medium">Rank</th>
                  </tr>
                </thead>
                <tbody>
                  {ratings.data.ratings.slice(-50).map((r, i) => (
                    <tr key={`${r.date}-${r.contestName}-${i}`} className="border-b border-border/50 last:border-0">
                      <td className="py-2 pr-4">{r.date}</td>
                      <td className="py-2 pr-4">{PLATFORM_LABELS[r.platform] ?? r.platform}</td>
                      <td className="py-2 pr-4">{r.contestName}</td>
                      <td className="py-2 pr-4">{r.ratingAfter === null ? "—" : r.ratingAfter}</td>
                      <td className="py-2">{r.rank === null ? "—" : r.rank}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ratings.data.ratings.length > 50 && (
                <p className="mt-2 text-xs text-muted">
                  Showing the 50 most recent of {ratings.data.ratings.length} recorded results.
                </p>
              )}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-4">
        <SectionCard
          title="Contest history"
          description="Newest first. Only contests imported from connected platforms appear here."
          loading={contests.loading}
          error={contests.error}
          onRetry={() => void loadContests(contestOffset)}
        >
          {!contests.data || contests.data.items.length === 0 ? (
            <p className="text-sm text-muted">No contest participations recorded.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted">
                      <th scope="col" className="py-2 pr-4 font-medium">Date</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Platform</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Contest</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Rating change</th>
                      <th scope="col" className="py-2 font-medium">Rank</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contests.data.items.map((c) => (
                      <tr key={c.id} className="border-b border-border/50 last:border-0">
                        <td className="py-2 pr-4">{c.contestedAt.slice(0, 10)}</td>
                        <td className="py-2 pr-4">{PLATFORM_LABELS[c.platform] ?? c.platform}</td>
                        <td className="py-2 pr-4">{c.contestName}</td>
                        <td className="py-2 pr-4">
                          {c.ratingChange === null
                            ? "—"
                            : `${c.ratingChange > 0 ? "+" : ""}${c.ratingChange}`}
                        </td>
                        <td className="py-2">{c.rank === null ? "—" : c.rank}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={contestOffset === 0}
                  onClick={() => changeContestPage(Math.max(0, contestOffset - CONTEST_PAGE_SIZE))}
                >
                  Previous
                </Button>
                <span className="text-xs text-muted" aria-live="polite">
                  Page {contestPage} of {contestPageCount} · {contestTotal} total
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={contestOffset + CONTEST_PAGE_SIZE >= contestTotal}
                  onClick={() => changeContestPage(contestOffset + CONTEST_PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            </>
          )}
        </SectionCard>
      </div>
    </main>
  );
}
