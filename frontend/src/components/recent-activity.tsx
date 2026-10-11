"use client";

import type { RecentActivityItemDto } from "@codepulse/shared";
import { Button } from "@/components/ui/button";

interface RecentActivityProps {
  items: RecentActivityItemDto[] | null;
  total: number;
  loading: boolean;
  error: string | null;
  loadingMore: boolean;
  hasMore: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
}

const PLATFORM_LABELS: Record<string, string> = {
  CODEFORCES: "Codeforces",
  LEETCODE: "LeetCode",
  CODECHEF: "CodeChef",
  GEEKSFORGEEKS: "GeeksforGeeks",
  HACKERRANK: "HackerRank",
};

function describe(item: RecentActivityItemDto): string {
  if (item.type === "CONTEST_PARTICIPATION") {
    return `Contested ${item.problemIdentifier ?? "a contest"}`;
  }
  if (item.type === "SUBMISSION") {
    // Day-level submission activity without problem attribution (LeetCode
    // submission calendar): never presented as a solved problem.
    return "LeetCode submission activity";
  }
  return `Solved ${item.problemIdentifier ?? "a problem"}`;
}

export default function RecentActivity({
  items,
  total,
  loading,
  error,
  loadingMore,
  hasMore,
  onRetry,
  onLoadMore,
}: RecentActivityProps) {
  return (
    <section aria-label="Recent activity" className="rounded-lg border border-border bg-surface p-5">
      <h2 className="text-xl font-semibold tracking-tight">Recent activity</h2>

      {loading && <p className="mt-4 text-sm text-muted">Loading recent activity…</p>}

      {!loading && error && (
        <div className="mt-4">
          <p role="alert" className="text-sm text-red-300">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}

      {!loading && !error && items && (
        <div className="mt-4">
          {items.length === 0 ? (
            <p className="text-sm text-muted">Nothing here yet — synced activity will appear in this feed.</p>
          ) : (
            <>
              <ul className="divide-y divide-border">
                {items.map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-100">{describe(item)}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {new Date(item.occurredAt).toLocaleString()}
                        {item.difficulty ? ` · difficulty ${item.difficulty}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 font-mono text-xs text-muted">
                      {PLATFORM_LABELS[item.platform] ?? item.platform} · {item.platformUsername}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">
                Showing {items.length} of {total}.
              </p>
              {hasMore && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  disabled={loadingMore}
                  onClick={onLoadMore}
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
