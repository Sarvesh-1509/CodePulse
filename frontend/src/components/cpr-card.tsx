"use client";

import type { CprDto } from "@codepulse/shared";
import { Button } from "@/components/ui/button";
import { formatRating } from "@/lib/dashboard";

interface CprCardProps {
  data: CprDto | null;
  loading: boolean;
  error: string | null;
  recalculating: boolean;
  onRetry: () => void;
  onRecalculate: () => void;
}

const COMPONENT_LABELS = [
  ["contest", "Contests"],
  ["solving", "Problem solving"],
  ["consistency", "Consistency"],
] as const;

export default function CprCard({ data, loading, error, recalculating, onRetry, onRecalculate }: CprCardProps) {
  return (
    <section aria-label="CodePulse Rating" className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">CodePulse Rating</h2>
        <span className="rounded-full border border-border px-2 py-0.5 font-mono text-xs text-muted">
          CPR · formula {data?.formulaVersion ?? "1.0.0"}
        </span>
      </div>

      {loading && <p className="mt-4 text-sm text-muted">Loading rating…</p>}

      {!loading && error && (
        <div className="mt-4">
          <p role="alert" className="text-sm text-red-300">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}

      {!loading && !error && data && (
        <div className="mt-4">
          {data.rating === null ? (
            <div>
              <p className="text-sm text-muted">
                No rating yet — connect a platform and sync it to calculate your first CodePulse Rating.
              </p>
              <p className="mt-2 text-sm text-muted">
                {data.coverage.notes[0] ?? "Awaiting data."}
              </p>
            </div>
          ) : (
            <div>
              <p className="font-mono text-5xl text-slate-100" aria-label={`CodePulse Rating ${formatRating(data.rating)}`}>
                {formatRating(data.rating)}
              </p>
              <p className="mt-1 text-sm text-muted">
                {data.provisional ? (
                  <>Provisional rating — based on partial data.</>
                ) : (
                  <>Full rating — all components available.</>
                )}{" "}
                A CodePulse-defined score (0–1000), not an official platform rating.
              </p>
              <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {COMPONENT_LABELS.map(([key, label]) => (
                  <div key={key} className="rounded-md border border-border px-3 py-2">
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className="mt-0.5 font-mono text-sm text-slate-100">
                      {data.components[key] === null ? "—" : formatRating(data.components[key])}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 text-sm">
                <p className="text-muted">
                  Coverage: {data.coverage.componentsAvailable.length} of 3 components
                  {" · "}
                  {data.coverage.connectedPlatforms.length} platform
                  {data.coverage.connectedPlatforms.length === 1 ? "" : "s"} connected
                  {!data.coverage.historyComplete && " · history partial"}
                </p>
                {data.coverage.notes.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                    {data.coverage.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                )}
                {data.calculatedAt && (
                  <p className="mt-2 text-muted">
                    Calculated {new Date(data.calculatedAt).toLocaleString()}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                disabled={recalculating}
                onClick={onRecalculate}
              >
                {recalculating ? "Recalculating…" : "Recalculate"}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
