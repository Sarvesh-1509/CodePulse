"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ApiError,
  createContest,
  type ContestDifficulty,
  CONTEST_TOPICS,
} from "@/lib/api";
import { Button } from "@/components/ui/button";

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none";

function toMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export default function CreateContestPage() {
  const router = useRouter();
  const [roomId, setRoomId] = useState<string | null>(null);

  useEffect(() => {
    let params: string | null = null;
    if (typeof window !== "undefined") {
      params = new URLSearchParams(window.location.search).get("roomId");
    }
    setRoomId(params);
  }, []);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [difficulty, setDifficulty] = useState<ContestDifficulty>("MIXED");
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  const toggleTopic = useCallback((topic: string) => {
    setSelectedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) next.delete(topic);
      else next.add(topic);
      return next;
    });
  }, []);

  const isTopicSelected = useCallback((topic: string) => selectedTopics.has(topic), [
    selectedTopics,
  ]);

  const onSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setError(null);
      setMessage(null);
      if (!roomId) {
        setError("No room specified.");
        return;
      }
      setCreating(true);
      try {
        const { contest } = await createContest({
          roomId,
          name: name.trim(),
          description: description.trim() === "" ? null : description.trim(),
          difficulty,
          topics: [...selectedTopics],
        });
        setMessage("Draft contest created — review the problems and publish when ready.");
        void router.push(`/contests/${contest.id}`);
      } catch (err) {
        if (!redirectIfUnauthorized(err)) {
          setError(toMessage(err, "Could not create the contest."));
        }
      } finally {
        setCreating(false);
      }
    },
    [roomId, name, description, difficulty, selectedTopics, router, redirectIfUnauthorized]
  );

  if (!roomId) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-6">
        <p role="alert" className="text-red-300">No room specified.</p>
        <Button variant="outline" className="mt-4" asChild>
          <Link href="/rooms">Back to rooms</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 py-10">
      <header className="flex items-center justify-between border-b border-border pb-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">CodePulse</Link>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/rooms/${roomId}`}>Back to room</Link>
          </Button>
        </div>
      </header>

      <h1 className="text-3xl font-bold tracking-tight py-8">Create Contest</h1>

      <form onSubmit={onSubmit} className="space-y-6">
        <div>
          <label htmlFor="contest-name" className="mb-1 block text-sm text-slate-200">
            Contest name
          </label>
          <input
            id="contest-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Weekend Warm-up"
            maxLength={100}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="contest-description" className="mb-1 block text-sm text-slate-200">
            Description (optional)
          </label>
          <textarea
            id="contest-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this contest about?"
            maxLength={1000}
            rows={3}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="contest-difficulty" className="mb-1 block text-sm text-slate-200">
            Problem difficulty
          </label>
          <div id="contest-difficulty" className="mt-1 flex gap-2">
            {["EASY", "MEDIUM", "HARD", "MIXED"].map((value) => (
              <Button
                key={value}
                variant={difficulty === value ? "default" : "outline"}
                size="sm"
                onClick={() => setDifficulty(value as ContestDifficulty)}
              >
                {value === "MIXED" ? "Mixed" : value}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="contest-topics" className="mb-1 block text-sm text-slate-200">
            Topics
          </label>
          <p className="mt-1 text-xs text-muted">
            Problems are selected from CodePulse&apos;s LeetCode catalog. Pick the topics you want
            to practice.
          </p>
          <div id="contest-topics" className="mt-2 flex flex-wrap gap-2">
            {CONTEST_TOPICS.map((topic) => (
              <Button
                key={topic}
                variant={isTopicSelected(topic) ? "default" : "outline"}
                size="sm"
                onClick={() => toggleTopic(topic)}
              >
                {topic}
              </Button>
            ))}
          </div>
        </div>

        <div className="pt-4 flex gap-3">
          <Button type="submit" disabled={creating}>
            {creating ? "Creating…" : "Create draft contest"}
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/rooms/${roomId}`}>Cancel</Link>
          </Button>
        </div>

        {error && (
          <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>
        )}
        {message && (
          <p role="status" className="mt-2 text-sm text-emerald-300">{message}</p>
        )}
      </form>

      <p className="mt-8 text-xs text-muted">
        Three problems are selected automatically from CodePulse&apos;s LeetCode catalog based on your
        difficulty and topic choices. You can review and regenerate them before publishing.
      </p>
    </main>
  );
}
