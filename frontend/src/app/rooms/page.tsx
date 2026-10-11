"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ApiError,
  acceptReceivedInvitation,
  createRoom,
  declineReceivedInvitation,
  listReceivedInvitations,
  listRooms,
  logoutRequest,
  type RoomDto,
  type RoomInvitationDto,
} from "@/lib/api";
import { isRoomOwner } from "@/lib/rooms";
import { Button } from "@/components/ui/button";

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none";

function toMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export default function RoomsPage() {
  const router = useRouter();
  const [rooms, setRooms] = useState<RoomDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [received, setReceived] = useState<RoomInvitationDto[] | null>(null);
  const [receivedError, setReceivedError] = useState<string | null>(null);
  const [receivedMessage, setReceivedMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
      setRooms(await listRooms());
    } catch (err) {
      if (!redirectIfUnauthorized(err)) {
        setRooms(null);
        setError(toMessage(err, "Failed to load rooms."));
      }
    } finally {
      setLoading(false);
    }
  }, [redirectIfUnauthorized]);

  const loadReceived = useCallback(async () => {
    setReceivedError(null);
    try {
      setReceived(await listReceivedInvitations());
    } catch (err) {
      if (!redirectIfUnauthorized(err)) {
        setReceived(null);
        setReceivedError(toMessage(err, "Failed to load pending invitations."));
      }
    }
  }, [redirectIfUnauthorized]);

  useEffect(() => {
    void load();
    void loadReceived();
  }, [load, loadReceived]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const trimmed = name.trim();
    if (trimmed === "") {
      setFormError("Room name must not be empty.");
      return;
    }
    setCreating(true);
    try {
      const room = await createRoom({
        name: trimmed,
        description: description.trim() === "" ? undefined : description.trim(),
      });
      setName("");
      setDescription("");
      setRooms((prev) => (prev === null ? [room] : [...prev, room]));
    } catch (err) {
      if (!redirectIfUnauthorized(err)) setFormError(toMessage(err, "Could not create the room."));
    } finally {
      setCreating(false);
    }
  }

  async function onAcceptReceived(invitation: RoomInvitationDto) {
    setReceivedMessage(null);
    setActingOn(invitation.id);
    try {
      await acceptReceivedInvitation(invitation.id);
      setReceivedMessage({ ok: true, text: `You joined ${invitation.roomName}.` });
      void load();
      void loadReceived();
    } catch (err) {
      if (!redirectIfUnauthorized(err))
        setReceivedMessage({ ok: false, text: toMessage(err, "Could not accept the invitation.") });
    } finally {
      setActingOn(null);
    }
  }

  async function onDeclineReceived(invitation: RoomInvitationDto) {
    setReceivedMessage(null);
    setActingOn(invitation.id);
    try {
      await declineReceivedInvitation(invitation.id);
      setReceivedMessage({ ok: true, text: `Declined the invitation to ${invitation.roomName}.` });
      void loadReceived();
    } catch (err) {
      if (!redirectIfUnauthorized(err))
        setReceivedMessage({ ok: false, text: toMessage(err, "Could not decline the invitation.") });
    } finally {
      setActingOn(null);
    }
  }

  async function onLogout() {
    await logoutRequest().catch(() => undefined);
    router.replace("/login");
  }

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
            <Link href="/analytics">Analytics</Link>
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
        <h1 className="text-3xl font-bold tracking-tight">Rooms</h1>
        <p className="mt-1 text-sm text-muted">
          Private coding rooms. Only members can see a room — invitations are shared manually with
          a link, or sent directly to a username.
        </p>
      </section>

      <section aria-label="Create a room" className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-xl font-semibold tracking-tight">Create a room</h2>
        <form onSubmit={onCreate} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div>
            <label htmlFor="room-name" className="mb-1 block text-xs text-slate-200">
              Room name
            </label>
            <input
              id="room-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Weekend grinders"
              maxLength={60}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="room-description" className="mb-1 block text-xs text-slate-200">
              Description (optional)
            </label>
            <input
              id="room-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this room for?"
              maxLength={500}
              className={inputClass}
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={creating}>
              {creating ? "Creating…" : "Create room"}
            </Button>
          </div>
        </form>
        {formError && (
          <p role="alert" className="mt-2 text-sm text-red-300">
            {formError}
          </p>
        )}
      </section>

      <section aria-label="Pending invitations" className="mt-4 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-xl font-semibold tracking-tight">Pending invitations</h2>
        {received === null && receivedError && (
          <div className="mt-4">
            <p role="alert" className="text-sm text-red-300">{receivedError}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void loadReceived()}>
              Retry
            </Button>
          </div>
        )}
        {received !== null && received.length === 0 && (
          <p className="mt-4 text-sm text-muted">No pending invitations.</p>
        )}
        {received !== null && received.length > 0 && (
          <ul className="mt-4 space-y-2">
            {received.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium">{inv.roomName}</span>
                  <span className="ml-2 text-xs text-muted">
                    invited by {inv.createdByUsername} · expires {inv.expiresAt.slice(0, 10)}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    disabled={actingOn === inv.id}
                    onClick={() => void onAcceptReceived(inv)}
                  >
                    Accept
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={actingOn === inv.id}
                    onClick={() => void onDeclineReceived(inv)}
                  >
                    Decline
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {receivedMessage && (
          <p
            role={receivedMessage.ok ? "status" : "alert"}
            className={`mt-2 text-sm ${receivedMessage.ok ? "text-emerald-300" : "text-red-300"}`}
          >
            {receivedMessage.text}
          </p>
        )}
      </section>

      <section aria-label="Your rooms" className="mt-4 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-xl font-semibold tracking-tight">Your rooms</h2>
        {loading && <p className="mt-4 text-sm text-muted">Loading rooms…</p>}
        {!loading && error && (
          <div className="mt-4">
            <p role="alert" className="text-sm text-red-300">{error}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        )}
        {!loading && !error && rooms !== null && rooms.length === 0 && (
          <p className="mt-4 text-sm text-muted">
            You are not in any room yet. Create one above, or open an invitation link a friend
            shared with you.
          </p>
        )}
        {!loading && !error && rooms !== null && rooms.length > 0 && (
          <ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {rooms.map((room) => (
              <li key={room.id} className="rounded-md border border-border px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/rooms/${room.id}`}
                    className="font-medium text-cyan-300 hover:underline"
                  >
                    {room.name}
                  </Link>
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
                    {isRoomOwner(room) ? "Owner" : "Member"} · {room.memberCount}
                  </span>
                </div>
                {room.description && (
                  <p className="mt-1 text-sm text-muted">{room.description}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
