-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'AUDIO', 'VIDEO');

-- CreateEnum
CREATE TYPE "MediaPurpose" AS ENUM ('AVATAR', 'COVER', 'PORTFOLIO', 'POST');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'READY', 'DELETING');

-- CreateEnum
CREATE TYPE "PortfolioType" AS ENUM ('AUDIO', 'BEAT', 'VIDEO', 'IMAGE', 'PROJECT');

-- CreateEnum
CREATE TYPE "PortfolioStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- AlterTable
ALTER TABLE "profile" DROP COLUMN "coverUrl",
ADD COLUMN     "avatarAssetId" TEXT,
ADD COLUMN     "coverAssetId" TEXT;

-- CreateTable
CREATE TABLE "media_asset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "purpose" "MediaPurpose" NOT NULL,
    "status" "MediaStatus" NOT NULL DEFAULT 'PENDING',
    "publicId" TEXT NOT NULL,
    "format" TEXT,
    "bytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "version" INTEGER,
    "originalFilename" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),

    CONSTRAINT "media_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_item" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "type" "PortfolioType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "genres" TEXT[],
    "credits" TEXT,
    "externalUrl" TEXT,
    "externalPlatform" "LinkPlatform",
    "mediaAssetId" TEXT,
    "coverAssetId" TEXT,
    "status" "PortfolioStatus" NOT NULL DEFAULT 'DRAFT',
    "visibility" "Visibility" NOT NULL DEFAULT 'PUBLIC',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_asset_publicId_key" ON "media_asset"("publicId");

-- CreateIndex
CREATE INDEX "media_asset_ownerId_status_idx" ON "media_asset"("ownerId", "status");

-- CreateIndex
CREATE INDEX "media_asset_status_createdAt_idx" ON "media_asset"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_item_mediaAssetId_key" ON "portfolio_item"("mediaAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_item_coverAssetId_key" ON "portfolio_item"("coverAssetId");

-- CreateIndex
CREATE INDEX "portfolio_item_ownerId_status_idx" ON "portfolio_item"("ownerId", "status");

-- CreateIndex
CREATE INDEX "portfolio_item_status_visibility_publishedAt_idx" ON "portfolio_item"("status", "visibility", "publishedAt");

-- CreateIndex
CREATE INDEX "portfolio_item_genres_idx" ON "portfolio_item" USING GIN ("genres");

-- CreateIndex
CREATE UNIQUE INDEX "profile_avatarAssetId_key" ON "profile"("avatarAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "profile_coverAssetId_key" ON "profile"("coverAssetId");

-- AddForeignKey
ALTER TABLE "profile" ADD CONSTRAINT "profile_avatarAssetId_fkey" FOREIGN KEY ("avatarAssetId") REFERENCES "media_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile" ADD CONSTRAINT "profile_coverAssetId_fkey" FOREIGN KEY ("coverAssetId") REFERENCES "media_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_item" ADD CONSTRAINT "portfolio_item_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_item" ADD CONSTRAINT "portfolio_item_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "media_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_item" ADD CONSTRAINT "portfolio_item_coverAssetId_fkey" FOREIGN KEY ("coverAssetId") REFERENCES "media_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

