import { Prisma } from "@prisma/client";
import { assertDatabaseConfigured, prisma } from "../../db/prisma";
import { HttpError } from "../../utils/httpError";
import {
  ContestAttemptDto,
  ContestDto,
  ContestLeaderboardEntryDto,
  ContestResultsDto,
  AttemptStatus,
  CONTEST_DURATION_MINUTES,
  CONTEST_PROBLEM_COUNT,
  POINTS_PER_PROBLEM,
} from "@codepulse/shared";
import type { ContestDifficulty } from "@codepulse/shared";
import { selectProblems } from "./problemCatalog";
import type { CreateContestInput } from "./schemas";

type FullContest = Prisma.ContestGetPayload<{
  include: {
    room: { select: { id: true; name: true } };
    createdBy: { select: { username: true } };
    problems: { orderBy: { position: "asc" } };
    attempts: {
      where: { userId: string };
      include: {
        user: { select: { id: true; username: true; displayName: true; avatarUrl: true } };
        problems: { include: { contestProblem: true } };
      };
    };
  };
}>;

type FullAttempt = Prisma.ContestAttemptGetPayload<{
  include: {
    problems: { include: { contestProblem: true } };
    user: { select: { id: true; username: true; displayName: true; avatarUrl: true } };
  };
}>;

type FullAttemptProblem = Prisma.ContestAttemptProblemGetPayload<{
  include: { contestProblem: true };
}>;

const DURATION_MS = CONTEST_DURATION_MINUTES * 60 * 1000;

/** Valid topic tags offered in the creation form (and known catalog tags). */
const VALID_TOPICS = new Set([
  "Arrays",
  "Strings",
  "Dynamic Programming",
  "Graphs",
  "Trees",
  "Greedy",
  "Binary Search",
  "Backtracking",
  "Hash Table",
  "Two Pointers",
  "Stack",
  "Linked List",
  "Sorting",
  "Divide and Conquer",
  "Math",
  "Trie",
  "Tree",
  "Breadth-First Search",
  "Depth-First Search",
  "Binary Search Tree",
  "Union Find",
  "Matrix",
  "Topological Sort",
  "Recursion",
  "Heap",
  "Merge Sort",
  "Monotonic Stack",
]);

function isValidTopic(topic: string): boolean {
  return VALID_TOPICS.has(topic);
}

function toTopicArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((t): t is string => typeof t === "string");
}

function problemDto(p: Prisma.ContestProblemGetPayload<{}>): ContestDto["problems"][number] {
  return {
    id: p.id,
    platform: "LEETCODE",
    problemId: p.problemId,
    problemKey: p.problemKey,
    title: p.title,
    url: p.url,
    difficulty: p.difficulty,
    topics: toTopicArray(p.topics),
    position: p.position,
  };
}

function attemptProblemDto(
  ap: FullAttemptProblem
): ContestAttemptDto["problems"][number] {
  const p = ap.contestProblem;
  return {
    id: ap.id,
    contestProblemId: ap.contestProblemId,
    contestProblem: {
      id: p.id,
      title: p.title,
      url: p.url,
      difficulty: p.difficulty,
      topics: toTopicArray(p.topics),
      position: p.position,
    },
    completed: ap.completed,
    completedAt: ap.completedAt?.toISOString() ?? null,
    completedVia: ap.completedVia,
  };
}

