-- AlterTable
ALTER TABLE "payment_order" ADD COLUMN     "targetId" TEXT;

-- AlterTable
ALTER TABLE "promotion" ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "endedById" TEXT,
ADD COLUMN     "endedReason" TEXT;

-- A promotion order must name its target; other orders must not.
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_target_check"
  CHECK (("product"::text IN ('POST_BOOST', 'PROFILE_SPOTLIGHT')) = ("targetId" IS NOT NULL));
ALTER TABLE "promotion" ADD CONSTRAINT "promotion_ended_check" CHECK ("endedAt" IS NULL OR "status" <> 'ACTIVE');
