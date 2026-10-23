-- CreateEnum
CREATE TYPE "ContestStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ContestDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD', 'MIXED');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Contest" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ContestStatus" NOT NULL DEFAULT 'DRAFT',
    "difficulty" "ContestDifficulty" NOT NULL DEFAULT 'MIXED',
    "topics" JSONB,
    "problemCount" INTEGER NOT NULL DEFAULT 3,
    "durationMinutes" INTEGER NOT NULL DEFAULT 90,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestProblem" (
    "id" UUID NOT NULL,
    "contestId" UUID NOT NULL,
    "platform" "Platform" NOT NULL DEFAULT 'LEETCODE',
    "problemId" TEXT NOT NULL,
    "problemKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "topics" JSONB NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ContestProblem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestAttempt" (
    "id" UUID NOT NULL,
    "contestId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "problemsCompleted" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContestAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestAttemptProblem" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "contestProblemId" UUID NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "completedVia" TEXT NOT NULL DEFAULT 'MANUAL',

    CONSTRAINT "ContestAttemptProblem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contest_roomId_idx" ON "Contest"("roomId");

-- CreateIndex
CREATE INDEX "Contest_createdById_idx" ON "Contest"("createdById");

-- CreateIndex
CREATE INDEX "Contest_status_idx" ON "Contest"("status");

-- CreateIndex
CREATE INDEX "ContestProblem_contestId_idx" ON "ContestProblem"("contestId");

-- CreateIndex
CREATE UNIQUE INDEX "ContestProblem_contestId_position_key" ON "ContestProblem"("contestId", "position");

-- CreateIndex
CREATE INDEX "ContestAttempt_contestId_idx" ON "ContestAttempt"("contestId");

-- CreateIndex
CREATE INDEX "ContestAttempt_userId_idx" ON "ContestAttempt"("userId");

-- CreateIndex
CREATE INDEX "ContestAttempt_status_idx" ON "ContestAttempt"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ContestAttempt_contestId_userId_key" ON "ContestAttempt"("contestId", "userId");

-- CreateIndex
CREATE INDEX "ContestAttemptProblem_attemptId_idx" ON "ContestAttemptProblem"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "ContestAttemptProblem_attemptId_contestProblemId_key" ON "ContestAttemptProblem"("attemptId", "contestProblemId");

-- AddForeignKey
ALTER TABLE "Contest" ADD CONSTRAINT "Contest_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contest" ADD CONSTRAINT "Contest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestProblem" ADD CONSTRAINT "ContestProblem_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestAttempt" ADD CONSTRAINT "ContestAttempt_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestAttempt" ADD CONSTRAINT "ContestAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestAttemptProblem" ADD CONSTRAINT "ContestAttemptProblem_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ContestAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestAttemptProblem" ADD CONSTRAINT "ContestAttemptProblem_contestProblemId_fkey" FOREIGN KEY ("contestProblemId") REFERENCES "ContestProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
