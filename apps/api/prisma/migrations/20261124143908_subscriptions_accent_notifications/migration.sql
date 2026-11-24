-- CreateEnum
CREATE TYPE "ProfileAccent" AS ENUM ('LIME', 'GOLD', 'VIOLET', 'SKY', 'MINT');

-- AlterTable
ALTER TABLE "profile" ADD COLUMN     "accent" "ProfileAccent";

-- AlterTable
ALTER TABLE "subscription" ADD COLUMN     "cancelledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_dedupeKey_key" ON "notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "notification_userId_createdAt_idx" ON "notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "notification_userId_readAt_idx" ON "notification"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Notification links are in-app paths only.
ALTER TABLE "notification" ADD CONSTRAINT "notification_link_check" CHECK ("link" IS NULL OR "link" ~ '^/[^/]');
