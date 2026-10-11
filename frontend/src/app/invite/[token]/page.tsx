"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  acceptInvitation,
  logoutRequest,
  validateInvitation,
  type InvitationPreviewDto,
} from "@/lib/api";
import { Button } from "@/components/ui/button";

export default function InviteAcceptPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const router = useRouter();

  const [preview, setPreview] = useState<InvitationPreviewDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

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
    setInvalid(false);
    setError(null);
    try {
      setPreview(await validateInvitation(token));
    } catch (err) {
      if (redirectIfUnauthorized(err)) return;
      if (err instanceof ApiError && err.status === 404) {
        // Deliberately generic: expired, revoked, exhausted, and unknown
        // tokens all look the same so token existence cannot be probed.
        setInvalid(true);
        setPreview(null);
      } else if (err instanceof ApiError && err.status === 400) {
        setInvalid(true);
        setPreview(null);
      } else {
        setError(err instanceof ApiError ? err.message : "Could not check this invitation.");
      }
    } finally {
      setLoading(false);
    }
  }, [token, redirectIfUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onJoin() {
    setError(null);
    setJoining(true);
    try {
      const result = await acceptInvitation(token);
      // Replace (not push): the raw token leaves the browser URL and history.
      router.replace(`/rooms/${result.roomId}`);
    } catch (err) {
      if (redirectIfUnauthorized(err)) return;
      if (err instanceof ApiError && err.status === 404) {
        setInvalid(true);
        setPreview(null);
      } else {
        setError(err instanceof ApiError ? err.message : "Could not join this room.");
      }
    } finally {
      setJoining(false);
    }
  }

  async function onLogout() {
    await logoutRequest().catch(() => undefined);
    router.replace("/login");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 py-10">
      <header className="flex items-center justify-between border-b border-border pb-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          CodePulse
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/rooms">Rooms</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={onLogout}>
            Log out
          </Button>
        </div>
      </header>

      <section className="py-8" aria-label="Room invitation">
        <h1 className="text-3xl font-bold tracking-tight">Room invitation</h1>

        {loading && <p className="mt-4 text-sm text-muted">Checking invitation…</p>}

        {!loading && invalid && (
          <div className="mt-4">
            <p role="alert" className="text-sm text-red-300">
              This invitation is invalid, expired, revoked, or already used up. Ask the room owner
              for a fresh link.
            </p>
            <Button variant="outline" className="mt-4" asChild>
              <Link href="/rooms">Back to rooms</Link>
            </Button>
          </div>
        )}

        {!loading && !invalid && error && !preview && (
          <div className="mt-4">
            <p role="alert" className="text-sm text-red-300">{error}</p>
            <Button variant="outline" className="mt-4" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        )}

        {!loading && !invalid && preview && (
          <div className="mt-4 rounded-lg border border-border bg-surface p-5">
            <p className="text-sm text-muted">You are invited to join</p>
            <p className="mt-1 text-xl font-semibold">{preview.roomName}</p>
            <p className="mt-1 text-xs text-muted">
              {preview.memberCount} {preview.memberCount === 1 ? "member" : "members"} · expires{" "}
              {preview.expiresAt.slice(0, 10)}
            </p>
            {preview.alreadyMember ? (
              <>
                <p role="status" className="mt-3 text-sm text-emerald-300">
                  You are already a member of this room.
                </p>
                <Button className="mt-4" asChild>
                  <Link href="/rooms">Go to your rooms</Link>
                </Button>
              </>
            ) : (
              <>
                {error && (
                  <p role="alert" className="mt-3 text-sm text-red-300">
                    {error}
                  </p>
                )}
                <Button className="mt-4" disabled={joining} onClick={() => void onJoin()}>
                  {joining ? "Joining…" : "Join room"}
                </Button>
              </>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
