"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiError, getActivityStreak, getRating, getRecentActivity, listPlatformAccounts } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { assessLevel, computeWeakTopics, generateRecommendations, type RecommendationLevel, type RecommendationProfile, type RecommendationTopic, type RecommendedProblem } from "@/lib/recommendations";
import type { PlatformId } from "@codepulse/shared";

const RECENT_LIMIT = 50;

function toMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export default function RecommendationsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<RecommendationProfile | null>(null);
  const [level, setLevel] = useState<RecommendationLevel | null>(null);
  const [weakTopics, setWeakTopics] = useState<RecommendationTopic[] | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendedProblem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [streak, rating, recent, accounts] = await Promise.all([
        getActivityStreak(),
        getRating(),
        getRecentActivity({ limit: RECENT_LIMIT }),
        listPlatformAccounts(),
      ]);
      const solvedRefs = recent.items
        .filter((item) => item.type === "PROBLEM_SOLVED" && item.problemIdentifier)
        .map((item) => ({
          platform: item.platform,
          problemIdentifier: item.problemIdentifier as string,
          difficulty: item.difficulty,
          occurredAt: item.occurredAt,
        }));
      const ratingsByPlatform: Partial<Record<PlatformId, number>> = {};
      for (const account of accounts) {
        if (account.connectionStatus !== "CONNECTED") continue;
        const platformRating = account.stats?.contestRating;
        if (typeof platformRating === "number") {
          ratingsByPlatform[account.platform] = platformRating;
        }
      }
      const nextProfile: RecommendationProfile = {
        solvedRefs,
        solvedCountsByPlatform: streak.totals?.uniqueSolvedByPlatform ?? {},
        ratingsByPlatform,
        cprRating: rating?.rating ?? null,
        streakCurrent: streak.streak?.current ?? 0,
        activeDays: streak.streak?.totalActiveDays ?? 0,
        hasSyncedData: accounts.some((account) => account.connectionStatus === "CONNECTED"),
      };
      setProfile(nextProfile);
      setLevel(assessLevel(nextProfile));
      setWeakTopics(computeWeakTopics(nextProfile));
    } catch (err) {
      if (!redirectIfUnauthorized(err)) {
        setError(toMessage(err, "Failed to load recommendations."));
      }
    } finally {
      setLoading(false);
    }
  }, [redirectIfUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!profile) return;
    setRecommendations(generateRecommendations({ profile, refreshKey }));
  }, [profile, refreshKey]);

  const onRefresh = useCallback(() => {
    setRefreshKey((key) => key + 1);
  }, []);

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6">
        <p className="text-muted">Loading recommendations…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6">
        <p role="alert" className="text-red-300">{error}</p>
        <div className="mt-4 flex gap-3">
          <Button variant="outline" onClick={() => void load()}>Retry</Button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-10">
      <header className="flex items-center justify-between border-b border-border pb-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">CodePulse</Link>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard">Dashboard</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/analytics">Analytics</Link>
          </Button>
        </div>
      </header>

      <section className="py-8">
        <h1 className="text-3xl font-bold tracking-tight">Recommended for You</h1>
        <p className="mt-2 text-sm text-muted">
          Personalized problem picks based on your synced competitive programming history.
          Problems you already solved are excluded and weaker topics are prioritized.
        </p>
        {level && (
          <p className="mt-2 text-sm text-slate-200">
            Estimated difficulty: <span className="font-semibold text-cyan-300">{level.label}</span>
            {level.source === "none" ? " (no solved history yet — showing fundamentals)" : ""}.
          </p>
        )}
        {weakTopics && weakTopics.length > 0 && recommendations.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Focus areas:</span>
            {weakTopics.map((topic) => (
              <span
                key={topic}
                className="rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-xs text-slate-100"
              >
                {topic}
              </span>
            ))}
          </div>
        )}
        <div className="mt-6">
          <Button onClick={onRefresh} disabled={loading}>Refresh</Button>
        </div>
      </section>

      {!loading && !error && recommendations.length === 0 && (
        <p className="text-sm text-muted">
          No recommendations right now. Try refreshing or connect and sync more platforms so
          personalized picks can be generated.
        </p>
      )}

      {!loading && !error && recommendations.length > 0 && (
        <ol className="space-y-4">
          {recommendations.map((problem) => (
            <li
              key={problem.id}
              className="rounded-lg border border-border bg-surface p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold tracking-tight">{problem.title}</h2>
                  <p className="mt-1 text-xs text-muted">
                    {problem.platformLabel} · {problem.difficulty}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-border px-2 py-0.5 font-mono text-xs text-muted">
                  {problem.difficulty}
                </span>
              </div>
              {problem.topics.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {problem.topics.map((topic) => (
                    <span
                      key={topic}
                      className="rounded-full border border-border px-2 py-0.5 font-mono text-xs text-slate-100"
                    >
                      {topic}
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-3 text-sm text-slate-200">{problem.reason}</p>
              <a
                href={problem.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex h-10 items-center justify-center rounded-md bg-cyan-400 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-cyan-300"
              >
                Open problem ↗
              </a>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
