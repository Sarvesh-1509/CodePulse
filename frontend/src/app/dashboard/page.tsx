"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ApiError,
  getActivityDays,
  getActivityStreak,
  getCurrentUser,
  getRating,
  getRecentActivity,
  logoutRequest,
  recalculateRating,
  updateProfileRequest,
  type ActivityCoverageDto,
  type ActivityDayDto,
  type ActivityTotalsDto,
  type CprDto,
  type RecentActivityItemDto,
  type SafeUser,
  type StreakDto,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import PlatformAccounts from "@/components/platform-accounts";
import CprCard from "@/components/cpr-card";
import StreakCard from "@/components/streak-card";
import ActivityHeatmap from "@/components/activity-heatmap";
import RecentActivity from "@/components/recent-activity";
import AnalyticsCharts from "@/components/analytics-charts";

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none";

const RECENT_PAGE_SIZE = 10;
const HEATMAP_DAYS = 364;

function toMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<SafeUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [streak, setStreak] = useState<StreakDto | null>(null);
  const [coverage, setCoverage] = useState<ActivityCoverageDto | null>(null);
  const [totals, setTotals] = useState<ActivityTotalsDto | null>(null);
  const [streakLoading, setStreakLoading] = useState(true);
  const [streakError, setStreakError] = useState<string | null>(null);

  const [days, setDays] = useState<ActivityDayDto[] | null>(null);
  const [daysLoading, setDaysLoading] = useState(true);
  const [daysError, setDaysError] = useState<string | null>(null);

  const [rating, setRating] = useState<CprDto | null>(null);
  const [ratingLoading, setRatingLoading] = useState(true);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);

  const [recent, setRecent] = useState<RecentActivityItemDto[] | null>(null);
  const [recentTotal, setRecentTotal] = useState(0);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [timezone, setTimezone] = useState("");
  const [showOnLeaderboard, setShowOnLeaderboard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState<{ ok: boolean; text: string } | null>(null);

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

  const loadStreak = useCallback(async () => {
    setStreakLoading(true);
    setStreakError(null);
    try {
      const data = await getActivityStreak();
      setStreak(data.streak);
      setCoverage(data.coverage);
      setTotals(data.totals);
    } catch (err) {
      if (!redirectIfUnauthorized(err)) setStreakError(toMessage(err, "Failed to load streaks."));
    } finally {
      setStreakLoading(false);
    }
  }, [redirectIfUnauthorized]);

  const loadDays = useCallback(async () => {
    setDaysLoading(true);
    setDaysError(null);
    try {
      const data = await getActivityDays(HEATMAP_DAYS);
      setDays(data.days);
    } catch (err) {
      if (!redirectIfUnauthorized(err)) setDaysError(toMessage(err, "Failed to load activity."));
    } finally {
      setDaysLoading(false);
    }
  }, [redirectIfUnauthorized]);

  const loadRating = useCallback(async () => {
    setRatingLoading(true);
    setRatingError(null);
    try {
      setRating(await getRating());
    } catch (err) {
      if (!redirectIfUnauthorized(err)) setRatingError(toMessage(err, "Failed to load rating."));
    } finally {
      setRatingLoading(false);
    }
  }, [redirectIfUnauthorized]);

  const loadRecent = useCallback(
    async (offset: number, append: boolean) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setRecentLoading(true);
        setRecentError(null);
      }
      try {
        const data = await getRecentActivity({ limit: RECENT_PAGE_SIZE, offset });
        setRecent((prev) => (append ? [...(prev ?? []), ...data.items] : data.items));
        setRecentTotal(data.pagination.total);
      } catch (err) {
        if (!redirectIfUnauthorized(err)) {
          if (append) setLoadingMore(false);
          else setRecentError(toMessage(err, "Failed to load recent activity."));
          if (!append) setRecent(null);
          return;
        }
      } finally {
        if (append) setLoadingMore(false);
        else setRecentLoading(false);
      }
    },
    [redirectIfUnauthorized]
  );

  const loadUser = useCallback(async () => {
    try {
      const current = await getCurrentUser();
      setUser(current);
      setUsername(current.username);
      setDisplayName(current.displayName ?? "");
      setAvatarUrl(current.avatarUrl ?? "");
      setTimezone(current.timezone);
      setShowOnLeaderboard(current.showOnLeaderboard);
    } catch (err) {
      if (!redirectIfUnauthorized(err)) {
        setLoadError(toMessage(err, "Failed to load profile."));
      }
    } finally {
      setLoading(false);
    }
  }, [redirectIfUnauthorized]);

  useEffect(() => {
    // Independent requests run in parallel; each section degrades on its own
    // so one failing backend call never blocks the whole dashboard.
    void loadUser();
    void loadStreak();
    void loadDays();
    void loadRating();
    void loadRecent(0, false);
  }, [loadUser, loadStreak, loadDays, loadRating, loadRecent]);

  async function onRecalculate() {
    setRecalculating(true);
    try {
      setRating(await recalculateRating());
    } catch (err) {
      if (!redirectIfUnauthorized(err)) setRatingError(toMessage(err, "Recalculation failed."));
    } finally {
      setRecalculating(false);
    }
  }

  async function onLogout() {
    await logoutRequest().catch(() => undefined);
    router.replace("/login");
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setFormMessage(null);
    setSaving(true);
    try {
      const updated = await updateProfileRequest({
        username: username.trim(),
        displayName: displayName.trim() === "" ? null : displayName.trim(),
        avatarUrl: avatarUrl.trim() === "" ? null : avatarUrl.trim(),
        timezone: timezone.trim(),
        showOnLeaderboard,
      });
      setUser(updated);
      setUsername(updated.username);
      setShowOnLeaderboard(updated.showOnLeaderboard);
      setFormMessage({ ok: true, text: "Profile updated." });
    } catch (err) {
      setFormMessage({
        ok: false,
        text: err instanceof ApiError ? err.message : "Update failed. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-6">
        <p className="text-muted">Loading your profile…</p>
      </main>
    );
  }

  if (loadError || !user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-6">
        <p role="alert" className="text-red-300">{loadError ?? "Profile unavailable."}</p>
        <div className="mt-4 flex gap-3">
          <Button variant="outline" onClick={() => { setLoading(true); void loadUser(); }}>Retry</Button>
          <Button variant="outline" asChild>
            <Link href="/login">Go to login</Link>
          </Button>
        </div>
      </main>
    );
  }

  const totalEvents = totals?.total ?? 0;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-10">
      <header className="flex items-center justify-between border-b border-border pb-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          CodePulse
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/analytics">Analytics</Link>
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
        <p className="font-mono text-xs text-cyan-300">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        </p>
        <div className="mt-2 flex items-center gap-4">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-lg font-semibold text-cyan-300"
          >
            {(user.displayName || user.username).slice(0, 1).toUpperCase()}
          </span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Welcome, {user.displayName || user.username}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {user.username} · {user.email} · {user.timezone}
            </p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CprCard
          data={rating}
          loading={ratingLoading}
          error={ratingError}
          recalculating={recalculating}
          onRetry={() => void loadRating()}
          onRecalculate={() => void onRecalculate()}
        />
        <StreakCard
          streak={streak}
          coverage={coverage}
          totalEvents={totalEvents}
          loading={streakLoading}
          error={streakError}
          onRetry={() => void loadStreak()}
        />
      </div>

      <div className="mt-4">
        <ActivityHeatmap
          days={days}
          coverage={coverage}
          totalEvents={totalEvents}
          totalActiveDays={streak?.totalActiveDays ?? 0}
          loading={daysLoading}
          error={daysError}
          onRetry={() => void loadDays()}
        />
      </div>

      <div className="mt-4">
        <AnalyticsCharts days={days} totals={totals} coverage={coverage} loading={daysLoading || streakLoading} />
      </div>

      <div className="mt-4">
        <RecentActivity
          items={recent}
          total={recentTotal}
          loading={recentLoading}
          error={recentError}
          loadingMore={loadingMore}
          hasMore={recent !== null && recent.length < recentTotal}
          onRetry={() => void loadRecent(0, false)}
          onLoadMore={() => void loadRecent(recent?.length ?? 0, true)}
        />
      </div>

      <section className="mt-4 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-xl font-semibold tracking-tight">Coding Platforms</h2>
        <p className="mt-1 text-sm text-muted">
          Connect your competitive programming profiles to feed activity, streaks, and rating.
        </p>
        <div className="mt-4">
          <PlatformAccounts />
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-xl font-semibold tracking-tight">Edit profile</h2>
        <p className="mt-1 text-sm text-muted">
          Email and password changes are not supported in this module.
        </p>
        <form onSubmit={onSave} className="mt-4 space-y-4">
          <div>
            <label htmlFor="username" className="mb-1 block text-sm text-slate-200">Username</label>
            <input id="username" value={username} onChange={(e) => setUsername(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="displayName" className="mb-1 block text-sm text-slate-200">Display name</label>
            <input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputClass} placeholder="Optional" />
          </div>
          <div>
            <label htmlFor="avatarUrl" className="mb-1 block text-sm text-slate-200">Avatar URL</label>
            <input id="avatarUrl" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} className={inputClass} placeholder="https://…" />
          </div>
          <div>
            <label htmlFor="timezone" className="mb-1 block text-sm text-slate-200">Timezone</label>
            <input id="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} className={inputClass} placeholder="UTC" />
          </div>
          <div className="flex items-start gap-2">
            <input
              id="showOnLeaderboard"
              type="checkbox"
              checked={showOnLeaderboard}
              onChange={(e) => setShowOnLeaderboard(e.target.checked)}
              className="mt-1 h-4 w-4 accent-cyan-400"
            />
            <div>
              <label htmlFor="showOnLeaderboard" className="block text-sm text-slate-200">
                Show me on the public leaderboard
              </label>
              <p className="mt-0.5 text-xs text-muted">
                Hidden by default. Only your display name, CPR, and verified activity appear —
                never your email.
              </p>
            </div>
          </div>
          {formMessage && (
            <p role={formMessage.ok ? "status" : "alert"} className={`rounded-md border px-3 py-2 text-sm ${formMessage.ok ? "border-emerald-900 bg-emerald-950/40 text-emerald-300" : "border-red-900 bg-red-950/40 text-red-300"}`}>
              {formMessage.text}
            </p>
          )}
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </section>
    </main>
  );
}
