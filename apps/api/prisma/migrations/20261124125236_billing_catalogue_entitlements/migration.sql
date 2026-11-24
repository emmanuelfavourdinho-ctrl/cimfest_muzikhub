-- CreateEnum
CREATE TYPE "BillingProduct" AS ENUM ('CREATOR_PLUS', 'PRO', 'POST_BOOST', 'PROFILE_SPOTLIGHT');

-- CreateEnum
CREATE TYPE "CatalogueOption" AS ENUM ('MONTHLY', 'ANNUAL', 'DAYS_3', 'DAYS_7', 'DAYS_14');

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('CREATOR_PLUS', 'PRO');

-- CreateEnum
CREATE TYPE "EntitlementStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PromotionTarget" AS ENUM ('POST', 'PROFILE');

-- CreateTable
CREATE TABLE "service_catalogue" (
    "id" TEXT NOT NULL,
    "product" "BillingProduct" NOT NULL,
    "option" "CatalogueOption" NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "priceXaf" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_catalogue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "EntitlementStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "product" "BillingProduct" NOT NULL,
    "targetType" "PromotionTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "EntitlementStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_catalogue_product_option_effectiveFrom_idx" ON "service_catalogue"("product", "option", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "service_catalogue_product_option_effectiveFrom_key" ON "service_catalogue"("product", "option", "effectiveFrom");

-- CreateIndex
CREATE INDEX "subscription_userId_periodEnd_idx" ON "subscription"("userId", "periodEnd");

-- CreateIndex
CREATE INDEX "promotion_targetType_targetId_periodEnd_idx" ON "promotion"("targetType", "targetId", "periodEnd");

-- CreateIndex
CREATE INDEX "promotion_userId_idx" ON "promotion"("userId");

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion" ADD CONSTRAINT "promotion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integrity rules the application also enforces (ADR 0004).
ALTER TABLE "service_catalogue" ADD CONSTRAINT "service_catalogue_price_positive" CHECK ("priceXaf" > 0);
ALTER TABLE "service_catalogue" ADD CONSTRAINT "service_catalogue_duration_positive" CHECK ("durationDays" > 0);
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_period_valid" CHECK ("periodEnd" > "periodStart");
ALTER TABLE "promotion" ADD CONSTRAINT "promotion_period_valid" CHECK ("periodEnd" > "periodStart");
ALTER TABLE "promotion" ADD CONSTRAINT "promotion_product_valid" CHECK ("product" IN ('POST_BOOST', 'PROFILE_SPOTLIGHT'));
