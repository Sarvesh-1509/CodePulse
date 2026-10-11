-- CreateTable
CREATE TABLE "DailyActivity" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "linkedAccountId" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "date" DATE NOT NULL,
    "submissions" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'LEETCODE_CALENDAR',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyActivity_userId_date_idx" ON "DailyActivity"("userId", "date");

-- CreateIndex
CREATE INDEX "DailyActivity_linkedAccountId_idx" ON "DailyActivity"("linkedAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyActivity_linkedAccountId_platform_date_key" ON "DailyActivity"("linkedAccountId", "platform", "date");

-- AddForeignKey
ALTER TABLE "DailyActivity" ADD CONSTRAINT "DailyActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyActivity" ADD CONSTRAINT "DailyActivity_linkedAccountId_fkey" FOREIGN KEY ("linkedAccountId") REFERENCES "LinkedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