function secondsRemaining(deadlineAt: Date | null, now: Date): number | null {
  if (!deadlineAt) return null;
  const remaining = deadlineAt.getTime() - now.getTime();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

function attemptDto(attempt: FullAttempt, now: Date): ContestAttemptDto {
  // Server-side expiry: an in-progress attempt past its deadline is expired,
  // enforced by the backend regardless of the frontend countdown.
  let status: AttemptStatus = attempt.status;
  if (status === "IN_PROGRESS" && attempt.deadlineAt && now > attempt.deadlineAt) {
    status = "EXPIRED";
  }
  return {
    id: attempt.id,
    contestId: attempt.contestId,
    userId: attempt.userId,
    user: {
      id: attempt.user.id,
      username: attempt.user.username,
      displayName: attempt.user.displayName,
      avatarUrl: attempt.user.avatarUrl,
    },
    status,
    startedAt: attempt.startedAt?.toISOString() ?? null,
    deadlineAt: attempt.deadlineAt?.toISOString() ?? null,
    completedAt: attempt.completedAt?.toISOString() ?? null,
    problemsCompleted: attempt.problemsCompleted,
    score: attempt.score,
    createdAt: attempt.createdAt.toISOString(),
    updatedAt: attempt.updatedAt.toISOString(),
    problems: attempt.problems.map(attemptProblemDto),
    secondsRemaining:
      status === "IN_PROGRESS" && attempt.deadlineAt
        ? secondsRemaining(attempt.deadlineAt, now)
        : null,
    expired: status === "EXPIRED",
  };
}

function toContestDto(contest: FullContest, myAttempt: ContestAttemptDto | null): ContestDto {
  return {
    id: contest.id,
    roomId: contest.roomId,
    roomName: contest.room.name,
    createdById: contest.createdById,
    createdByUsername: contest.createdBy.username,
    name: contest.name,
    description: contest.description,
    status: contest.status as "DRAFT" | "PUBLISHED",
    difficulty: contest.difficulty as ContestDifficulty,
    topics: toTopicArray(contest.topics),
    problemCount: contest.problemCount,
    durationMinutes: contest.durationMinutes,
    publishedAt: contest.publishedAt?.toISOString() ?? null,
    createdAt: contest.createdAt.toISOString(),
    updatedAt: contest.updatedAt.toISOString(),
    problems: contest.problems.map(problemDto),
    myAttempt,
  };
}

/** Competition ranking: 1, 2, 2, 4. Ties share a rank. */
function rankCompletedAttempts(
  attempts: Array<{ problemsCompleted: number; score: number; completedAt: Date | null }>
): number[] {
  const ranks = new Array(attempts.length).fill(0);
  let rank = 0;
  for (let i = 0; i < attempts.length; i += 1) {
    if (i === 0) {
      rank = 1;
    } else {
      const prev = attempts[i - 1];
      const cur = attempts[i];
      const tied =
        prev.problemsCompleted === cur.problemsCompleted &&
        prev.score === cur.score &&
        ((prev.completedAt === null && cur.completedAt === null) ||
          (prev.completedAt !== null &&
            cur.completedAt !== null &&
            prev.completedAt.getTime() === cur.completedAt.getTime()));
      rank = tied ? rank : i + 1;
    }
    ranks[i] = rank;
  }
  return ranks;
}

async function membershipOf(roomId: string, userId: string) {
  return prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
  });
}

async function requireContestMember(contestId: string, userId: string) {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    select: { id: true, roomId: true },
  });
  if (!contest) {
    throw new HttpError(404, "Contest not found.");
  }
  const membership = await membershipOf(contest.roomId, userId);
  if (!membership) {
    throw new HttpError(404, "Contest not found.");
  }
  return contest;
}

