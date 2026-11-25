-- CreateEnum
CREATE TYPE "CompetitionCategory" AS ENUM ('SONGWRITING', 'PRODUCTION', 'VOCALS', 'PERFORMANCE', 'DJ', 'REMIX', 'VIDEO', 'OTHER');

-- CreateEnum
CREATE TYPE "CompetitionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RESULTS_PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EntryFormat" AS ENUM ('AUDIO', 'VIDEO', 'IMAGE', 'LINK');

-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('SUBMITTED', 'WITHDRAWN', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UPHELD', 'REJECTED');

-- CreateTable
CREATE TABLE "competition" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "organiserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "CompetitionCategory" NOT NULL,
    "coverAssetId" TEXT,
    "eligibility" TEXT NOT NULL,
    "prize" TEXT NOT NULL,
    "prizePlaces" INTEGER NOT NULL DEFAULT 3,
    "judgingMethod" TEXT NOT NULL,
    "disqualification" TEXT NOT NULL,
    "disputeProcess" TEXT NOT NULL,
    "formats" "EntryFormat"[],
    "criteria" JSONB NOT NULL,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "extendedUntil" TIMESTAMP(3),
    "extensionReason" TEXT,
    "status" "CompetitionStatus" NOT NULL DEFAULT 'DRAFT',
    "rulesVersion" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "resultsPublishedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "featuredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,
    "removalReason" TEXT,

    CONSTRAINT "competition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_rules" (
    "competitionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "rules" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competition_rules_pkey" PRIMARY KEY ("competitionId","version")
);

-- CreateTable
CREATE TABLE "competition_entry" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "mediaAssetId" TEXT,
    "externalUrl" TEXT,
    "rulesVersion" INTEGER NOT NULL,
    "status" "EntryStatus" NOT NULL DEFAULT 'SUBMITTED',
    "disqualifiedReason" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,
    "removalReason" TEXT,

    CONSTRAINT "competition_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_judge" (
    "competitionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competition_judge_pkey" PRIMARY KEY ("competitionId","userId")
);

-- CreateTable
CREATE TABLE "judgement" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "judgeId" TEXT NOT NULL,
    "scores" JSONB NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "judgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_result" (
    "competitionId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "placement" INTEGER NOT NULL,
    "averageScore" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "competition_result_pkey" PRIMARY KEY ("competitionId","placement")
);

-- CreateTable
CREATE TABLE "competition_dispute" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "competition_dispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "competition_slug_key" ON "competition"("slug");

-- CreateIndex
CREATE INDEX "competition_status_closesAt_idx" ON "competition"("status", "closesAt");

-- CreateIndex
CREATE UNIQUE INDEX "competition_entry_competitionId_participantId_key" ON "competition_entry"("competitionId", "participantId");

-- CreateIndex
CREATE INDEX "competition_judge_userId_idx" ON "competition_judge"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "judgement_entryId_judgeId_key" ON "judgement"("entryId", "judgeId");

-- CreateIndex
CREATE UNIQUE INDEX "competition_result_entryId_key" ON "competition_result"("entryId");

-- CreateIndex
CREATE INDEX "competition_dispute_status_createdAt_idx" ON "competition_dispute"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "competition_dispute_competitionId_userId_key" ON "competition_dispute"("competitionId", "userId");

-- AddForeignKey
ALTER TABLE "competition" ADD CONSTRAINT "competition_organiserId_fkey" FOREIGN KEY ("organiserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition" ADD CONSTRAINT "competition_coverAssetId_fkey" FOREIGN KEY ("coverAssetId") REFERENCES "media_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_rules" ADD CONSTRAINT "competition_rules_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_entry" ADD CONSTRAINT "competition_entry_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_entry" ADD CONSTRAINT "competition_entry_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_entry" ADD CONSTRAINT "competition_entry_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "media_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_judge" ADD CONSTRAINT "competition_judge_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_judge" ADD CONSTRAINT "competition_judge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "judgement" ADD CONSTRAINT "judgement_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "competition_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "judgement" ADD CONSTRAINT "judgement_judgeId_fkey" FOREIGN KEY ("judgeId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_result" ADD CONSTRAINT "competition_result_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_result" ADD CONSTRAINT "competition_result_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "competition_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_dispute" ADD CONSTRAINT "competition_dispute_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_dispute" ADD CONSTRAINT "competition_dispute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integrity rules (competitions)
ALTER TABLE "competition" ADD CONSTRAINT "competition_dates" CHECK ("opensAt" < "closesAt" AND ("extendedUntil" IS NULL OR "extendedUntil" > "closesAt"));
ALTER TABLE "competition" ADD CONSTRAINT "competition_extension_reason" CHECK ("extendedUntil" IS NULL OR "extensionReason" IS NOT NULL);
ALTER TABLE "competition" ADD CONSTRAINT "competition_places" CHECK ("prizePlaces" BETWEEN 1 AND 10);
ALTER TABLE "competition" ADD CONSTRAINT "competition_formats" CHECK (cardinality("formats") >= 1);
ALTER TABLE "competition" ADD CONSTRAINT "competition_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "competition_entry" ADD CONSTRAINT "competition_entry_has_work" CHECK ("mediaAssetId" IS NOT NULL OR "externalUrl" IS NOT NULL);
ALTER TABLE "competition_entry" ADD CONSTRAINT "competition_entry_disqualified" CHECK ("status" <> 'DISQUALIFIED' OR "disqualifiedReason" IS NOT NULL);
ALTER TABLE "judgement" ADD CONSTRAINT "judgement_total" CHECK ("total" BETWEEN 0 AND 100);
ALTER TABLE "competition_result" ADD CONSTRAINT "competition_result_placement" CHECK ("placement" BETWEEN 1 AND 10);
