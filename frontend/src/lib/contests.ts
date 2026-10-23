import type {
  ContestAttemptDto,
  ContestDto,
  ContestStatus,
  AttemptStatus,
} from "@codepulse/shared";

/**
 * Pure contests helpers (Module 15). No DOM, no fetch: safe to unit test in
 * the node environment and safe to use from client components.
 */

export const CONTEST_STATUS_LABELS: Record<ContestStatus, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
};

export const ATTEMPT_STATUS_LABELS: Record<AttemptStatus, string> = {
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  EXPIRED: "Expired",
};

/** Format seconds as MM:SS. */
export function formatTimeRemaining(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Time spent between startedAt and completedAt (or now if still running). */
export function formatTimeSpent(
  startedAt: string | null,
  completedAt: string | null
): string {
  const start = startedAt ? Date.parse(startedAt) : null;
  const end = completedAt ? Date.parse(completedAt) : Date.now();
  if (!start) return "—";
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return formatTimeRemaining(seconds);
}

/** Display name with username fallback. */
export function contestMemberDisplayName(user: {
  username: string;
  displayName: string | null;
}): string {
  return user.displayName ?? user.username;
}

/** Rank suffix (1st, 2nd, 3rd, 4th...). */
export function rankSuffix(rank: number): string {
  const rem = rank % 100;
  if (rem >= 11 && rem <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}

/** Whether a contest is still open for attempts (published, not completed globally). */
export function isPublishable(contest: Pick<ContestDto, "status">): boolean {
  return contest.status === "DRAFT";
}

/** Whether the given attempt is actively running right now. */
export function isAttemptRunning(
  attempt: Pick<ContestAttemptDto, "status" | "expired"> | null
): boolean {
  return attempt?.status === "IN_PROGRESS" && !attempt.expired;
}
