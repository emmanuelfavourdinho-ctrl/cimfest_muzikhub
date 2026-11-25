-- CreateEnum
CREATE TYPE "CollaborationType" AS ENUM ('FEATURE', 'PRODUCTION', 'SONGWRITING', 'MIXING_MASTERING', 'PERFORMANCE', 'VIDEO', 'REMIX', 'OTHER');

-- CreateEnum
CREATE TYPE "CollabRequestStatus" AS ENUM ('PENDING', 'CLARIFICATION_REQUESTED', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CollaborationStatus" AS ENUM ('ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CollaborationUpdateKind" AS ENUM ('STATUS', 'NOTE');

-- CreateTable
CREATE TABLE "collaboration_request" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "type" "CollaborationType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "references" TEXT[],
    "deadline" TIMESTAMP(3),
    "status" "CollabRequestStatus" NOT NULL DEFAULT 'PENDING',
    "clarificationQuestion" TEXT,
    "clarificationAnswer" TEXT,
    "responseNote" TEXT,
    "conversationId" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collaboration_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collaboration" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "type" "CollaborationType" NOT NULL,
    "status" "CollaborationStatus" NOT NULL DEFAULT 'ACTIVE',
    "dueAt" TIMESTAMP(3),
    "conversationId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collaboration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collaboration_participant" (
    "collaborationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "collaboration_participant_pkey" PRIMARY KEY ("collaborationId","userId")
);

-- CreateTable
CREATE TABLE "collaboration_update" (
    "id" TEXT NOT NULL,
    "collaborationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" "CollaborationUpdateKind" NOT NULL,
    "status" "CollaborationStatus",
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collaboration_update_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "collaboration_request_recipientId_status_idx" ON "collaboration_request"("recipientId", "status");

-- CreateIndex
CREATE INDEX "collaboration_request_senderId_status_idx" ON "collaboration_request"("senderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "collaboration_requestId_key" ON "collaboration"("requestId");

-- CreateIndex
CREATE INDEX "collaboration_participant_userId_idx" ON "collaboration_participant"("userId");

-- CreateIndex
CREATE INDEX "collaboration_update_collaborationId_createdAt_idx" ON "collaboration_update"("collaborationId", "createdAt");

-- AddForeignKey
ALTER TABLE "collaboration_request" ADD CONSTRAINT "collaboration_request_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaboration_request" ADD CONSTRAINT "collaboration_request_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaboration" ADD CONSTRAINT "collaboration_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "collaboration_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaboration_participant" ADD CONSTRAINT "collaboration_participant_collaborationId_fkey" FOREIGN KEY ("collaborationId") REFERENCES "collaboration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaboration_participant" ADD CONSTRAINT "collaboration_participant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaboration_update" ADD CONSTRAINT "collaboration_update_collaborationId_fkey" FOREIGN KEY ("collaborationId") REFERENCES "collaboration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaboration_update" ADD CONSTRAINT "collaboration_update_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integrity rules (collaboration)
-- COL-004: at most one open request from the same sender to the same recipient.
CREATE UNIQUE INDEX "collaboration_request_one_open" ON "collaboration_request" ("senderId", "recipientId")
  WHERE "status" IN ('PENDING', 'CLARIFICATION_REQUESTED');
ALTER TABLE "collaboration_request" ADD CONSTRAINT "collaboration_request_not_self" CHECK ("senderId" <> "recipientId");
ALTER TABLE "collaboration_request" ADD CONSTRAINT "collaboration_request_lengths"
  CHECK (length("title") BETWEEN 3 AND 120 AND length("description") BETWEEN 20 AND 3000 AND length("role") BETWEEN 2 AND 80 AND cardinality("references") <= 5);
ALTER TABLE "collaboration" ADD CONSTRAINT "collaboration_closed_check" CHECK (("status" IN ('COMPLETED', 'CANCELLED')) = ("closedAt" IS NOT NULL));
