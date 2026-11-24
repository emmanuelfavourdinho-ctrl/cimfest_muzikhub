-- CreateEnum
CREATE TYPE "CommunityCategory" AS ENUM ('PRODUCTION', 'SONGWRITING', 'PERFORMANCE', 'ENGINEERING', 'BUSINESS', 'MARKETING', 'GENRE', 'LOCAL_SCENE', 'MENTORSHIP', 'OTHER');

-- CreateEnum
CREATE TYPE "CommunityPolicy" AS ENUM ('OPEN', 'REQUEST', 'INVITE');

-- CreateEnum
CREATE TYPE "CommunityRole" AS ENUM ('OWNER', 'ADMIN', 'MODERATOR', 'MEMBER');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'PENDING', 'INVITED', 'BANNED');

-- CreateEnum
CREATE TYPE "DiscussionKind" AS ENUM ('DISCUSSION', 'QUESTION', 'GUIDE', 'MENTORSHIP', 'ANNOUNCEMENT');

-- CreateTable
CREATE TABLE "community" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "CommunityCategory" NOT NULL,
    "rules" TEXT NOT NULL,
    "policy" "CommunityPolicy" NOT NULL DEFAULT 'OPEN',
    "interests" TEXT[],
    "coverAssetId" TEXT,
    "createdById" TEXT NOT NULL,
    "featuredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,
    "removalReason" TEXT,

    CONSTRAINT "community_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_member" (
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "CommunityRole" NOT NULL DEFAULT 'MEMBER',
    "status" "MembershipStatus" NOT NULL,
    "requestNote" TEXT,
    "invitedById" TEXT,
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_member_pkey" PRIMARY KEY ("communityId","userId")
);

-- CreateTable
CREATE TABLE "discussion" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" "DiscussionKind" NOT NULL DEFAULT 'DISCUSSION',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pinnedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "acceptedCommentId" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,
    "removalReason" TEXT,

    CONSTRAINT "discussion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discussion_comment" (
    "id" TEXT NOT NULL,
    "discussionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "parentId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,
    "removalReason" TEXT,

    CONSTRAINT "discussion_comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discussion_reaction" (
    "discussionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discussion_reaction_pkey" PRIMARY KEY ("discussionId","userId")
);

-- CreateTable
CREATE TABLE "discussion_follow" (
    "discussionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discussion_follow_pkey" PRIMARY KEY ("discussionId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "community_slug_key" ON "community"("slug");

-- CreateIndex
CREATE INDEX "community_category_idx" ON "community"("category");

-- CreateIndex
CREATE INDEX "community_removedAt_createdAt_idx" ON "community"("removedAt", "createdAt");

-- CreateIndex
CREATE INDEX "community_member_userId_status_idx" ON "community_member"("userId", "status");

-- CreateIndex
CREATE INDEX "community_member_communityId_status_role_idx" ON "community_member"("communityId", "status", "role");

-- CreateIndex
CREATE INDEX "discussion_communityId_pinnedAt_lastActivityAt_idx" ON "discussion"("communityId", "pinnedAt", "lastActivityAt");

-- CreateIndex
CREATE INDEX "discussion_authorId_idx" ON "discussion"("authorId");

-- CreateIndex
CREATE INDEX "discussion_comment_discussionId_createdAt_idx" ON "discussion_comment"("discussionId", "createdAt");

-- AddForeignKey
ALTER TABLE "community" ADD CONSTRAINT "community_coverAssetId_fkey" FOREIGN KEY ("coverAssetId") REFERENCES "media_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community" ADD CONSTRAINT "community_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_member" ADD CONSTRAINT "community_member_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_member" ADD CONSTRAINT "community_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discussion" ADD CONSTRAINT "discussion_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discussion" ADD CONSTRAINT "discussion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discussion_comment" ADD CONSTRAINT "discussion_comment_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "discussion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discussion_comment" ADD CONSTRAINT "discussion_comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discussion_comment" ADD CONSTRAINT "discussion_comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "discussion_comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discussion_reaction" ADD CONSTRAINT "discussion_reaction_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "discussion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discussion_reaction" ADD CONSTRAINT "discussion_reaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discussion_follow" ADD CONSTRAINT "discussion_follow_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "discussion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discussion_follow" ADD CONSTRAINT "discussion_follow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integrity rules (communities)
ALTER TABLE "community" ADD CONSTRAINT "community_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("slug") BETWEEN 3 AND 60);
ALTER TABLE "community" ADD CONSTRAINT "community_name_length" CHECK (length("name") BETWEEN 3 AND 80);
-- Exactly one owner per community.
CREATE UNIQUE INDEX "community_one_owner" ON "community_member" ("communityId") WHERE "role" = 'OWNER';
ALTER TABLE "community_member" ADD CONSTRAINT "community_owner_active" CHECK ("role" <> 'OWNER' OR "status" = 'ACTIVE');
ALTER TABLE "discussion" ADD CONSTRAINT "discussion_lengths" CHECK (length("title") BETWEEN 3 AND 160 AND length("body") BETWEEN 1 AND 10000);
ALTER TABLE "discussion_comment" ADD CONSTRAINT "discussion_comment_length" CHECK (length("body") BETWEEN 1 AND 4000);
