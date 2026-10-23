/**
 * Shared contracts for CodePulse personal contests (Module 15).
 *
 * Serializable DTOs shared by the backend API and the Next.js frontend.
 * No server-only imports here: the frontend must be able to use them.
 */

export type ContestStatus = "DRAFT" | "PUBLISHED";
export type ContestDifficulty = "EASY" | "MEDIUM" | "HARD" | "MIXED";
export type AttemptStatus = "IN_PROGRESS" | "COMPLETED" | "EXPIRED";

export const CONTEST_PROBLEM_COUNT = 3;
export const CONTEST_DURATION_MINUTES = 90;
export const POINTS_PER_PROBLEM = 100;

/** Difficulty labels shown in the UI. */
export const DIFFICULTY_LABELS: Record<ContestDifficulty, string> = {
  EASY: "Easy",
  MEDIUM: "Medium",
  HARD: "Hard",
  MIXED: "Mixed",
};

/** Topic tags offered in the contest creation form. */
export const CONTEST_TOPICS: readonly string[] = [
  "Arrays",
  "Strings",
  "Dynamic Programming",
  "Graphs",
  "Trees",
  "Greedy",
  "Binary Search",
  "Backtracking",
] as const;

export type ContestTopic = (typeof CONTEST_TOPICS)[number];

export interface ContestProblemDto {
  id: string;
  platform: "LEETCODE";
  problemId: string; // LeetCode problem slug
  problemKey: string; // LEETCODE::<slug>
  title: string;
  url: string; // Public LeetCode problem URL
  difficulty: string; // "Easy" | "Medium" | "Hard"
  topics: string[];
  position: number; // 1, 2 or 3
}

export interface ContestDto {
  id: string;
  roomId: string;
  roomName: string;
  createdById: string;
  createdByUsername: string;
  name: string;
  description: string | null;
  status: ContestStatus;
  difficulty: ContestDifficulty;
  topics: string[];
  problemCount: number;
  durationMinutes: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  problems: ContestProblemDto[]; // empty until selected / published
  myAttempt: ContestAttemptDto | null; // viewer's attempt, if any
}

export interface ContestSummaryDto {
  id: string;
  roomId: string;
  roomName: string;
  name: string;
  status: ContestStatus;
  difficulty: ContestDifficulty;
  createdByUsername: string;
  createdAt: string;
  publishedAt: string | null;
  participantCount: number;
  completedCount: number;
  expiredCount: number;
}

export interface ContestAttemptProblemDto {
  id: string;
  contestProblemId: string;
  contestProblem: Pick<
    ContestProblemDto,
    "id" | "title" | "url" | "difficulty" | "topics" | "position"
  >;
  completed: boolean;
  completedAt: string | null;
  completedVia: string;
}

export interface ContestAttemptDto {
  id: string;
  contestId: string;
  userId: string;
  user: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  status: AttemptStatus;
  startedAt: string | null;
  deadlineAt: string | null; // server-enforced 90-minute deadline
  completedAt: string | null;
  problemsCompleted: number; // 0..3
  score: number; // problemsCompleted * 100
  createdAt: string;
  updatedAt: string;
  problems: ContestAttemptProblemDto[]; // length 3, one per contest problem
  /** Seconds remaining on the clock; null when not started or finished. */
  secondsRemaining: number | null;
  /** True when the backend has already marked this attempt expired. */
  expired: boolean;
}

export interface ContestLeaderboardEntryDto {
  rank: number;
  user: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  problemsCompleted: number;
  score: number;
  completedAt: string | null; // null when not completed
  status: AttemptStatus;
}

export interface ContestResultsDto {
  contest: Pick<
    ContestDto,
    "id" | "name" | "description" | "difficulty" | "durationMinutes" | "publishedAt"
  >;
  myAttempt: ContestAttemptDto | null;
  leaderboard: ContestLeaderboardEntryDto[];
  /** Participants who have started the contest. */
  startedCount: number;
  /** Participants whose attempt reached COMPLETED. */
  completedCount: number;
  /** Participants whose attempt reached EXPIRED. */
  expiredCount: number;
  /** Average problems solved across started attempts. */
  averageProblemsSolved: number;
  /** Most commonly completed problem (title + count), or null. */
  mostCommonlySolved: { title: string; count: number } | null;
  /** Problem completed by the fewest participants (among started), or null. */
  hardestProblem: { title: string; count: number } | null;
  /** True while results are provisional (not everyone has started/finished). */
  provisional: boolean;
  provisionalNote: string | null;
}

export interface CreateContestRequest {
  name: string;
  description?: string | null;
  difficulty: ContestDifficulty;
  topics: string[];
}

export interface ContestSelectionPreview {
  problems: ContestProblemDto[];
  /** Topics the creator selected that matched at least one chosen problem. */
  matchedTopics: string[];
  /** Whether a full set of 3 problems could be selected. */
  complete: boolean;
}
