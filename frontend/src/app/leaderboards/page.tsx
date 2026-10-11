"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  getGlobalLeaderboard,
  logoutRequest,
  type LeaderboardPageDto,
} from "@/lib/api";
import {
  LEADERBOARD_METRICS,
  LEADERBOARD_PERIODS,
  METRIC_DESCRIPTIONS,
  METRIC_LABELS,
  entryDetailText,
  formatScore,
  leaderboardDisplayName,
  pageCount,
  usesPeriod,
} from "@/lib/leaderboards";
import { Button } from "@/components/ui/button";
import type { LeaderboardMetric, LeaderboardPeriod } from "@codepulse/shared";

const PAGE_SIZE = 20;

function toMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export default function LeaderboardsPage() {
  const router = useRouter();
  const [metric, setMetric] = useState<LeaderboardMetric>("cpr");
  const [period, setPeriod] = useState<LeaderboardPeriod>("30d");
  const [page, setPage] = useState(1);
  const [board, setBoard] = useState<LeaderboardPageDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (m: LeaderboardMetric, p: LeaderboardPeriod, pg: number) => {
      setLoading(true);
      setError(null);
      try {
        // The global board is public; no login required. Session cookies
        // still ride along when present so the viewer's own row resolves.
        setBoard(await getGlobalLeaderboard({ metric: m, period: p, page: pg, limit: PAGE_SIZE }));
      } catch (err) {
        if (err instanceof ApiError && err.status === 429) {
          setError("Too many requests. Please wait a moment and retry.");
        } else {
          setError(toMessage(err, "Failed to load the leaderboard."));
        }
        setBoard(null);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void load(metric, period, page);
  }, [load, metric, period, page]);

  function selectMetric(next: LeaderboardMetric) {
    setMetric(next);
    setPage(1);
  }

  function selectPeriod(next: LeaderboardPeriod) {
    setPeriod(next);
    setPage(1);
  }

  async function onLogout() {
    await logoutRequest().catch(() => undefined);
    router.replace("/login");
  }

  const total = board?.pagination.total ?? 0;
  const pages = pageCount(total, PAGE_SIZE);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-10">
      <header className="flex items-center justify-between border-b border-border pb-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          CodePulse
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard">Dashboard</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/rooms">Rooms</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={onLogout}>
            Log out
          </Button>
        </div>
      </header>

      <section className="py-8">
        <h1 className="text-3xl font-bold tracking-tight">Leaderboards</h1>
        <p className="mt-1 text-sm text-muted">
          {METRIC_DESCRIPTIONS[metric]} Ties share a rank; order within ties is deterministic.
        </p>
      </section>

      <section aria-label="Ranking category" className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-medium text-slate-200">Category</h2>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Ranking category">
          {LEADERBOARD_METRICS.map((m) => (
            <Button
              key={m}
              variant={metric === m ? "default" : "outline"}
              size="sm"
              aria-pressed={metric === m}
              onClick={() => selectMetric(m)}
            >
              {METRIC_LABELS[m]}
            </Button>
          ))}
        </div>
        {usesPeriod(metric) ? (
          <>
            <h2 className="mt-4 text-sm font-medium text-slate-200">Trailing window</h2>
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Trailing window">
              {LEADERBOARD_PERIODS.map((p) => (
                <Button
                  key={p}
                  variant={period === p ? "default" : "outline"}
                  size="sm"
                  aria-pressed={period === p}
                  onClick={() => selectPeriod(p)}
                >
                  {p === "7d" ? "7 days" : p === "30d" ? "30 days" : "90 days"}
                </Button>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-3 text-xs text-muted">
            This board ranks current snapshots, so no trailing window applies.
          </p>
        )}
      </section>

      <section aria-label="Rankings" className="mt-4 rounded-lg border border-border bg-surface p-5">
        {loading && <p className="text-sm text-muted">Loading leaderboard…</p>}
        {!loading && error && (
          <div>
            <p role="alert" className="text-sm text-red-300">{error}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void load(metric, period, page)}>
              Retry
            </Button>
          </div>
        )}
        {!loading && !error && board && (
          <>
            {board.me && (
              <p role="status" className="rounded-md border border-cyan-900 bg-cyan-950/30 px-3 py-2 text-sm text-cyan-200">
                You are ranked #{board.me.rank} with {formatScore(board.metric, board.me.score)}.
              </p>
            )}
            {board.entries.length === 0 ? (
              <p className="mt-4 text-sm text-muted">
                Nobody is ranked here yet. Rankings only include members who opted in on the
                leaderboard — enable it from your dashboard profile to appear.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted">
                      <th scope="col" className="py-2 pr-4 font-medium">Rank</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Member</th>
                      <th scope="col" className="py-2 pr-4 font-medium">{METRIC_LABELS[board.metric]}</th>
                      <th scope="col" className="py-2 font-medium">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.entries.map((entry) => {
                      const detail = entryDetailText(board.metric, entry);
                      const isMe = board.me?.user.id === entry.user.id;
                      return (
                        <tr
                          key={entry.user.id}
                          className={`border-b border-border/50 last:border-0 ${isMe ? "bg-cyan-950/30" : ""}`}
                        >
                          <td className="py-2 pr-4 font-semibold">#{entry.rank}</td>
                          <td className="py-2 pr-4">
                            <span className="flex items-center gap-2">
                              <span
                                aria-hidden="true"
                                className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-xs font-semibold text-cyan-300"
                              >
                                {leaderboardDisplayName(entry).slice(0, 1).toUpperCase()}
                              </span>
                              <span className="font-medium">
                                {leaderboardDisplayName(entry)}
                              </span>
                            </span>
                          </td>
                          <td className="py-2 pr-4">{formatScore(board.metric, entry.score)}</td>
                          <td className="py-2 text-xs text-muted">{detail ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {board.note && (
              <p role="note" className="mt-3 text-xs text-muted">
                {board.note}
              </p>
            )}
            <div className="mt-3 flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="text-xs text-muted" aria-live="polite">
                Page {page} of {pages} · {total} ranked
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
