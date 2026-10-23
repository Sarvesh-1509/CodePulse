"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  completeProblem,
  getAttempt,
  getContest,
  getContestResults,
  publishContest,
  regenerateContest,
  startContest,
  type ContestAttemptDto,
  type ContestDto,
  type ContestResultsDto,
} from "@/lib/api";
import { formatTimeRemaining, formatTimeSpent, isAttemptRunning } from "@/lib/contests";
import { Button } from "@/components/ui/button";

function toMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function statusClass(status: string): string {
  switch (status) {
    case "DRAFT":
      return "rounded-full border border-border px-2 py-0.5 font-mono text-xs text-slate-100";
    case "PUBLISHED":
      return "rounded-full border border-emerald-900/50 px-2 py-0.5 font-mono text-xs text-emerald-300 bg-emerald-950/40";
    case "IN_PROGRESS":
      return "rounded-full border border-cyan-900/50 px-2 py-0.5 font-mono text-xs text-cyan-300 bg-cyan-950/40";
    case "COMPLETED":
      return "rounded-full border border-emerald-900/50 px-2 py-0.5 font-mono text-xs text-emerald-300 bg-emerald-950/40";
    case "EXPIRED":
      return "rounded-full border border-red-900/50 px-2 py-0.5 font-mono text-xs text-red-300 bg-red-950/40";
    default:
      return "rounded-full border border-border px-2 py-0.5 font-mono text-xs text-slate-100";
  }
}

