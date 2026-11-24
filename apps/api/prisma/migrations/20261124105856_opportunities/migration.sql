-- CreateEnum
CREATE TYPE "OpportunityType" AS ENUM ('GIG', 'AUDITION', 'EVENT', 'JOB', 'COLLABORATION');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('SUBMITTED', 'SHORTLISTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "isOrganiser" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "organiserSince" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "opportunity" (
    "id" TEXT NOT NULL,
    "organiserId" TEXT NOT NULL,
    "type" "OpportunityType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requirements" TEXT,
    "location" TEXT,
    "remote" BOOLEAN NOT NULL DEFAULT false,
    "deadline" TIMESTAMP(3) NOT NULL,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_application" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunity_application_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "opportunity_status_deadline_idx" ON "opportunity"("status", "deadline");

-- CreateIndex
CREATE INDEX "opportunity_organiserId_idx" ON "opportunity"("organiserId");

-- CreateIndex
CREATE INDEX "opportunity_application_applicantId_idx" ON "opportunity_application"("applicantId");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_application_opportunityId_applicantId_key" ON "opportunity_application"("opportunityId", "applicantId");

-- AddForeignKey
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_organiserId_fkey" FOREIGN KEY ("organiserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_application" ADD CONSTRAINT "opportunity_application_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_application" ADD CONSTRAINT "opportunity_application_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
