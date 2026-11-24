-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('SANDBOX', 'LIVE');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PROCESSING', 'FULFILMENT_PENDING', 'FULFILLED', 'FAILED', 'CANCELLED', 'EXPIRED', 'NEEDS_REVIEW', 'REFUNDED');

-- AlterEnum
ALTER TYPE "BillingProduct" ADD VALUE 'TEST_ITEM';

-- AlterTable
ALTER TABLE "service_catalogue" ADD COLUMN     "testOnly" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "payment_order" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "provider" TEXT NOT NULL,
    "catalogueId" TEXT NOT NULL,
    "product" "BillingProduct" NOT NULL,
    "option" "CatalogueOption" NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "amountXaf" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XAF',
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "statusReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "checkoutUrl" TEXT,
    "providerTransactionId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "refundRequestedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "refundReason" TEXT,
    "refundedById" TEXT,
    "providerFeeRefunded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_order_event" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "trigger" TEXT NOT NULL,
    "actorId" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_order_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_fulfilment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fulfiller" TEXT NOT NULL,
    "entitlementType" TEXT,
    "entitlementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_fulfilment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_event" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "orderReference" TEXT,
    "matchedOrder" BOOLEAN NOT NULL,
    "bodySha256" TEXT NOT NULL,
    "signatureVariant" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_webhook_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_order_reference_key" ON "payment_order"("reference");

-- CreateIndex
CREATE INDEX "payment_order_status_createdAt_idx" ON "payment_order"("status", "createdAt");

-- CreateIndex
CREATE INDEX "payment_order_userId_status_idx" ON "payment_order"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_order_userId_idempotencyKey_key" ON "payment_order"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "payment_order_event_orderId_createdAt_idx" ON "payment_order_event"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_fulfilment_orderId_fulfiller_key" ON "payment_fulfilment"("orderId", "fulfiller");

-- CreateIndex
CREATE INDEX "payment_webhook_event_receivedAt_idx" ON "payment_webhook_event"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_event_provider_providerEventId_key" ON "payment_webhook_event"("provider", "providerEventId");

-- AddForeignKey
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_catalogueId_fkey" FOREIGN KEY ("catalogueId") REFERENCES "service_catalogue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_order_event" ADD CONSTRAINT "payment_order_event_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "payment_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_fulfilment" ADD CONSTRAINT "payment_fulfilment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "payment_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Integrity rules the ORM can't express (Phase 3) ──
-- Test-only catalogue rows are exactly the TEST_ITEM rows (text compare: the enum value is new in this transaction).
ALTER TABLE "service_catalogue" ADD CONSTRAINT "service_catalogue_test_only_check" CHECK ("testOnly" = ("product"::text = 'TEST_ITEM'));
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_amount_check" CHECK ("amountXaf" > 0);
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_currency_check" CHECK ("currency" = 'XAF');
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_duration_check" CHECK ("durationDays" > 0);
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_expiry_check" CHECK ("expiresAt" > "createdAt");
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_reference_check" CHECK ("reference" ~ '^mh_[A-Za-z0-9_-]{22}$');
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_refund_check" CHECK ("status" <> 'REFUNDED' OR ("refundedAt" IS NOT NULL AND "refundReason" IS NOT NULL));
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_fulfilled_check" CHECK ("status" <> 'FULFILLED' OR ("paidAt" IS NOT NULL AND "fulfilledAt" IS NOT NULL));