export async function createContest(
  userId: string,
  input: CreateContestInput & { roomId: string }
): Promise<ContestDto> {
  assertDatabaseConfigured();
  const now = new Date();

  const topics = (input.topics ?? []).filter((t) => t.length > 0);
  for (const t of topics) {
    if (!isValidTopic(t)) {
      throw new HttpError(400, `Unknown topic tag: "${t}".`);
    }
  }

  const room = await prisma.room.findUnique({
    where: { id: input.roomId },
    select: { id: true, name: true, members: { select: { userId: true } } },
  });
  if (!room || !room.members.some((m) => m.userId === userId)) {
    throw new HttpError(404, "Room not found.");
  }

  const selection = selectProblems({
    difficulty: input.difficulty as ContestDifficulty,
    topics,
    seed: 0,
    limit: CONTEST_PROBLEM_COUNT,
  });

  const created = await prisma.contest.create({
    data: {
      roomId: input.roomId,
      createdById: userId,
      name: input.name.trim(),
      description: input.description ?? null,
      status: "DRAFT",
      difficulty: input.difficulty as ContestDifficulty,
      topics: topics.length > 0 ? topics : Prisma.JsonNull,
      problemCount: CONTEST_PROBLEM_COUNT,
      durationMinutes: CONTEST_DURATION_MINUTES,
      problems: {
        create: selection.problems.map((p) => ({
          platform: "LEETCODE",
          problemId: p.slug,
          problemKey: p.problemKey,
          title: p.title,
          url: p.url,
          difficulty: p.difficulty,
          topics: p.topics as Prisma.InputJsonValue,
          position: p.position,
        })),
      },
    },
    include: {
      room: { select: { id: true, name: true } },
      createdBy: { select: { username: true } },
      problems: { orderBy: { position: "asc" } },
    },
  });

  return toContestDto(created as unknown as FullContest, null);
}

export async function getContest(
  userId: string,
  contestId: string,
  now: Date = new Date()
): Promise<ContestDto> {
  assertDatabaseConfigured();
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    include: {
      room: { select: { id: true, name: true } },
      createdBy: { select: { username: true } },
      problems: { orderBy: { position: "asc" } },
      attempts: {
        where: { userId },
        include: {
          user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
          problems: { include: { contestProblem: true } },
        },
      },
    },
  });
  if (!contest) {
    throw new HttpError(404, "Contest not found.");
  }
  const membership = await membershipOf(contest.roomId, userId);
  if (!membership) {
    throw new HttpError(404, "Contest not found.");
  }

  const myAttempt = contest.attempts[0]
    ? attemptDto(contest.attempts[0] as unknown as FullAttempt, now)
    : null;
  return toContestDto(contest as unknown as FullContest, myAttempt);
}

export async function regenerateContest(
  userId: string,
  contestId: string
): Promise<ContestDto> {
  assertDatabaseConfigured();
  const now = new Date();
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    include: {
      room: { select: { id: true, name: true, members: { select: { userId: true } } } },
    },
  });
  if (!contest) {
    throw new HttpError(404, "Contest not found.");
  }
  if (!contest.room.members.some((m) => m.userId === userId)) {
    throw new HttpError(404, "Contest not found.");
  }
  if (contest.status !== "DRAFT") {
    throw new HttpError(400, "Only draft contests can be regenerated.");
  }
  if (contest.createdById !== userId) {
    throw new HttpError(403, "Only the contest creator can regenerate the problems.");
  }

  const selection = selectProblems({
    difficulty: contest.difficulty as ContestDifficulty,
    topics: toTopicArray(contest.topics),
    seed: Date.now(),
    limit: CONTEST_PROBLEM_COUNT,
  });

  await prisma.$transaction(async (tx) => {
    await tx.contestProblem.deleteMany({ where: { contestId } });
    for (const problem of selection.problems) {
      await tx.contestProblem.create({
        data: {
          contestId,
          platform: "LEETCODE",
          problemId: problem.slug,
          problemKey: problem.problemKey,
          title: problem.title,
          url: problem.url,
          difficulty: problem.difficulty,
          topics: problem.topics as Prisma.InputJsonValue,
          position: problem.position,
        },
      });
    }
  });

  return getContest(userId, contestId, now);
}

export async function publishContest(
  userId: string,
  contestId: string
): Promise<ContestDto> {
  assertDatabaseConfigured();
  const now = new Date();
  const contest = await requireContestMember(contestId, userId);
  const full = await prisma.contest.findUnique({
    where: { id: contestId },
    include: { createdBy: { select: { username: true } } },
  });
  if (!full || full.createdById !== userId) {
    throw new HttpError(full ? 403 : 404, "Only the contest creator can publish it.");
  }
  if (full.status !== "DRAFT") {
    throw new HttpError(400, "Only draft contests can be published.");
  }

  const problemCount = await prisma.contestProblem.count({ where: { contestId } });
  if (problemCount === 0) {
    throw new HttpError(400, "A contest must have at least one problem before publishing.");
  }

  await prisma.contest.update({
    where: { id: contestId },
    data: { status: "PUBLISHED", publishedAt: now },
  });
  return getContest(userId, contestId, now);
}

