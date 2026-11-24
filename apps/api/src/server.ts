import { env } from './config/env.js';
import { createApp } from './app.js';
import { prisma } from './lib/prisma.js';
import { reinstateExpiredSuspensions } from './lib/account-status.js';
import { dispatchOutbox } from './lib/outbox.js';
import { sweepIdempotencyKeys } from './middleware/idempotency.js';

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
