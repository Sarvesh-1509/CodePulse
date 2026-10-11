"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  connectPlatformAccount,
  disconnectPlatformAccount,
  listPlatformAccounts,
  listPlatforms,
  syncPlatformAccount,
  type LinkedAccountDto,
  type PlatformInfo,
} from "@/lib/api";
import { Button } from "@/components/ui/button";

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none";

function statusText(account: LinkedAccountDto): string {
  switch (account.connectionStatus) {
    case "CONNECTED":
      return "Connected";
    case "SYNCING":
      return "Syncing…";
    case "ERROR":
      return "Sync error";
    case "PENDING":
      return "Pending";
    case "DISCONNECTED":
      return "Disconnected";
  }
}

function formatSyncedAt(iso: string | null): string {
  if (!iso) return "Never synced";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function statRows(account: LinkedAccountDto): Array<[string, string]> {
  const stats = account.stats;
  if (!stats) return [];
  const rows: Array<[string, string]> = [];
  const extra = stats.additional as Record<string, unknown>;
  const text = (value: unknown): string | null =>
    typeof value === "number" || typeof value === "string" ? String(value) : null;

  if (account.platform === "CODEFORCES") {
    const rating = text(stats.contestRating);
    if (rating !== null) rows.push(["Codeforces rating", rating]);
    const maxRating = text(extra.maxRating);
    if (maxRating !== null) rows.push(["Max rating", maxRating]);
    const rank = text(extra.rank);
    if (rank !== null) rows.push(["Rank", rank]);
    if (stats.contestsAttended !== null) rows.push(["Rated contests", String(stats.contestsAttended)]);
    if (stats.totalSolved !== null) rows.push(["Problems solved", String(stats.totalSolved)]);
  } else if (account.platform === "LEETCODE") {
    if (stats.totalSolved !== null) rows.push(["Total solved", String(stats.totalSolved)]);
    for (const [key, label] of [
      ["easySolved", "Easy"],
      ["mediumSolved", "Medium"],
      ["hardSolved", "Hard"],
    ] as const) {
      const value = text(extra[key]);
      if (value !== null) rows.push([label, value]);
    }
    const contestRating = text(stats.contestRating);
    if (contestRating !== null) rows.push(["Contest rating", contestRating]);
    if (stats.contestsAttended !== null) rows.push(["Contests attended", String(stats.contestsAttended)]);
  } else if (account.platform === "CODECHEF") {
    const rating = text(stats.contestRating);
    if (rating !== null) rows.push(["CodeChef rating", rating]);
    const maxRating = text(extra.maxRating);
    if (maxRating !== null) rows.push(["Max rating", maxRating]);
    const division = text(extra.division);
    const stars = text(extra.stars);
    if (division !== null || stars !== null) {
      rows.push([
        "Division",
        [division, stars !== null ? `${stars}★` : null].filter(Boolean).join(" · ") || "—",
      ]);
    }
    const globalRank = text(extra.globalRank);
    if (globalRank !== null) rows.push(["Global rank", globalRank]);
    const countryRank = text(extra.countryRank);
    if (countryRank !== null) rows.push(["Country rank", countryRank]);
    if (stats.totalSolved !== null) rows.push(["Problems solved", String(stats.totalSolved)]);
    if (stats.contestsAttended !== null) rows.push(["Rated contests", String(stats.contestsAttended)]);
  } else if (account.platform === "GEEKSFORGEEKS") {
    // GFG exposes a coding SCORE, not a rating — labeled exactly as such.
    const score = text(extra.score);
    if (score !== null) rows.push(["Coding score", score]);
    const monthly = text(extra.monthlyScore);
    if (monthly !== null) rows.push(["Monthly score", monthly]);
    if (stats.totalSolved !== null) rows.push(["Total solved", String(stats.totalSolved)]);
    const instituteRank = text(extra.instituteRank);
    if (instituteRank !== null) rows.push(["Institute rank", instituteRank]);
    const podCurrent = text(extra.podCurrentStreak);
    if (podCurrent !== null) rows.push(["POTD current streak", podCurrent]);
    const podLongest = text(extra.podLongestStreak);
    if (podLongest !== null) rows.push(["POTD longest streak", podLongest]);
  } else if (account.platform === "HACKERRANK") {
    const level = text(extra.level);
    if (level !== null) rows.push(["Level", level]);
    const badgesCount = text(extra.badgesCount);
    if (badgesCount !== null) rows.push(["Badges", badgesCount]);
    if (stats.contestsAttended !== null) rows.push(["Contests", String(stats.contestsAttended)]);
    const followers = text(extra.followersCount);
    if (followers !== null) rows.push(["Followers", followers]);
    if (Array.isArray(extra.badges)) {
      for (const badge of extra.badges.slice(0, 3)) {
        if (badge && typeof badge === "object") {
          const b = badge as Record<string, unknown>;
          const name = text(b.name);
          const stars = text(b.stars);
          if (name !== null) {
            rows.push([name, stars !== null ? `${stars}★` : "—"]);
          }
        }
      }
    }
  } else {
    if (stats.totalSolved !== null) rows.push(["Solved", String(stats.totalSolved)]);
    if (stats.contestRating !== null) rows.push(["Contest rating", String(stats.contestRating)]);
    if (stats.contestsAttended !== null) rows.push(["Contests", String(stats.contestsAttended)]);
  }
  return rows;
}

interface CardState {
  username: string;
  busy: string | null; // "connect" | "sync" | "disconnect" | null
  message: { ok: boolean; text: string } | null;
}

const emptyCard: CardState = { username: "", busy: null, message: null };

export default function PlatformAccounts() {
  const [platforms, setPlatforms] = useState<PlatformInfo[] | null>(null);
  const [accounts, setAccounts] = useState<Record<string, LinkedAccountDto>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cards, setCards] = useState<Record<string, CardState>>({});

  const refresh = useCallback(async () => {
    const [info, linked] = await Promise.all([listPlatforms(), listPlatformAccounts()]);
    setPlatforms(info);
    setAccounts(Object.fromEntries(linked.map((a) => [a.platform, a])));
  }, []);

  useEffect(() => {
    refresh()
      .catch((err) =>
        setLoadError(err instanceof ApiError ? err.message : "Failed to load platforms.")
      )
      .finally(() => setLoading(false));
  }, [refresh]);

  function patchCard(platform: string, patch: Partial<CardState>) {
    setCards((prev) => ({ ...prev, [platform]: { ...(prev[platform] ?? emptyCard), ...patch } }));
  }

  async function runAction(
    platform: string,
    kind: "connect" | "sync" | "disconnect",
    action: () => Promise<unknown>,
    precheck?: string | null
  ) {
    if (precheck) {
      patchCard(platform, { message: { ok: false, text: precheck } });
      return;
    }
    patchCard(platform, { busy: kind, message: null });
    try {
      await action();
      await refresh();
      patchCard(platform, {
        busy: null,
        username: "",
        message: {
          ok: true,
          text:
            kind === "connect"
              ? "Account connected."
              : kind === "sync"
                ? "Synchronized."
                : "Account disconnected.",
        },
      });
    } catch (err) {
      patchCard(platform, {
        busy: null,
        message: {
          ok: false,
          text: err instanceof ApiError ? err.message : "Something went wrong.",
        },
      });
    }
  }

  if (loading) {
    return <p className="text-muted">Loading coding platforms…</p>;
  }

  if (loadError || !platforms) {
    return (
      <div>
        <p role="alert" className="text-red-300">{loadError ?? "Platforms unavailable."}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => {
            setLoading(true);
            setLoadError(null);
            refresh()
              .catch((err) =>
                setLoadError(err instanceof ApiError ? err.message : "Failed to load platforms.")
              )
              .finally(() => setLoading(false));
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {platforms.map((platform) => {
        const account = accounts[platform.id];
        const card = cards[platform.id] ?? emptyCard;
        const busy = card.busy !== null;
        return (
          <article
            key={platform.id}
            aria-label={`${platform.displayName} connection`}
            className="rounded-lg border border-border bg-surface p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold">{platform.displayName}</h3>
              <span className="rounded-full border border-border px-2 py-0.5 font-mono text-xs text-muted">
                {platform.available ? "Available" : "Coming soon"}
              </span>
            </div>

            {!platform.available && (
              <p className="mt-2 text-sm text-muted">
                {platform.displayName} integration is not implemented yet.
              </p>
            )}

            {platform.available && !account && (
              <form
                className="mt-4 space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const username = card.username.trim();
                  void runAction(
                    platform.id,
                    "connect",
                    () => connectPlatformAccount(platform.id, username),
                    username ? null : "Enter your platform username."
                  );
                }}
              >
                <div>
                  <label htmlFor={`username-${platform.id}`} className="mb-1 block text-sm text-slate-200">
                    {platform.displayName} username
                  </label>
                  <input
                    id={`username-${platform.id}`}
                    value={card.username}
                    onChange={(e) => patchCard(platform.id, { username: e.target.value })}
                    className={inputClass}
                    placeholder={platform.usernameHint}
                    disabled={busy}
                    autoComplete="off"
                    suppressHydrationWarning
                  />
                </div>
                <Button type="submit" size="sm" disabled={busy}>
                  {card.busy === "connect" ? "Connecting…" : "Connect"}
                </Button>
              </form>
            )}

            {platform.available && account && (
              <div className="mt-3 space-y-2 text-sm">
                <p>
                  <span className="text-muted">Status: </span>
                  <span className="text-slate-100">{statusText(account)}</span>
                  <span className="text-muted"> · {account.platformUsername}</span>
                </p>
                <p className="text-muted">Last synced: {formatSyncedAt(account.lastSyncedAt)}</p>
                {account.stale && (
                  <p className="text-amber-300">
                    Showing last synced data — the latest refresh failed.
                  </p>
                )}
                {account.connectionStatus === "ERROR" && account.lastSyncError && (
                  <p role="alert" className="text-red-300">{account.lastSyncError}</p>
                )}
                {statRows(account).length > 0 && (
                  <dl className="grid grid-cols-2 gap-2 pt-1">
                    {statRows(account).map(([label, value]) => (
                      <div key={label} className="rounded-md border border-border px-3 py-2">
                        <dt className="text-xs text-muted">{label}</dt>
                        <dd className="mt-0.5 font-mono text-sm text-slate-100">{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void runAction(platform.id, "sync", () => syncPlatformAccount(platform.id))
                    }
                  >
                    {card.busy === "sync" ? "Syncing…" : "Sync"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void runAction(platform.id, "disconnect", () =>
                        disconnectPlatformAccount(platform.id)
                      )
                    }
                  >
                    {card.busy === "disconnect" ? "Removing…" : "Disconnect"}
                  </Button>
                </div>
              </div>
            )}

            {!platform.available && (
              <Button size="sm" variant="outline" disabled className="mt-4">
                Coming soon
              </Button>
            )}

            {card.message && (
              <p
                role={card.message.ok ? "status" : "alert"}
                className={`mt-3 text-sm ${card.message.ok ? "text-emerald-300" : "text-red-300"}`}
              >
                {card.message.text}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}