export async function startContest(
  userId: string,
  contestId: string,
  now: Date = new Date()
): Promise<ContestAttemptDto> {
  assertDatabaseConfigured();
  const contest = await requireContestMember(contestId, userId);
  const full = await prisma.contest.findUnique({
    where: { id: contestId },
    include: { problems: { orderBy: { position: "asc" } } },
  });
  if (!full) {
    throw new HttpError(404, "Contest not found.");
  }
  if (full.status !== "PUBLISHED") {
    throw new HttpError(400, "This contest has not been published yet.");
  }

  const deadlineAt = new Date(now.getTime() + DURATION_MS);

  try {
    const attemptEntity = await prisma.$transaction(async (tx) => {
      const existing = await tx.contestAttempt.findUnique({
        where: { contestId_userId: { contestId, userId } },
        include: {
          problems: { include: { contestProblem: true } },
          user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        },
      });
      if (existing) {
        return existing as unknown as FullAttempt;
      }
      const created = await tx.contestAttempt.create({
        data: {
          contestId,
          userId,
          status: "IN_PROGRESS",
          startedAt: now,
          deadlineAt,
        },
        include: {
          problems: { include: { contestProblem: true } },
          user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        },
      });
      if (created.problems.length === 0) {
        for (const p of full.problems) {
          await tx.contestAttemptProblem.create({
            data: { attemptId: created.id, contestProblemId: p.id, completed: false },
          });
        }
        // Refetch so the returned attempt carries its three problem rows.
        const refreshed = await tx.contestAttempt.findUnique({
          where: { id: created.id },
          include: {
            problems: { include: { contestProblem: true } },
            user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
          },
        });
        return refreshed as unknown as FullAttempt;
      }
      return created as unknown as FullAttempt;
    });
    return attemptDto(attemptEntity, now);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const fresh = await prisma.contestAttempt.findUnique({
        where: { contestId_userId: { contestId, userId } },
        include: {
          problems: { include: { contestProblem: true } },
          user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        },
      });
      if (!fresh) throw err;
      return attemptDto(fresh as unknown as FullAttempt, now);
    }
    throw err;
  }
}

export async function getAttempt(
  userId: string,
  contestId: string,
  now: Date = new Date()
): Promise<ContestAttemptDto> {
  assertDatabaseConfigured();
  const dto = await getContest(userId, contestId, now);
  if (!dto.myAttempt) {
    throw new HttpError(404, "You have not started this contest.");
  }
  return dto.myAttempt;
}

