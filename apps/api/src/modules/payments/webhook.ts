import { createHash } from 'node:crypto';
import express, { Router } from 'express';
import { HttpError } from '../../lib/http-error.js';
import { enqueue } from '../../lib/outbox.js';
import { prisma } from '../../lib/prisma.js';
import { limits } from '../../lib/rate-limit.js';
import { isUniqueViolation } from './orders.service.js';
import { WebhookAuthError, type WebhookHeaders } from './provider.js';
import { paymentsRuntime } from './runtime.js';

/** Webhook events are kept this long for de-duplication and audit, then swept (server.ts). */
export const WEBHOOK_RETENTION_DAYS = 90;
export const WEBHOOK_BODY_LIMIT = '64kb';

/**
 * Authenticate → de-duplicate → enqueue `payments.verify` → 2xx. Knows nothing about signing
 * (the provider adapter does). Stores no customer personal data and never the raw body: only the
 * event id, normalised type, our order reference and a SHA-256 of the body.
 */
export async function receiveWebhook(providerName: string, rawBody: Buffer, headers: WebhookHeaders) {
  const { provider } = paymentsRuntime();
  if (!provider || provider.name !== providerName) throw new HttpError(404, 'NOT_FOUND', 'No such webhook endpoint');

  let event;
  try {
    event = provider.verifyWebhook(rawBody, headers);
  } catch (e) {
    if (e instanceof WebhookAuthError) {
      console.warn(`[payments] webhook rejected provider=${provider.name}: ${e.message}`);
      throw new HttpError(400, 'WEBHOOK_SIGNATURE_INVALID', 'Webhook signature could not be verified');
    }
    throw e;
  }

  const reference = event.reference?.slice(0, 64) ?? null;
  const order = reference ? await prisma.order.findUnique({ where: { reference }, select: { provider: true } }) : null;
  const matchedOrder = order?.provider === provider.name;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.webhookEvent.create({
        data: {
          provider: provider.name,
          providerEventId: event.eventId.slice(0, 128),
          type: event.type.slice(0, 64),
          orderReference: reference,
          matchedOrder,
          bodySha256: createHash('sha256').update(rawBody).digest('hex'),
          signatureVariant: event.signatureVariant,
        },
      });
      // A trigger only: the job asks the provider before anything changes.
      if (matchedOrder) await enqueue(tx, 'payments.verify', { reference });
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { duplicate: true };
    throw e;
  }
  const tag = provider.isTestProvider ? ' (TEST PROVIDER)' : '';
  console.info(
    `[payments] webhook accepted${tag} event=${event.eventId.slice(0, 64)} type=${event.type.slice(0, 64)} ref=${reference ?? '-'} matched=${matchedOrder}`,
  );
  return { duplicate: false };
}

/**
 * POST /api/v1/payments/webhooks/:provider — mounted in app.ts BEFORE express.json() (raw bytes
 * are what's signed) and outside the v1 router, so the browser origin check doesn't apply here
 * and only here: the caller is a server, authenticated by its signature.
 */
export function paymentWebhookRouter(): Router {
  const router = Router();
  router.post(
    '/:provider',
    limits.webhook,
    (req, _res, next) => {
      if (!req.is('application/json')) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Webhooks must be application/json');
      next();
    },
    express.raw({ type: () => true, limit: WEBHOOK_BODY_LIMIT }),
    async (req, res) => {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const result = await receiveWebhook(String(req.params.provider), body, req.headers);
      res.status(200).json({ received: true, duplicate: result.duplicate });
    },
  );
  return router;
}

export async function sweepWebhookEvents() {
  const { count } =
    await prisma.$executeRaw`DELETE FROM "payment_webhook_event" WHERE "receivedAt" < now() - make_interval(days => ${WEBHOOK_RETENTION_DAYS})`.then(
      (n) => ({ count: n }),
    );
  return count;
}
