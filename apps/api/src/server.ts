import { env } from './config/env.js';
import { createApp } from './app.js';
import { prisma } from './lib/prisma.js';
import { reinstateExpiredSuspensions } from './lib/account-status.js';
import { dispatchOutbox } from './lib/outbox.js';
import { sweepIdempotencyKeys } from './middleware/idempotency.js';
import { reconcilePayments } from './modules/payments/orders.service.js';
import { paymentsRuntime } from './modules/payments/runtime.js';
import { sweepWebhookEvents } from './modules/payments/webhook.js';
import { subscriptionNoticesSweep } from './modules/billing/subscriptions.service.js';
import { sweepAnalytics } from './modules/analytics/analytics.service.js';
import { promotionNoticesSweep } from './modules/promotions/promotions.service.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`MuzikHub API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

// Reinstate suspensions whose end date has passed (also checked at sign-in and in admin views).
const suspensionSweep = setInterval(() => {
  reinstateExpiredSuspensions().catch((e) => console.error('[suspensions] sweep failed:', (e as Error).message));
}, 5 * 60_000);
suspensionSweep.unref();

// Transactional outbox worker (ADR 0003): deliver due events every 2 s, one batch at a time.
let dispatching = false;
const outboxWorker = setInterval(() => {
  if (dispatching) return;
  dispatching = true;
  dispatchOutbox()
    .catch((e) => console.error('[outbox] dispatch failed:', (e as Error).message))
    .finally(() => (dispatching = false));
}, 2_000);
outboxWorker.unref();

// Expired Idempotency-Key records (24 h TTL).
const idempotencySweep = setInterval(() => {
  sweepIdempotencyKeys().catch((e) => console.error('[idempotency] sweep failed:', (e as Error).message));
}, 60 * 60_000);
idempotencySweep.unref();

// Payments (ADR 0004): reconcile open orders with the provider every minute (lost webhooks,
// expiry, stalled fulfilment). Safe if it overlaps another run or instance (row locks + CAS).
if (paymentsRuntime().mode !== 'off') {
  let reconciling = false;
  const reconcileTimer = setInterval(() => {
    if (reconciling) return;
    reconciling = true;
    reconcilePayments()
      .catch((e) => console.error('[payments] reconcile failed:', (e as Error).message))
      .finally(() => (reconciling = false));
  }, 60_000);
  reconcileTimer.unref();
}
// In-app subscription notices (ends soon / ended). Informational only: entitlements never depend on it.
const noticesTimer = setInterval(() => {
  subscriptionNoticesSweep().catch((e) => console.error('[billing] notices sweep failed:', (e as Error).message));
  promotionNoticesSweep().catch((e) => console.error('[promotions] notices sweep failed:', (e as Error).message));
}, 15 * 60_000);
noticesTimer.unref();

// Analytics retention: de-dup rows after 2 days, daily counters after 400 days.
const analyticsSweep = setInterval(() => {
  sweepAnalytics().catch((e) => console.error('[analytics] sweep failed:', (e as Error).message));
}, 60 * 60_000);
analyticsSweep.unref();

// Webhook events older than the retention period (90 days).
const webhookSweep = setInterval(
  () => {
    sweepWebhookEvents().catch((e) => console.error('[payments] webhook sweep failed:', (e as Error).message));
  },
  6 * 60 * 60_000,
);
webhookSweep.unref();

// Graceful shutdown: stop accepting connections, then close the DB pool.
function shutdown(signal: string) {
  console.log(`${signal} received, shutting down…`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
