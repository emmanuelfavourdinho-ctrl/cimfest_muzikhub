-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('MESSAGES', 'COMMUNITIES', 'COLLABORATION', 'COMPETITIONS', 'NETWORK', 'PROMOTIONS');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MediaPurpose" ADD VALUE 'COMMUNITY';
ALTER TYPE "MediaPurpose" ADD VALUE 'COMPETITION';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReportTargetType" ADD VALUE 'COMMUNITY';
ALTER TYPE "ReportTargetType" ADD VALUE 'DISCUSSION';
ALTER TYPE "ReportTargetType" ADD VALUE 'DISCUSSION_COMMENT';
ALTER TYPE "ReportTargetType" ADD VALUE 'COMPETITION';
ALTER TYPE "ReportTargetType" ADD VALUE 'COMPETITION_ENTRY';
ALTER TYPE "ReportTargetType" ADD VALUE 'MESSAGE';

-- CreateTable
CREATE TABLE "user_block" (
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_block_pkey" PRIMARY KEY ("blockerId","blockedId")
);

-- CreateTable
CREATE TABLE "notification_setting" (
    "userId" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_setting_pkey" PRIMARY KEY ("userId","category")
);

-- CreateIndex
CREATE INDEX "user_block_blockedId_idx" ON "user_block"("blockedId");

-- AddForeignKey
ALTER TABLE "user_block" ADD CONSTRAINT "user_block_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_block" ADD CONSTRAINT "user_block_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_setting" ADD CONSTRAINT "notification_setting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_block" ADD CONSTRAINT "user_block_not_self" CHECK ("blockerId" <> "blockedId");