export default function ContestPage() {
  const params = useParams<{ id: string }>();
  const contestId = params.id;
  const router = useRouter();

  const [contest, setContest] = useState<ContestDto | null>(null);
  const [attempt, setAttempt] = useState<ContestAttemptDto | null>(null);
  const [results, setResults] = useState<ContestResultsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const loadContest = useCallback(async () => {
    if (!contestId) return;
    setLoading(true);
    try {
      const data = await getContest(contestId);
      setContest(data.contest);
      setAttempt(data.contest.myAttempt ?? null);
    } catch (err) {
      if (!redirectIfUnauthorized(err)) setError(toMessage(err, "Failed to load the contest."));
    } finally {
      setLoading(false);
    }
  }, [contestId, redirectIfUnauthorized]);

  const loadResults = useCallback(async () => {
    if (!contestId) return;
    try {
      const data = await getContestResults(contestId);
      setResults(data.results);
    } catch {
      // Results are supplemental; silence failures to keep the page usable.
    }
  }, [contestId]);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current !== null) return;
    pollRef.current = setInterval(async () => {
      if (!contestId) return;
      try {
        const data = await getAttempt(contestId);
        const next = data.attempt;
        setAttempt(next);
        if (!isAttemptRunning(next)) stopPolling();
      } catch {
        // Ignore poll errors; the page still shows the last known state.
      }
    }, 4000);
  }, [contestId, stopPolling]);

  useEffect(() => {
    void loadContest();
  }, [loadContest]);

  useEffect(() => {
    if (contest !== null) void loadResults();
  }, [contest, loadResults]);

  useEffect(() => {
    if (isAttemptRunning(attempt)) startPolling();
    else stopPolling();
    return stopPolling;
  }, [attempt, startPolling, stopPolling]);

  async function onPublish() {
    setActing(true);
    setActionMessage(null);
    try {
      const data = await publishContest(contestId!);
      setContest(data.contest);
      setAttempt(data.contest.myAttempt ?? null);
      setActionMessage({ ok: true, text: "Contest published." });
    } catch (err) {
      if (!redirectIfUnauthorized(err))
        setActionMessage({ ok: false, text: toMessage(err, "Could not publish the contest.") });
    } finally {
      setActing(false);
    }
  }

  async function onRegenerate() {
    setActing(true);
    setActionMessage(null);
    try {
      const data = await regenerateContest(contestId!);
      setContest(data.contest);
      setAttempt(data.contest.myAttempt ?? null);
      setActionMessage({ ok: true, text: "Problems regenerated." });
    } catch (err) {
      if (!redirectIfUnauthorized(err))
        setActionMessage({
          ok: false,
          text: toMessage(err, "Could not regenerate the problems."),
        });
    } finally {
      setActing(false);
    }
  }

  async function onStart() {
    setActing(true);
    setError(null);
    try {
      const data = await startContest(contestId!);
      setAttempt(data.attempt);
      setActionMessage({ ok: true, text: "Contest started — good luck!" });
    } catch (err) {
      if (!redirectIfUnauthorized(err))
        setError(toMessage(err, "Could not start the contest."));
    } finally {
      setActing(false);
    }
  }

  async function onCompleteProblem(problemId: string) {
    setActing(true);
    try {
      const data = await completeProblem(contestId!, problemId);
      setAttempt(data.attempt);
    } catch (err) {
      if (!redirectIfUnauthorized(err))
        setError(toMessage(err, "Could not record completion."));
    } finally {
      setActing(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-6">
        <p className="text-muted">Loading contest…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-6">
        <p role="alert" className="text-red-300">{error}</p>
        <div className="mt-4 flex gap-3">
          <Button variant="outline" onClick={() => void loadContest()}>Retry</Button>
        </div>
      </main>
    );
  }

  if (!contest) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-6">
        <p role="alert" className="text-red-300">Contest not found.</p>
      </main>
    );
  }

  const running = isAttemptRunning(attempt);
  const finished = attempt ? attempt.status !== "IN_PROGRESS" : false;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-10">
      <header className="flex items-center justify-between border-b border-border pb-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">CodePulse</Link>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/rooms/${contest.roomId}`}>Back to room</Link>
          </Button>
        </div>
      </header>

      <div className="py-8">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-bold tracking-tight">{contest.name}</h1>
          <span className={`px-2 py-0.5 rounded ${statusClass(contest.status)}`}>
            {contest.status === "DRAFT" ? "Draft" : "Published"}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted">
          {contest.difficulty} · 3 problems · {contest.durationMinutes}-minute timer per
          participant{contest.description ? ` · ${contest.description}` : ""}
        </p>
        <p className="mt-2 text-xs text-muted">
          Created by {contest.createdByUsername}
          {contest.publishedAt ? ` · published ${new Date(contest.publishedAt).toLocaleDateString()}` : ""}
        </p>
        {actionMessage && (
          <p
            role={actionMessage.ok ? "status" : "alert"}
            className={`mt-3 rounded-md border px-3 py-2 text-sm ${actionMessage.ok ? "border-emerald-900 bg-emerald-950/40 text-emerald-300" : "border-red-900 bg-red-950/40 text-red-300"}`}
          >
            {actionMessage.text}
          </p>
        )}
      </div>

      <section aria-label="Problems" className="mb-8">
        <h2 className="text-xl font-semibold tracking-tight mb-4">Problems</h2>
        <ol className="space-y-4">
          {contest.problems.map((p) => (
            <li key={p.id} className="rounded-lg border border-border bg-surface p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold tracking-tight">{p.title}</h2>
                  <p className="mt-1 text-xs text-muted">
                    {p.platform} · {p.difficulty}
                  </p>
                </div>
                <span className={`shrink-0 ${statusClass(p.difficulty)}`}>
                  {p.difficulty}
                </span>
              </div>
              {p.topics.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {p.topics.map((topic) => (
                    <span
                      key={topic}
                      className="rounded-full border border-border px-2 py-0.5 font-mono text-xs text-slate-100"
                    >
                      {topic}
                    </span>
                  ))}
                </div>
              )}
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex h-10 items-center justify-center rounded-md bg-cyan-400 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-cyan-300"
              >
                Open on LeetCode ↗
              </a>
            </li>
          ))}
        </ol>
      </section>

      {contest.status === "DRAFT" && (
        <section className="mb-8">
          <h2 className="text-xl font-semibold tracking-tight mb-2">Review & publish</h2>
          <p className="mt-1 text-sm text-muted">
            The problem selection is fixed once published. Regenerate for a new set, or publish to
            let room members start. Only the contest creator can publish or regenerate.
          </p>
          <div className="mt-4 flex gap-3">
            <Button variant="outline" size="sm" disabled={acting} onClick={onRegenerate}>
              {acting ? "Regenerating…" : "Regenerate selection"}
            </Button>
            <Button disabled={acting} onClick={onPublish}>
              {acting ? "Publishing…" : "Publish contest"}
            </Button>
          </div>
        </section>
      )}

      {contest.status === "PUBLISHED" && !attempt && (
        <section className="mb-8">
          <h2 className="text-xl font-semibold tracking-tight mb-2">Start the contest</h2>
          <p className="mt-1 text-sm text-muted">
            You will get your own 90-minute timer that starts when you click below. It keeps running
            if you refresh or leave and come back.
          </p>
          <Button size="lg" disabled={acting} onClick={onStart}>
            {acting ? "Starting…" : "Start Contest"}
          </Button>
        </section>
      )}

      {running && attempt && (
        <section className="mb-8">
          <h2 className="text-xl font-semibold tracking-tight mb-2">In progress</h2>
          <p className="mt-1 text-sm text-muted">
            Your 90-minute timer is running. Mark each problem complete when you have solved it on
            LeetCode.
          </p>
          <div className="mt-4 flex items-center gap-4">
            <span className="font-mono text-lg text-cyan-300" aria-label="Time remaining">
              {formatTimeRemaining(attempt.secondsRemaining)}
            </span>
            <span className="text-xs text-muted">
              {attempt.deadlineAt
                ? `Deadline ${new Date(attempt.deadlineAt).toLocaleTimeString()}`
                : ""}
            </span>
          </div>
          <div className="mt-6 space-y-3">
            {attempt.problems.map((ap) => (
              <div
                key={ap.contestProblemId}
                className="rounded-lg border border-border bg-surface p-4 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <h3 className="font-semibold">{ap.contestProblem.title}</h3>
                  <p className="mt-0.5 text-xs text-muted">
                    {ap.contestProblem.difficulty} · {ap.contestProblem.topics.join(", ") || "—"}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {ap.completed ? (
                    <>
                      <span className="rounded-full border border-emerald-900/50 px-2 py-0.5 font-mono text-xs text-emerald-300 bg-emerald-950/40">
                        Completed
                      </span>
                      <span className="text-xs text-muted">
                        {ap.completedAt ? new Date(ap.completedAt).toLocaleTimeString() : ""}
                      </span>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      disabled={acting}
                      onClick={() => void onCompleteProblem(ap.contestProblemId)}
                    >
                      {acting ? "…" : "Mark complete"}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            Completion is self-reported on CodePulse and is not independently verified by LeetCode.
          </p>
        </section>
      )}

      {finished && attempt && (
        <section className="mb-8">
          <h2 className="text-xl font-semibold tracking-tight mb-2">Your results</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-xs text-muted">Problems completed</p>
              <p className="text-2xl font-mono text-slate-100">
                {attempt.problemsCompleted} / 3
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-xs text-muted">Score</p>
              <p className="text-2xl font-mono text-slate-100">{attempt.score}</p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-xs text-muted">Time spent</p>
              <p className="text-2xl font-mono text-slate-100">
                {formatTimeSpent(attempt.startedAt, attempt.completedAt)}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-xs text-muted">Status</p>
              <p className="text-2xl font-mono text-slate-100">
                {attempt.status === "COMPLETED" ? "Completed" : "Expired"}
              </p>
            </div>
          </div>
          <div className="mt-6 space-y-3">
            {attempt.problems.map((ap) => (
              <div
                key={ap.contestProblemId}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm text-slate-100">{ap.contestProblem.title}</p>
                  <p className="text-xs text-muted">
                    {ap.contestProblem.difficulty}
                  </p>
                </div>
                <span
                  className={`font-mono text-xs ${
                    ap.completed ? "text-emerald-300" : "text-slate-500"
                  }`}
                >
                  {ap.completed ? "Completed" : "Not completed"}
                </span>
              </div>
            ))}
          </div>
          {attempt.status === "EXPIRED" && (
            <p className="mt-3 text-sm text-red-300">
              Your time expired before all problems were completed. Completed problems are still
              counted.
            </p>
          )}
        </section>
      )}

      <section aria-label="Room results" className="mb-8">
        <h2 className="text-xl font-semibold tracking-tight mb-2">Room results</h2>
        {results === null && !loading && (
          <p className="mt-4 text-sm text-muted">Loading room results…</p>
        )}
        {results !== null && (
          <>
            <p className="mt-1 text-sm text-muted">
              {results.startedCount} started · {results.completedCount} completed ·
              {results.expiredCount} expired
            </p>
            {results.provisional && (
              <p className="mt-1 text-xs text-yellow-300">
                {results.provisionalNote}
              </p>
            )}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted">
                    <th scope="col" className="py-2 pr-4 font-medium">Rank</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Member</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Completed</th>
                    <th scope="col" className="py-2 font-medium">Score</th>
                    <th scope="col" className="py-2 font-medium">Finished at</th>
                  </tr>
                </thead>
                <tbody>
                  {results.leaderboard.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-sm text-muted">
                        No completed attempts yet.
                      </td>
                    </tr>
                  ) : (
                    results.leaderboard.map((e) => (
                      <tr key={e.user.id} className="border-b border-border/50 last:border-0">
                        <td className="py-2 pr-4 font-semibold">#{e.rank}</td>
                        <td className="py-2 pr-4 font-medium">
                          {e.user.displayName ?? e.user.username}
                        </td>
                        <td className="py-2 pr-4">
                          {e.problemsCompleted} / 3
                        </td>
                        <td className="py-2 pr-4 font-mono">{e.score}</td>
                        <td className="py-2 text-xs text-muted">
                          {e.completedAt
                            ? new Date(e.completedAt).toLocaleTimeString()
                            : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-surface p-3">
                <p className="text-xs text-muted">Average problems solved</p>
                <p className="text-lg font-mono text-slate-100">{results.averageProblemsSolved}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-3">
                <p className="text-xs text-muted">Most commonly solved</p>
                <p className="text-lg font-mono text-slate-100 truncate max-w-[120px]">
                  {results.mostCommonlySolved?.title ?? "—"}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-3">
                <p className="text-xs text-muted">Hardest problem</p>
                <p className="text-lg font-mono text-slate-100 truncate max-w-[120px]">
                  {results.hardestProblem?.title ?? "—"}
                </p>
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
