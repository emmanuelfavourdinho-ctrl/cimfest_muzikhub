-- CreateEnum
CREATE TYPE "PrimaryUse" AS ENUM ('CREATOR', 'FAN', 'PROFESSIONAL');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('USER', 'MODERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "CreativeRole" AS ENUM ('ARTIST', 'SINGER', 'RAPPER', 'SONGWRITER', 'PRODUCER', 'BEATMAKER', 'DJ', 'AUDIO_ENGINEER', 'RECORDING_ENGINEER', 'MIXING_MASTERING_ENGINEER', 'COMPOSER', 'INSTRUMENTALIST', 'DANCER', 'MANAGER', 'RECORD_LABEL', 'PROMOTER', 'EVENT_ORGANIZER', 'MARKETER', 'TALENT_SCOUT', 'OTHER');

-- CreateEnum
CREATE TYPE "CareerStage" AS ENUM ('EMERGING', 'DEVELOPING', 'ESTABLISHED');

-- CreateEnum
CREATE TYPE "LinkPlatform" AS ENUM ('SPOTIFY', 'APPLE_MUSIC', 'YOUTUBE', 'SOUNDCLOUD', 'AUDIOMACK', 'BOOMPLAY', 'DEEZER', 'BANDCAMP', 'INSTAGRAM', 'TIKTOK', 'FACEBOOK', 'X', 'LINKEDIN', 'WEBSITE');

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "displayUsername" TEXT,
ADD COLUMN     "platformRole" "PlatformRole" NOT NULL DEFAULT 'USER',
ADD COLUMN     "primaryUse" "PrimaryUse",
ADD COLUMN     "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "username" TEXT;

-- CreateTable
CREATE TABLE "profile" (
    "userId" TEXT NOT NULL,
    "bio" TEXT,
    "location" TEXT,
    "roles" "CreativeRole"[],
    "genres" TEXT[],
    "skills" TEXT[],
    "goals" TEXT[],
    "careerStage" "CareerStage",
    "coverUrl" TEXT,
    "onboardingStep" INTEGER NOT NULL DEFAULT 0,
    "onboardingCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "profile_link" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "platform" "LinkPlatform" NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "profile_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "profile_roles_idx" ON "profile" USING GIN ("roles");

-- CreateIndex
CREATE INDEX "profile_genres_idx" ON "profile" USING GIN ("genres");

-- CreateIndex
CREATE INDEX "profile_link_profileId_position_idx" ON "profile_link"("profileId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "profile_link_profileId_url_key" ON "profile_link"("profileId", "url");

-- CreateIndex
CREATE UNIQUE INDEX "user_username_key" ON "user"("username");

-- AddForeignKey
ALTER TABLE "profile" ADD CONSTRAINT "profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_link" ADD CONSTRAINT "profile_link_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

