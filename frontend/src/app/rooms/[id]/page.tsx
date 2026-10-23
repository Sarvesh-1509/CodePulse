"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ApiError,
  createRoomInvitation,
  deleteRoom,
  getRoomDetails,
  getRoomLeaderboard,
  getRoomProgress,
  leaveRoom,
  listRoomInvitations,
  logoutRequest,
  removeRoomMember,
  revokeRoomInvitation,
  updateRoom,
  type CreatedInvitationDto,
  type LeaderboardPageDto,
  type RoomDetailsDto,
  type RoomInvitationDto,
  type RoomMemberProgressDto,
  type ContestSummaryDto,
  listContests,
} from "@/lib/api";
import {
  LEADERBOARD_METRICS,
  METRIC_LABELS,
  entryDetailText,
  formatScore,
  pageCount,
  usesPeriod,
} from "@/lib/leaderboards";
import type { LeaderboardMetric, LeaderboardPeriod } from "@codepulse/shared";
import {
  invitationStatus,
  invitationStatusLabel,
  isRoomOwner,
  memberDisplayName,
  toInvitationLink,
} from "@/lib/rooms";
import { formatRating } from "@/lib/dashboard";
import { Button } from "@/components/ui/button";

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none";

function toMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export default function RoomDetailsPage() {
  const params = useParams<{ id: string }>();
  const roomId = params.id;
  const router = useRouter();

  const [room, setRoom] = useState<RoomDetailsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [progress, setProgress] = useState<RoomMemberProgressDto[] | null>(null);
  const [progressError, setProgressError] = useState<string | null>(null);

  const [boardMetric, setBoardMetric] = useState<LeaderboardMetric>("cpr");
  const [boardPage, setBoardPage] = useState(1);
  const [board, setBoard] = useState<LeaderboardPageDto | null>(null);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);

  const [invitations, setInvitations] = useState<RoomInvitationDto[] | null>(null);
  const [invitationsError, setInvitationsError] = useState<string | null>(null);
  const [freshInvite, setFreshInvite] = useState<CreatedInvitationDto | null>(null);
  const [inviteFormError, setInviteFormError] = useState<string | null>(null);

  const [contests, setContests] = useState<ContestSummaryDto[] | null>(null);
  const [contestsError, setContestsError] = useState<string | null>(null);
  const [contestsLoading, setContestsLoading] = useState(false);
  const [expiresInHours, setExpiresInHours] = useState("168");
  const [maxUses, setMaxUses] = useState("1");
  const [inviteUsername, setInviteUsername] = useState("");
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [copied, setCopied] = useState(false);

  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [settingsMessage, setSettingsMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [acting, setActing] = useState(false);

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

  const loadProgress = useCallback(async () => {
    setProgressError(null);
    try {
      setProgress(await getRoomProgress(roomId));
    } catch (err) {
      if (!redirectIfUnauthorized(err)) {
        setProgress(null);
        setProgressError(toMessage(err, "Failed to load member progress."));
      }
    }
  }, [roomId, redirectIfUnauthorized]);

  const loadBoard = useCallback(
    async (metric: LeaderboardMetric, period: LeaderboardPeriod, page: number) => {
      setBoardLoading(true);
      setBoardError(null);
      try {
        setBoard(await getRoomLeaderboard(roomId, { metric, period, page, limit: 10 }));
      } catch (err) {
        if (!redirectIfUnauthorized(err)) {
          setBoard(null);
          setBoardError(toMessage(err, "Failed to load the room leaderboard."));
        }
      } finally {
        setBoardLoading(false);
      }
    },
    [roomId, redirectIfUnauthorized]
  );

  const loadInvitations = useCallback(async () => {
    setInvitationsError(null);
    try {
      setInvitations(await listRoomInvitations(roomId));
    } catch (err) {
      if (!redirectIfUnauthorized(err)) {
        setInvitations(null);
        // 403 here means the viewer is not the owner.
        setInvitationsError(
          err instanceof ApiError && err.status === 403
            ? "Only the room owner can manage invitations."
            : toMessage(err, "Failed to load invitations.")
        );
      }
    }
  }, [roomId, redirectIfUnauthorized]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const details = await getRoomDetails(roomId);
      setRoom(details);
      setEditName(details.name);
      setEditDescription(details.description ?? "");
      // Progress loads for every member; invitations only resolve for owners
      // (the backend answers 403 otherwise, shown as a permission note).
      void loadProgress();
      if (details.myRole === "OWNER") void loadInvitations();
      else setInvitations(null);
    } catch (err) {
      if (redirectIfUnauthorized(err)) return;
      if (err instanceof ApiError && err.status === 404) {
        // Deliberately generic: the backend answers 404 both for missing
        // rooms and for rooms the viewer may not see.
        setNotFound(true);
        setRoom(null);
      } else {
        setError(toMessage(err, "Failed to load the room."));
      }
    } finally {
      setLoading(false);
    }
  }, [roomId, redirectIfUnauthorized, loadProgress, loadInvitations]);

  const loadContests = useCallback(async () => {
    setContestsError(null);
    setContestsLoading(true);
    try {
      const data = await listContests({ roomId });
      setContests(data.contests);
    } catch (err) {
      if (!redirectIfUnauthorized(err)) {
        setContestsError(toMessage(err, "Failed to load contests."));
      }
    } finally {
      setContestsLoading(false);
    }
  }, [roomId, redirectIfUnauthorized]);

  useEffect(() => {
    void load();
    void loadContests();
  }, [load, loadContests]);

  // Room board loads once membership is confirmed (room !== null) and
  // reloads on metric/page changes without refetching details. Activity
  // boards use the trailing 30-day window.
  useEffect(() => {
    if (room !== null) void loadBoard(boardMetric, "30d", boardPage);
  }, [room, boardMetric, boardPage, loadBoard]);

  async function onLogout() {
    await logoutRequest().catch(() => undefined);
    router.replace("/login");
  }

  async function onSaveSettings(event: FormEvent) {
    event.preventDefault();
    setSettingsMessage(null);
    setSaving(true);
    try {
      const updated = await updateRoom(roomId, {
        name: editName.trim(),
        description: editDescription.trim() === "" ? null : editDescription.trim(),
      });
      setRoom((prev) => (prev === null ? prev : { ...prev, ...updated }));
      setSettingsMessage({ ok: true, text: "Room updated." });
    } catch (err) {
      if (!redirectIfUnauthorized(err))
        setSettingsMessage({ ok: false, text: toMessage(err, "Could not update the room.") });
    } finally {
      setSaving(false);
    }
  }

  async function onLeave() {
    setActionMessage(null);
    setActing(true);
    try {
      const result = await leaveRoom(roomId);
      if (result.roomDeleted) {
        router.replace("/rooms");
        return;
      }
      setActionMessage({
        ok: true,
        text: result.transferredToUsername
          ? `You left. Ownership transferred to ${result.transferredToUsername}.`
          : "You left the room.",
      });
      router.replace("/rooms");
    } catch (err) {
      if (!redirectIfUnauthorized(err))
        setActionMessage({ ok: false, text: toMessage(err, "Could not leave the room.") });
    } finally {
      setActing(false);
    }
  }

  async function onDelete() {
    setActionMessage(null);
    setActing(true);
    try {
      await deleteRoom(roomId);
      router.replace("/rooms");
    } catch (err) {
      if (!redirectIfUnauthorized(err))
        setActionMessage({ ok: false, text: toMessage(err, "Could not delete the room.") });
    } finally {
      setActing(false);
    }
  }

  async function onRemoveMember(userId: string, username: string) {
    setActionMessage(null);
    try {
      await removeRoomMember(roomId, userId);
      setActionMessage({ ok: true, text: `${username} was removed.` });
      void load();
    } catch (err) {
      if (!redirectIfUnauthorized(err))
        setActionMessage({ ok: false, text: toMessage(err, "Could not remove the member.") });
    }
  }

  async function onCreateInvitation(event: FormEvent) {
    event.preventDefault();
    setInviteFormError(null);
    setFreshInvite(null);
    setCopied(false);
    const username = inviteUsername.trim();
    // Direct in-app invite: only the username matters; expiry/uses keep
    // their defaults and the invite is single-use by backend design.
    if (username !== "") {
      setCreatingInvite(true);
      try {
        const created = await createRoomInvitation(roomId, { username });
        setFreshInvite(created);
        setInviteUsername("");
        void loadInvitations();
      } catch (err) {
        if (!redirectIfUnauthorized(err))
          setInviteFormError(toMessage(err, "Could not create the invitation."));
      } finally {
        setCreatingInvite(false);
      }
      return;
    }
    const hours = Number(expiresInHours);
    const uses = Number(maxUses);
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) {
      setInviteFormError("Expiry must be between 1 and 720 hours.");
      return;
    }
    if (!Number.isInteger(uses) || uses < 1 || uses > 100) {
      setInviteFormError("Max uses must be between 1 and 100.");
      return;
    }
    setCreatingInvite(true);
    try {
      const created = await createRoomInvitation(roomId, { expiresInHours: hours, maxUses: uses });
      setFreshInvite(created);
      void loadInvitations();
    } catch (err) {
      if (!redirectIfUnauthorized(err))
        setInviteFormError(toMessage(err, "Could not create the invitation."));
    } finally {
      setCreatingInvite(false);
    }
  }

  async function onRevoke(invitationId: string) {
    setInviteFormError(null);
    try {
      await revokeRoomInvitation(invitationId);
      setInvitations((prev) =>
        prev === null
          ? prev
          : prev.map((inv) =>
              inv.id === invitationId ? { ...inv, revokedAt: new Date().toISOString() } : inv
            )
      );
    } catch (err) {
      if (!redirectIfUnauthorized(err))
        setInviteFormError(toMessage(err, "Could not revoke the invitation."));
    }
  }

  async function onCopy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const owner = room !== null && isRoomOwner(room);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-10">
      <header className="flex items-center justify-between border-b border-border pb-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          CodePulse
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/rooms">Rooms</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard">Dashboard</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={onLogout}>
            Log out
          </Button>
        </div>
      </header>

      {loading && <p className="py-8 text-muted">Loading room…</p>}

      {!loading && notFound && (
        <section className="py-8" aria-label="Room not found">
          <h1 className="text-3xl font-bold tracking-tight">Room not found</h1>
          <p className="mt-2 text-sm text-muted">
            This room does not exist, or you are not a member of it. Private rooms never reveal
            their existence to non-members.
          </p>
          <Button variant="outline" className="mt-4" asChild>
            <Link href="/rooms">Back to rooms</Link>
          </Button>
        </section>
      )}

      {!loading && error && !notFound && (
        <div className="py-8">
          <p role="alert" className="text-red-300">{error}</p>
          <Button variant="outline" className="mt-4" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}

      {!loading && room && (
        <>
          <section className="py-8">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{room.name}</h1>
              <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
                {owner ? "Owner" : "Member"} · {room.memberCount}{" "}
                {room.memberCount === 1 ? "member" : "members"}
              </span>
            </div>
            {room.description && <p className="mt-1 text-sm text-muted">{room.description}</p>}
            {actionMessage && (
              <p
                role={actionMessage.ok ? "status" : "alert"}
                className={`mt-3 rounded-md border px-3 py-2 text-sm ${actionMessage.ok ? "border-emerald-900 bg-emerald-950/40 text-emerald-300" : "border-red-900 bg-red-950/40 text-red-300"}`}
              >
                {actionMessage.text}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={acting} onClick={() => void onLeave()}>
                Leave room
              </Button>
              {owner && (
                <Button variant="outline" size="sm" disabled={acting} onClick={() => void onDelete()}>
                  Delete room
                </Button>
              )}
            </div>
          </section>

          <section aria-label="Members" className="rounded-lg border border-border bg-surface p-5">
            <h2 className="text-xl font-semibold tracking-tight">Members</h2>
            <ul className="mt-4 space-y-2">
              {room.members.map((m) => (
                <li key={m.user.id} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-sm font-semibold text-cyan-300"
                    >
                      {memberDisplayName(m).slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <p className="text-sm font-medium">{memberDisplayName(m)}</p>
                      <p className="text-xs text-muted">
                        @{m.user.username} · {m.role === "OWNER" ? "Owner" : "Member"}
                      </p>
                    </div>
                  </div>
                  {owner && m.role === "MEMBER" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void onRemoveMember(m.user.id, m.user.username)}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="Member progress" className="mt-4 rounded-lg border border-border bg-surface p-5">
            <h2 className="text-xl font-semibold tracking-tight">Member progress</h2>
            <p className="mt-1 text-sm text-muted">
              Latest verified snapshot per member. Missing values are shown as —, never as zero.
            </p>
            {progress === null && progressError && (
              <div className="mt-4">
                <p role="alert" className="text-sm text-red-300">{progressError}</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => void loadProgress()}>
                  Retry
                </Button>
              </div>
            )}
            {progress !== null && progress.length === 0 && (
              <p className="mt-4 text-sm text-muted">No members to show.</p>
            )}
            {progress !== null && progress.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted">
                      <th scope="col" className="py-2 pr-4 font-medium">Member</th>
                      <th scope="col" className="py-2 pr-4 font-medium">CPR</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Streak</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Solved</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Contests</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Active 30d</th>
                      <th scope="col" className="py-2 font-medium">Platforms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {progress.map((p) => (
                      <tr key={p.user.id} className="border-b border-border/50 last:border-0">
                        <td className="py-2 pr-4 font-medium">{memberDisplayName(p)}</td>
                        <td className="py-2 pr-4">{p.rating === null ? "—" : formatRating(p.rating)}</td>
                        <td className="py-2 pr-4">
                          {p.currentStreak}d <span className="text-xs text-muted">(best {p.longestStreak}d)</span>
                        </td>
                        <td className="py-2 pr-4">{p.totalSolved}</td>
                        <td className="py-2 pr-4">{p.contestsAttended}</td>
                        <td className="py-2 pr-4">{p.activeDays30}d</td>
                        <td className="py-2 text-xs text-muted">
                          {p.connectedPlatforms.length === 0 ? "—" : p.connectedPlatforms.join(", ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-label="Room leaderboard" className="mt-4 rounded-lg border border-border bg-surface p-5">
            <h2 className="text-xl font-semibold tracking-tight">Room leaderboard</h2>
            <p className="mt-1 text-sm text-muted">
              Ranked members only — room boards never require the global opt-in. Ties share a rank.
            </p>
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Ranking category">
              {LEADERBOARD_METRICS.map((m) => (
                <Button
                  key={m}
                  variant={boardMetric === m ? "default" : "outline"}
                  size="sm"
                  aria-pressed={boardMetric === m}
                  onClick={() => {
                    setBoardMetric(m);
                    setBoardPage(1);
                  }}
                >
                  {METRIC_LABELS[m]}
                </Button>
              ))}
            </div>
            {usesPeriod(boardMetric) && (
              <p className="mt-2 text-xs text-muted">Trailing 30-day window.</p>
            )}
            {boardLoading && <p className="mt-4 text-sm text-muted">Loading leaderboard…</p>}
            {!boardLoading && boardError && (
              <div className="mt-4">
                <p role="alert" className="text-sm text-red-300">{boardError}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => void loadBoard(boardMetric, "30d", boardPage)}
                >
                  Retry
                </Button>
              </div>
            )}
            {!boardLoading && !boardError && board && (
              <>
                {board.entries.length === 0 ? (
                  <p className="mt-4 text-sm text-muted">
                    No ranked members yet for this category.
                  </p>
                ) : (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-border text-xs text-muted">
                          <th scope="col" className="py-2 pr-4 font-medium">Rank</th>
                          <th scope="col" className="py-2 pr-4 font-medium">Member</th>
                          <th scope="col" className="py-2 pr-4 font-medium">Score</th>
                          <th scope="col" className="py-2 font-medium">Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {board.entries.map((entry) => (
                          <tr key={entry.user.id} className="border-b border-border/50 last:border-0">
                            <td className="py-2 pr-4 font-semibold">#{entry.rank}</td>
                            <td className="py-2 pr-4 font-medium">
                              {entry.user.displayName ?? entry.user.username}
                            </td>
                            <td className="py-2 pr-4">{formatScore(board.metric, entry.score)}</td>
                            <td className="py-2 text-xs text-muted">
                              {entryDetailText(board.metric, entry) ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="mt-3 flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={boardPage <= 1}
                    onClick={() => setBoardPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <span className="text-xs text-muted" aria-live="polite">
                    Page {boardPage} of {pageCount(board.pagination.total, 10)} ·{" "}
                    {board.pagination.total} ranked
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={boardPage >= pageCount(board.pagination.total, 10)}
                    onClick={() => setBoardPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </>
            )}
          </section>

          <section aria-label="Contests" className="mt-4 rounded-lg border border-border bg-surface p-5">
            <h2 className="text-xl font-semibold tracking-tight">Contests</h2>
            <p className="mt-1 text-sm text-muted">
              Create and run personal coding contests with room members.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                asChild
                onClick={() => router.push(`/contests/create?roomId=${encodeURIComponent(roomId)}`)}
              >
                Create contest
              </Button>
            </div>
            {contests === null && contestsError && (
              <div className="mt-4">
                <p role="alert" className="text-sm text-red-300">{contestsError}</p>
              </div>
            )}
            {contestsLoading && contests === null && (
              <p className="mt-4 text-sm text-muted">Loading contests…</p>
            )}
            {contests !== null && contests.length === 0 && (
              <p className="mt-4 text-sm text-muted">
                No contests yet. Create one to get started.
              </p>
            )}
            {contests !== null && contests.length > 0 && (
              <ul className="mt-2 space-y-2">
                {contests.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <div>
                      <span className="font-medium">{c.name}</span>
                      <span className="ml-2 text-xs text-muted">
                        {c.status === "DRAFT" ? "Draft" : "Published"} · {c.difficulty}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted">
                        {c.participantCount} started · {c.completedCount} done
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        asChild
                        onClick={() => router.push(`/contests/${c.id}`)}
                      >
                        Open
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {owner && (
            <>
              <section aria-label="Room settings" className="mt-4 rounded-lg border border-border bg-surface p-5">
                <h2 className="text-xl font-semibold tracking-tight">Room settings</h2>
                <form onSubmit={onSaveSettings} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
                  <div>
                    <label htmlFor="room-edit-name" className="mb-1 block text-xs text-slate-200">
                      Room name
                    </label>
                    <input
                      id="room-edit-name"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      maxLength={60}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="room-edit-description" className="mb-1 block text-xs text-slate-200">
                      Description
                    </label>
                    <input
                      id="room-edit-description"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      maxLength={500}
                      placeholder="Empty to clear"
                      className={inputClass}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button type="submit" disabled={saving}>
                      {saving ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </form>
                {settingsMessage && (
                  <p
                    role={settingsMessage.ok ? "status" : "alert"}
                    className={`mt-2 text-sm ${settingsMessage.ok ? "text-emerald-300" : "text-red-300"}`}
                  >
                    {settingsMessage.text}
                  </p>
                )}
              </section>

              <section aria-label="Invitations" className="mt-4 rounded-lg border border-border bg-surface p-5">
                <h2 className="text-xl font-semibold tracking-tight">Invitations</h2>
                <p className="mt-1 text-sm text-muted">
                  Share the link manually — CodePulse does not send emails. The raw token is shown
                  once and never stored. Or invite a registered user by username: they will see it
                  in their rooms list and can accept it there, no link needed.
                </p>
                <form onSubmit={onCreateInvitation} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
                  <div>
                    <label htmlFor="invite-username" className="mb-1 block text-xs text-slate-200">
                      Username to invite (optional — skips the link)
                    </label>
                    <input
                      id="invite-username"
                      value={inviteUsername}
                      onChange={(e) => setInviteUsername(e.target.value)}
                      placeholder="friend-username"
                      maxLength={30}
                      autoComplete="off"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="invite-expiry" className="mb-1 block text-xs text-slate-200">
                      Expires in (hours, 1–720)
                    </label>
                    <input
                      id="invite-expiry"
                      inputMode="numeric"
                      value={expiresInHours}
                      onChange={(e) => setExpiresInHours(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="invite-uses" className="mb-1 block text-xs text-slate-200">
                      Max uses (1–100)
                    </label>
                    <input
                      id="invite-uses"
                      inputMode="numeric"
                      value={maxUses}
                      onChange={(e) => setMaxUses(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button type="submit" disabled={creatingInvite}>
                      {creatingInvite ? "Creating…" : "Create invitation"}
                    </Button>
                  </div>
                </form>
                {inviteFormError && (
                  <p role="alert" className="mt-2 text-sm text-red-300">
                    {inviteFormError}
                  </p>
                )}
                {freshInvite && freshInvite.invitation.invitedUsername !== null && (
                  <div className="mt-4 rounded-md border border-cyan-900 bg-cyan-950/30 px-3 py-2" role="status">
                    <p className="text-sm text-cyan-300">
                      Invitation sent to @{freshInvite.invitation.invitedUsername}. They can accept
                      it from their rooms list — no link needed.
                    </p>
                  </div>
                )}
                {freshInvite && freshInvite.invitation.invitedUsername === null && (
                  <div className="mt-4 rounded-md border border-cyan-900 bg-cyan-950/30 px-3 py-2" role="status">
                    <p className="text-xs font-medium text-cyan-300">
                      New invitation link (copy it now — the token is never shown again)
                    </p>
                    <p className="mt-1 break-all font-mono text-xs text-slate-100">
                      {typeof window === "undefined"
                        ? freshInvite.acceptPath
                        : toInvitationLink(window.location.origin, freshInvite.acceptPath)}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() =>
                        void onCopy(
                          typeof window === "undefined"
                            ? freshInvite.acceptPath
                            : toInvitationLink(window.location.origin, freshInvite.acceptPath)
                        )
                      }
                    >
                      {copied ? "Copied" : "Copy link"}
                    </Button>
                  </div>
                )}
                <div className="mt-4">
                  <h3 className="text-sm font-medium text-slate-200">Issued invitations</h3>
                  {invitations === null && invitationsError && (
                    <p role="alert" className="mt-2 text-sm text-red-300">{invitationsError}</p>
                  )}
                  {invitations !== null && invitations.length === 0 && (
                    <p className="mt-2 text-sm text-muted">No invitations issued yet.</p>
                  )}
                  {invitations !== null && invitations.length > 0 && (
                    <ul className="mt-2 space-y-2">
                      {invitations.map((inv) => {
                        const status = invitationStatus(inv);
                        return (
                          <li
                            key={inv.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                          >
                            <div>
                              <span className="font-medium">{invitationStatusLabel(status)}</span>
                              <span className="ml-2 text-xs text-muted">
                                {inv.invitedUsername !== null ? (
                                  <>to @{inv.invitedUsername} · expires {inv.expiresAt.slice(0, 10)} · by {inv.createdByUsername}</>
                                ) : (
                                  <>{inv.useCount}/{inv.maxUses} used · expires{" "}
                                  {inv.expiresAt.slice(0, 10)} · by {inv.createdByUsername}</>
                                )}
                              </span>
                            </div>
                            {status === "active" && (
                              <Button variant="outline" size="sm" onClick={() => void onRevoke(inv.id)}>
                                Revoke
                              </Button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}
