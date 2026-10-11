-- AlterTable
ALTER TABLE "RoomInvitation" ADD COLUMN     "invitedUserId" UUID;

-- CreateIndex
CREATE INDEX "RoomInvitation_invitedUserId_idx" ON "RoomInvitation"("invitedUserId");

-- AddForeignKey
ALTER TABLE "RoomInvitation" ADD CONSTRAINT "RoomInvitation_invitedUserId_fkey" FOREIGN KEY ("invitedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
