-- CreateEnum
CREATE TYPE "AnalyticsEvent" AS ENUM ('PROFILE_VIEW', 'PLAY', 'LINK_CLICK');

-- CreateEnum
CREATE TYPE "AnalyticsSubject" AS ENUM ('PROFILE', 'PORTFOLIO_ITEM', 'POST', 'PROFILE_LINK');

-- CreateTable
CREATE TABLE "analytics_daily" (
    "ownerId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "event" "AnalyticsEvent" NOT NULL,
    "subjectType" "AnalyticsSubject" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "analytics_daily_pkey" PRIMARY KEY ("ownerId","day","event","subjectType","subjectId")
);

-- CreateTable
CREATE TABLE "analytics_seen" (
    "day" DATE NOT NULL,
    "event" "AnalyticsEvent" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "viewerHash" TEXT NOT NULL,

    CONSTRAINT "analytics_seen_pkey" PRIMARY KEY ("day","event","subjectId","viewerHash")
);

-- CreateIndex
CREATE INDEX "analytics_daily_ownerId_day_idx" ON "analytics_daily"("ownerId", "day");

-- AddForeignKey
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_count_check" CHECK ("count" >= 0);
