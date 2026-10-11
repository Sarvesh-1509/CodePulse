-- AlterTable
ALTER TABLE "User" ADD COLUMN     "showOnLeaderboard" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "RoomInvitation" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoomInvitation_tokenHash_key" ON "RoomInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "RoomInvitation_roomId_idx" ON "RoomInvitation"("roomId");

-- AddForeignKey
ALTER TABLE "RoomInvitation" ADD CONSTRAINT "RoomInvitation_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomInvitation" ADD CONSTRAINT "RoomInvitation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
