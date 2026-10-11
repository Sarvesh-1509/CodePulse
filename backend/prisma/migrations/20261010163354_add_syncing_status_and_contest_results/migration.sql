-- AlterEnum
ALTER TYPE "ConnectionStatus" ADD VALUE 'SYNCING';

-- CreateTable
CREATE TABLE "ContestResult" (
    "id" UUID NOT NULL,
    "linkedAccountId" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "externalContestId" TEXT NOT NULL,
    "contestName" TEXT NOT NULL,
    "contestedAt" TIMESTAMP(3) NOT NULL,
    "ratingBefore" INTEGER,
    "ratingChange" INTEGER,
    "ratingAfter" INTEGER,
    "rank" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContestResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContestResult_linkedAccountId_contestedAt_idx" ON "ContestResult"("linkedAccountId", "contestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContestResult_linkedAccountId_externalContestId_key" ON "ContestResult"("linkedAccountId", "externalContestId");

-- AddForeignKey
ALTER TABLE "ContestResult" ADD CONSTRAINT "ContestResult_linkedAccountId_fkey" FOREIGN KEY ("linkedAccountId") REFERENCES "LinkedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