export async function completeProblem(
  userId: string,
  contestId: string,
  problemId: string,
  now: Date = new Date()
): Promise<ContestAttemptDto> {
  assertDatabaseConfigured();
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    include: {
      room: { select: { id: true } },
      problems: { where: { id: problemId } },
    },
  });
  if (!contest) {
    throw new HttpError(404, "Contest not found.");
  }
  const membership = await membershipOf(contest.roomId, userId);
  if (!membership) {
    throw new HttpError(404, "Contest not found.");
  }
  const problem = contest.problems[0];
  if (!problem) {
    throw new HttpError(404, "Problem not found in this contest.");
  }

  const attempt = await prisma.contestAttempt.findUnique({
    where: { contestId_userId: { contestId, userId } },
    include: {
      problems: { where: { contestProblemId: problemId } },
      user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
    },
  });
  if (!attempt) {
    throw new HttpError(404, "You have not started this contest.");
  }

  const totalProblems = await prisma.contestProblem.count({ where: { contestId } });
  if (attempt.status !== "IN_PROGRESS") {
    throw new HttpError(400, "This attempt is already finished and cannot be changed.");
  }
  if (attempt.deadlineAt && now > attempt.deadlineAt) {
    await prisma.contestAttempt.update({
      where: { id: attempt.id },
      data: { status: "EXPIRED" },
    });
    throw new HttpError(400, "The contest deadline has passed; this attempt is expired.");
  }

  const attemptProblem = attempt.problems[0];
  if (!attemptProblem) {
    throw new HttpError(404, "Problem not found in this attempt.");
  }
  if (attemptProblem.completed) {
    return getAttempt(userId, contestId, now);
  }

  const problemsCompleted = attempt.problemsCompleted + 1;
  const score = problemsCompleted * POINTS_PER_PROBLEM;
  const allDone = problemsCompleted >= totalProblems;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.contestAttemptProblem.update({
      where: { id: attemptProblem.id },
      data: { completed: true, completedAt: now },
    });
    return tx.contestAttempt.update({
      where: { id: attempt.id },
      data: {
        problemsCompleted,
        score,
        ...(allDone ? { status: "COMPLETED", completedAt: now } : {}),
      },
      include: {
        problems: { include: { contestProblem: true } },
        user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      },
    });
  });

  return attemptDto(updated as unknown as FullAttempt, now);
}

interface ContestListItem {
  id: string;
  roomId: string;
  roomName: string;
  name: string;
  status: "DRAFT" | "PUBLISHED";
  difficulty: ContestDifficulty;
  createdAt: string;
  publishedAt: string | null;
  participantCount: number;
  completedCount: number;
  expiredCount: number;
}

export async function listContests(
  userId: string,
  filters: { roomId?: string },
  now: Date = new Date()
): Promise<ContestListItem[]> {
  assertDatabaseConfigured();
  const contests = await prisma.contest.findMany({
    where: filters.roomId ? { roomId: filters.roomId } : {},
    include: {
      room: { select: { id: true, name: true } },
      attempts: {
        select: { id: true, status: true, completedAt: true, problemsCompleted: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const roomIds = [...new Set(contests.map((c) => c.roomId))];
  const memberships = await prisma.roomMember.findMany({
    where: { userId, roomId: { in: roomIds } },
    select: { roomId: true },
  });
  const allowedRooms = new Set(memberships.map((m) => m.roomId));

  return contests
    .filter((c) => allowedRooms.has(c.roomId))
    .map((c) => {
      const attempts = c.attempts as Array<{ status: string; problemsCompleted: number }>;
      const started = attempts.length;
      const completed = attempts.filter((a) => a.status === "COMPLETED").length;
      const expired = attempts.filter((a) => a.status === "EXPIRED").length;
      return {
        id: c.id,
        roomId: c.roomId,
        roomName: c.room.name,
        name: c.name,
        status: c.status as "DRAFT" | "PUBLISHED",
        difficulty: c.difficulty as ContestDifficulty,
        createdAt: c.createdAt.toISOString(),
        publishedAt: c.publishedAt?.toISOString() ?? null,
        participantCount: started,
        completedCount: completed,
        expiredCount: expired,
      } as ContestListItem;
    });
}

export async function getResults(
  userId: string,
  contestId: string,
  now: Date = new Date()
): Promise<ContestResultsDto> {
  assertDatabaseConfigured();
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    include: {
      room: { select: { id: true, name: true } },
      problems: { orderBy: { position: "asc" } },
      attempts: {
        include: {
          user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
          problems: true,
        },
      },
    },
  });
  if (!contest) {
    throw new HttpError(404, "Contest not found.");
  }
  const membership = await membershipOf(contest.roomId, userId);
  if (!membership) {
    throw new HttpError(404, "Contest not found.");
  }

  const attempts = contest.attempts as Array<{
    id: string;
    userId: string;
    user: { id: string; username: string; displayName: string | null; avatarUrl: string | null };
    status: AttemptStatus;
    startedAt: Date | null;
    deadlineAt: Date | null;
    completedAt: Date | null;
    problemsCompleted: number;
    score: number;
    problems: Array<{ completed: boolean; completedAt: Date | null; contestProblemId: string }>;
  }>;

  const processed = attempts.map((a) => {
    let status: AttemptStatus = a.status;
    let completedAt = a.completedAt;
    if (status === "IN_PROGRESS" && a.deadlineAt && now > a.deadlineAt) {
      status = "EXPIRED";
    }
    return { ...a, status, completedAt };
  });

  const myAttemptRow = processed.find((a) => a.userId === userId);
  const startedCount = processed.length;
  const completedCount = processed.filter((a) => a.status === "COMPLETED").length;
  const expiredCount = processed.filter((a) => a.status === "EXPIRED").length;

  const ranked = processed
    .filter((a) => a.status === "COMPLETED")
    .sort((a, b) => {
      if (b.problemsCompleted !== a.problemsCompleted) return b.problemsCompleted - a.problemsCompleted;
      if (b.score !== a.score) return b.score - a.score;
      if (a.completedAt === null && b.completedAt === null) return 0;
      if (a.completedAt === null) return 1;
      if (b.completedAt === null) return -1;
      return a.completedAt.getTime() - b.completedAt.getTime();
    });
  const ranks = rankCompletedAttempts(
    ranked.map((a) => ({
      problemsCompleted: a.problemsCompleted,
      score: a.score,
      completedAt: a.completedAt,
    }))
  );

  const leaderboard: ContestLeaderboardEntryDto[] = ranked.map((a, i) => ({
    rank: ranks[i],
    user: {
      id: a.user.id,
      username: a.user.username,
      displayName: a.user.displayName,
      avatarUrl: a.user.avatarUrl,
    },
    problemsCompleted: a.problemsCompleted,
    score: a.score,
    completedAt: a.completedAt?.toISOString() ?? null,
    status: a.status,
  }));

  const problemSolvedCount = new Map<string, { title: string; count: number }>();
  for (const p of contest.problems) {
    problemSolvedCount.set(p.id, { title: p.title, count: 0 });
  }
  for (const a of processed) {
    if (a.status !== "COMPLETED") continue;
    for (const p of a.problems) {
      if (p.completed) {
        const entry = problemSolvedCount.get(p.contestProblemId);
        if (entry) entry.count += 1;
      }
    }
  }
  const counts = [...problemSolvedCount.values()].filter((e) => e.count > 0);
  const mostCommonlySolved =
    counts.length > 0
      ? counts.reduce((best, e) => (e.count > best.count ? e : best), counts[0])
      : null;
  const hardestProblem =
    counts.length > 0
      ? counts.reduce((best, e) => (e.count < best.count ? e : best), counts[0])
      : null;

  const averageProblemsSolved =
    startedCount > 0
      ? processed.reduce((sum, a) => sum + a.problemsCompleted, 0) / startedCount
      : 0;

  const allStarted = startedCount > 0;
  const allFinished = completedCount + expiredCount === startedCount;
  const provisional = allStarted && !allFinished;

  const problemMap = new Map(contest.problems.map((p) => [p.id, p]));

  return {
    contest: {
      id: contest.id,
      name: contest.name,
      description: contest.description,
      difficulty: contest.difficulty as ContestDifficulty,
      durationMinutes: contest.durationMinutes,
      publishedAt: contest.publishedAt?.toISOString() ?? null,
    },
    myAttempt: myAttemptRow
      ? attemptDto(
          {
            ...myAttemptRow,
            problems: myAttemptRow.problems.map((p) => ({
              ...p,
              contestProblem: problemMap.get(p.contestProblemId)!,
            })),
          } as unknown as FullAttempt,
          now
        )
      : null,
    leaderboard,
    startedCount,
    completedCount,
    expiredCount,
    averageProblemsSolved: Math.round(averageProblemsSolved * 10) / 10,
    mostCommonlySolved,
    hardestProblem,
    provisional,
    provisionalNote: provisional
      ? "Results are provisional: not every room member has started or finished the contest yet."
      : null,
  };
}
