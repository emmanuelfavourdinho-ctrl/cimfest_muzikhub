import { createHash, randomBytes } from 'node:crypto';
import {
  BILLING_PRODUCTS,
  CATALOGUE_OPTIONS,
  ORDER_STATUS_MESSAGES,
  ORDER_TTL_HOURS,
  PENDING_ORDER_CAP,
  type BillingProduct as SharedProduct,
  type OrderView,
} from '@muzikhub/shared';
import { env } from '../../config/env.js';
import { Prisma, type BillingProduct, type CatalogueOption, type Order, type OrderStatus } from '../../generated/prisma/client.js';
import { writeAudit } from '../../lib/audit.js';
import { HttpError } from '../../lib/http-error.js';
import { enqueue } from '../../lib/outbox.js';
import { assertCanReadBilling } from '../../lib/policy.js';
import { prisma } from '../../lib/prisma.js';
import { dbNow } from '../../lib/db-time.js';
import type { StaffContext } from '../../middleware/require-staff.js';
import { FulfilmentImpossible, fulfillerFor } from './fulfilment.js';
import type { ProviderPayment } from './provider.js';
import { callbackUrl, paymentsRuntime } from './runtime.js';
import { isPurchasable } from './purchasable.js';
import { notify } from '../notifications/notifications.service.js';
import { nextStatus, triggerFromProvider, type Trigger } from './state-machine.js';

type Tx = Prisma.TransactionClient;
const OPEN: OrderStatus[] = ['PENDING', 'PROCESSING'];

export { dbNow };

/** "mh_" + 128 random bits, base64url: opaque, unguessable, unique (DB constraint), no personal data. */
export const newOrderReference = () => `mh_${randomBytes(16).toString('base64url')}`;

const label = (product: BillingProduct) => (product === 'TEST_ITEM' ? 'Test item' : BILLING_PRODUCTS[product as SharedProduct]);

export function toOrderView(o: Order): OrderView {
  return {
    reference: o.reference,
    status: o.status,
    statusMessage: ORDER_STATUS_MESSAGES[o.status],
    product: label(o.product),
    option: CATALOGUE_OPTIONS[o.option].label,
    amountXaf: o.amountXaf,
    currency: 'XAF',
    mode: o.mode,
    createdAt: o.createdAt.toISOString(),
    expiresAt: o.expiresAt.toISOString(),
    checkoutUrl: o.status === 'PENDING' ? o.checkoutUrl : null,
  };
}

/** Test-only catalogue rows may never be bought in production (owner rule). */
export function assertTestItemAllowed(nodeEnv: string = env.NODE_ENV) {
  if (nodeEnv === 'production') throw new HttpError(409, 'PRODUCT_NOT_AVAILABLE', 'That item is not available to buy.');
}

export const requestHashOf = (body: { product: string; option: string; targetId?: string | null }) =>
  createHash('sha256')
    .update(JSON.stringify({ product: body.product, option: body.option, targetId: body.targetId ?? null }))
    .digest('hex');

/**
 * Promotions must name a target the buyer may promote: Post Boost → one of their own visible
 * posts; Profile Spotlight → their own profile (the default). Other products take no target.
 */
async function resolveTarget(tx: Tx, userId: string, product: BillingProduct, targetId: string | undefined): Promise<string | null> {
  if (product === 'POST_BOOST') {
    if (!targetId) throw new HttpError(400, 'TARGET_REQUIRED', 'Choose which of your posts to boost.');
    const post = await tx.post.findFirst({ where: { id: targetId, removedAt: null }, select: { authorId: true } });
    if (!post) throw new HttpError(404, 'POST_NOT_FOUND', 'That post no longer exists.');
    if (post.authorId !== userId) throw new HttpError(403, 'NOT_OWNER', 'You can only boost your own posts.');
    return targetId;
  }
  if (product === 'PROFILE_SPOTLIGHT') {
    if (targetId && targetId !== userId) throw new HttpError(403, 'NOT_OWNER', 'You can only spotlight your own profile.');
    return userId;
  }
  if (targetId) throw new HttpError(400, 'VALIDATION_ERROR', 'This product does not take a target.');
  return null;
}

async function transition(
  tx: Tx,
  order: Order,
  to: OrderStatus,
  trigger: Trigger,
  data: Prisma.OrderUpdateManyMutationInput = {},
  event: { actorId?: string; detail?: string } = {},
) {
  // Compare-and-set on the current status: a concurrent change makes this fail loudly instead of
  // silently overwriting it.
  const { count } = await tx.order.updateMany({ where: { id: order.id, status: order.status }, data: { ...data, status: to } });
  if (count !== 1) throw new Error(`order ${order.id} changed concurrently (${order.status} → ${to})`);
  await tx.orderEvent.create({
    data: {
      orderId: order.id,
      fromStatus: order.status,
      toStatus: to,
      trigger,
      actorId: event.actorId ?? null,
      detail: event.detail?.slice(0, 300) ?? null,
    },
  });
  await notifyOrderStatus(tx, order, to, trigger);
}

/** One in-app notification per meaningful outcome (same transaction as the change). */
async function notifyOrderStatus(tx: Tx, order: Order, to: OrderStatus, trigger: Trigger) {
  if (to === 'CANCELLED' && trigger === 'member.cancel') return; // they did it themselves
  const item = `${label(order.product)}, ${CATALOGUE_OPTIONS[order.option].label}`;
  const amount = `${order.amountXaf.toLocaleString('fr-FR')} FCFA`;
  const messages: Partial<Record<OrderStatus, { title: string; body: string }>> = {
    FULFILLED: { title: 'payment confirmed', body: `${item} (${amount}) is active. Your receipt is ready.` },
    FAILED: { title: 'payment failed', body: `Your payment for ${item} didn't go through. MuzikHub hasn't charged you.` },
    EXPIRED: { title: 'order expired', body: `Your order for ${item} expired before a payment was confirmed.` },
    NEEDS_REVIEW: {
      title: "we're checking a payment",
      body: `We need to check your payment for ${item}. Nothing more is needed from you right now.`,
    },
    REFUNDED: { title: 'refund issued', body: `${amount} for ${item} has been refunded. The provider keeps its original fee.` },
    CANCELLED: { title: 'payment cancelled', body: `The payment for ${item} was cancelled. Nothing was charged.` },
  };
  const m = messages[to];
  if (!m) return;
  const title = order.mode === 'SANDBOX' ? `Test payment: ${m.title}` : m.title.charAt(0).toUpperCase() + m.title.slice(1);
  await notify(tx, order.userId, {
    type: `payment.${to.toLowerCase()}`,
    title,
    body: m.body,
    link: `/billing/orders/${order.reference}`,
    dedupeKey: `order:${order.id}:${to}`,
  });
}

async function lockOrder(tx: Tx, where: { reference: string } | { id: string }) {
  const rows =
    'reference' in where
      ? await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "payment_order" WHERE "reference" = ${where.reference} FOR UPDATE`
      : await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "payment_order" WHERE "id" = ${where.id} FOR UPDATE`;
  return rows.length ? tx.order.findUniqueOrThrow({ where: { id: rows[0]!.id } }) : null;
}

// ── Checkout ─────────────────────────────────────────────────

export async function startCheckout(
  user: { id: string; email: string },
  body: { product: BillingProduct; option: CatalogueOption; targetId?: string },
  idempotencyKey: string,
): Promise<{ order: OrderView; reused: boolean; replayed: boolean; created: boolean }> {
  const { mode, provider } = paymentsRuntime();
  if (mode === 'off' || !provider) throw new HttpError(503, 'PAYMENTS_OFF', 'Payments are switched off. No money has been taken.');
  if (mode === 'live') throw new HttpError(503, 'PAYMENTS_EXTERNALLY_BLOCKED', 'Live payments are not available yet.');
  const requestHash = requestHashOf(body);

  const outcome = await prisma.$transaction(async (tx) => {
    // One checkout at a time per member: the pending cap and reuse checks can't race.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`checkout:${user.id}`}))`;
    const now = await dbNow(tx);

    const same = await tx.order.findUnique({ where: { userId_idempotencyKey: { userId: user.id, idempotencyKey } } });
    if (same) {
      if (same.requestHash !== requestHash) {
        throw new HttpError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different purchase.');
      }
      return { order: same, reused: false, replayed: true, created: false };
    }

    const targetId = await resolveTarget(tx, user.id, body.product, body.targetId);
    const open = await tx.order.findMany({ where: { userId: user.id, status: { in: OPEN }, expiresAt: { gt: now } } });
    const existing = open.find((o) => o.product === body.product && o.option === body.option && o.targetId === targetId && o.checkoutUrl);
    if (existing) return { order: existing, reused: true, replayed: false, created: false };
    if (open.length >= PENDING_ORDER_CAP) {
      throw new HttpError(
        409,
        'TOO_MANY_PENDING_ORDERS',
        `You already have ${PENDING_ORDER_CAP} unfinished orders. Finish or cancel one first.`,
      );
    }

    const item = await tx.serviceCatalogue.findFirst({
      where: { product: body.product, option: body.option, effectiveFrom: { lte: now } },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    if (item?.testOnly) assertTestItemAllowed();
    if (!item || !isPurchasable(item, mode)) throw new HttpError(409, 'PRODUCT_NOT_AVAILABLE', 'That item is not available to buy yet.');

    const order = await tx.order.create({
      data: {
        reference: newOrderReference(),
        userId: user.id,
        mode: 'SANDBOX', // live is unreachable (see above and config/payments-approval.ts)
        provider: provider.name,
        catalogueId: item.id,
        product: item.product,
        option: item.option,
        durationDays: item.durationDays,
        targetId,
        amountXaf: item.priceXaf,
        idempotencyKey,
        requestHash,
        createdAt: now,
        expiresAt: new Date(now.getTime() + ORDER_TTL_HOURS * 3_600_000),
      },
    });
    await tx.orderEvent.create({ data: { orderId: order.id, toStatus: 'PENDING', trigger: 'member.checkout', actorId: user.id } });
    return { order, reused: false, replayed: false, created: true };
  });

  if (!outcome.created) return { ...outcome, order: toOrderView(outcome.order) };

  // The provider call happens outside the transaction (network). If it fails the order is closed
  // as FAILED; nothing was charged and the member can start again with a new key.
  const order = outcome.order;
  try {
    const res = await provider.createCheckout({
      reference: order.reference,
      amountXaf: order.amountXaf,
      currency: 'XAF',
      email: user.email,
      description: `MuzikHub: ${label(order.product)}, ${CATALOGUE_OPTIONS[order.option].label}`,
      callbackUrl: callbackUrl(order.reference),
    });
    const saved = await prisma.order.update({
      where: { id: order.id },
      data: { checkoutUrl: res.checkoutUrl, providerTransactionId: res.providerTransactionId },
    });
    return { ...outcome, order: toOrderView(saved) };
  } catch (error) {
    await prisma.$transaction((tx) =>
      transition(
        tx,
        order,
        'FAILED',
        'provider.failed',
        { statusReason: 'checkout_init_failed' },
        { detail: 'provider createCheckout failed' },
      ),
    );
    if (error instanceof HttpError) throw error;
    console.error(`[payments] createCheckout failed ref=${order.reference}: ${(error as Error).message}`);
    throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR', 'We could not start the payment. Nothing was charged; please try again.');
  }
}

export async function ownOrder(userId: string, reference: string): Promise<OrderView> {
  const order = await prisma.order.findUnique({ where: { reference } });
  return toOrderView(assertCanReadBilling({ userId }, order, { notFound: 'Order not found' }));
}

export async function cancelOwnOrder(userId: string, reference: string): Promise<OrderView> {
  const { provider } = paymentsRuntime();
  const order = await prisma.$transaction(async (tx) => {
    const o = assertCanReadBilling({ userId }, await lockOrder(tx, { reference }), { notFound: 'Order not found' });
    if (!nextStatus(o.status, 'member.cancel')) throw new HttpError(409, 'ORDER_NOT_CANCELLABLE', 'This order can no longer be cancelled.');
    await transition(tx, o, 'CANCELLED', 'member.cancel', {}, { actorId: userId });
    return o;
  });
  // Best effort: a late success after this is caught by the state machine (→ NEEDS_REVIEW).
  if (provider && provider.name === order.provider) {
    await provider
      .cancelPayment(order.reference)
      .catch((e: Error) => console.warn(`[payments] cancel at provider failed ref=${order.reference}: ${e.message}`));
  }
  return toOrderView(await prisma.order.findUniqueOrThrow({ where: { id: order.id } }));
}

/** The member's own transaction history (newest first). */
export async function ownOrders(userId: string, q: { cursor?: string; limit: number }) {
  const rows = await prisma.order.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
    ...(q.cursor && { cursor: { id: q.cursor }, skip: 1 }),
  });
  const page = rows.slice(0, q.limit);
  return { nextCursor: rows.length > q.limit ? page.at(-1)!.id : null, items: page.map(toOrderView) };
}

/** On-screen receipt for the owner: what was paid and what it granted. */
export async function ownReceipt(userId: string, reference: string) {
  const order = assertCanReadBilling({ userId }, await prisma.order.findUnique({ where: { reference }, include: { fulfilments: true } }), {
    notFound: 'Order not found',
  });
  let granted: { label: string; from: string; to: string } | null = null;
  const f = order.fulfilments[0];
  if (f?.entitlementType === 'SUBSCRIPTION' && f.entitlementId) {
    const sub = await prisma.subscription.findUnique({ where: { id: f.entitlementId } });
    if (sub) granted = { label: label(sub.plan as BillingProduct), from: sub.periodStart.toISOString(), to: sub.periodEnd.toISOString() };
  } else if (f?.entitlementType === 'PROMOTION' && f.entitlementId) {
    const p = await prisma.promotion.findUnique({ where: { id: f.entitlementId } });
    if (p) granted = { label: label(p.product), from: p.periodStart.toISOString(), to: p.periodEnd.toISOString() };
  }
  const v = toOrderView(order);
  return {
    reference: v.reference,
    status: v.status,
    statusMessage: v.statusMessage,
    product: v.product,
    option: v.option,
    amountXaf: v.amountXaf,
    currency: v.currency,
    mode: v.mode,
    provider: order.provider === 'fake' ? 'TEST PROVIDER' : 'Notch Pay',
    createdAt: v.createdAt,
    paidAt: order.paidAt?.toISOString() ?? null,
    refundedAt: order.refundedAt?.toISOString() ?? null,
    granted,
  };
}

// ── Verification (webhook job and reconciliation share this) ─

/** Applies a VERIFIED provider answer through the state machine. Idempotent; row-locked. */
export async function applyProviderPayment(reference: string, payment: ProviderPayment, source: 'webhook' | 'reconcile') {
  return prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, { reference });
    if (!order) return { changed: false as const, status: null };
    const now = await dbNow(tx);
    const trigger = triggerFromProvider(order, payment, now);
    const to = trigger && nextStatus(order.status, trigger);
    if (!trigger || !to) return { changed: false as const, status: order.status };
    const paid =
      trigger === 'provider.paid' ||
      trigger === 'provider.paid_late' ||
      trigger === 'provider.mismatch' ||
      trigger === 'provider.incomplete';
    await transition(
      tx,
      order,
      to,
      trigger,
      {
        ...(paid && !order.paidAt && { paidAt: now }),
        ...(payment.providerTransactionId && { providerTransactionId: payment.providerTransactionId }),
        ...(to === 'NEEDS_REVIEW' && { statusReason: trigger.replace('provider.', '') }),
      },
      { detail: `${source}: provider status "${payment.rawStatus}"` },
    );
    if (to === 'FULFILMENT_PENDING') await enqueue(tx, 'payments.fulfil', { orderId: order.id });
    return { changed: true as const, status: to };
  });
}

/** Outbox job `payments.verify`: ask the provider (server to server), then apply. */
export async function verifyOrder(reference: string, source: 'webhook' | 'reconcile' = 'webhook') {
  const order = await prisma.order.findUnique({ where: { reference }, select: { provider: true } });
  if (!order) return { changed: false as const, status: null };
  const { provider } = paymentsRuntime();
  if (!provider || provider.name !== order.provider) throw new Error(`no ${order.provider} provider configured to verify ${reference}`);
  const payment = await provider.getPayment(reference);
  return applyProviderPayment(reference, payment, source);
}

// ── Fulfilment ───────────────────────────────────────────────

/**
 * Outbox job `payments.fulfil`. Status change and fulfilment record commit together; the unique
 * (order, fulfiller) constraint makes a repeat a no-op. If the fulfiller throws, the whole
 * transaction rolls back, the order stays FULFILMENT_PENDING and the outbox retries.
 */
export async function fulfilOrder(orderId: string) {
  return prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, { id: orderId });
    if (!order || order.status !== 'FULFILMENT_PENDING') return { fulfilled: false, status: order?.status ?? null };
    const fulfiller = fulfillerFor(order.product);
    if (!fulfiller) throw new Error(`no fulfiller registered for ${order.product}`);
    let result;
    try {
      result = await fulfiller.fulfil(tx, order);
    } catch (e) {
      if (!(e instanceof FulfilmentImpossible)) throw e;
      await transition(tx, order, 'NEEDS_REVIEW', 'fulfilment.impossible', { statusReason: 'target_unavailable' }, { detail: e.message });
      return { fulfilled: false, status: 'NEEDS_REVIEW' as const };
    }
    await tx.fulfilment.create({ data: { orderId: order.id, fulfiller: fulfiller.key, ...result } });
    await transition(tx, order, 'FULFILLED', 'fulfilment.done', { fulfilledAt: await dbNow(tx) }, { detail: fulfiller.key });
    return { fulfilled: true, status: 'FULFILLED' as const };
  });
}

// ── Refund (admin) ───────────────────────────────────────────

export async function refundOrder(staff: StaffContext, reference: string, reason: string) {
  const { provider } = paymentsRuntime();
  const order = await prisma.order.findUnique({ where: { reference } });
  if (!order) throw new HttpError(404, 'NOT_FOUND', 'Order not found');
  if (!nextStatus(order.status, 'admin.refund'))
    throw new HttpError(409, 'ORDER_NOT_REFUNDABLE', `A ${order.status} order can't be refunded.`);
  if (!provider || provider.name !== order.provider || !provider.supportsRefund || !provider.refund) {
    throw new HttpError(409, 'REFUND_NOT_SUPPORTED', 'Refunds are not available for this payment provider. Nothing was changed.');
  }
  // Claim the refund (one admin, one time) before calling the provider.
  const claimed = await prisma.order.updateMany({
    where: { id: order.id, status: order.status, refundRequestedAt: null },
    data: { refundRequestedAt: await dbNow() },
  });
  if (claimed.count !== 1) throw new HttpError(409, 'REFUND_IN_PROGRESS', 'A refund for this order is already in progress.');
  try {
    await provider.refund({ reference, amountXaf: order.amountXaf, reason });
  } catch (error) {
    await prisma.order.update({ where: { id: order.id }, data: { refundRequestedAt: null } });
    console.error(`[payments] refund failed ref=${reference}: ${(error as Error).message}`);
    throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR', 'The provider refused the refund. Nothing was changed.');
  }
  return prisma.$transaction(async (tx) => {
    const current = (await lockOrder(tx, { id: order.id }))!;
    const now = await dbNow(tx);
    await transition(
      tx,
      current,
      'REFUNDED',
      'admin.refund',
      { refundedAt: now, refundReason: reason, refundedById: staff.id, providerFeeRefunded: false },
      { actorId: staff.id, detail: reason },
    );
    const fulfilments = await tx.fulfilment.findMany({ where: { orderId: order.id } });
    for (const f of fulfilments) {
      if (f.entitlementType === 'SUBSCRIPTION' && f.entitlementId)
        await tx.subscription.update({ where: { id: f.entitlementId }, data: { status: 'REFUNDED' } });
      if (f.entitlementType === 'PROMOTION' && f.entitlementId)
        await tx.promotion.update({ where: { id: f.entitlementId }, data: { status: 'REFUNDED' } });
    }
    await writeAudit(tx, {
      actor: { id: staff.id, role: staff.role, ip: staff.ip },
      action: 'payment.refund',
      target: { type: 'order', id: reference },
      reason,
      before: { status: current.status },
      after: { status: 'REFUNDED', amountXaf: order.amountXaf, providerFeeRefunded: false, entitlementsRefunded: fulfilments.length },
    });
    return toOrderView(await tx.order.findUniqueOrThrow({ where: { id: order.id } }));
  });
}

// ── Reconciliation ───────────────────────────────────────────

/** Orders younger than this are left to the webhook. Documented in ADR 0004. */
export const RECONCILE_MIN_AGE_MINUTES = 2;
const FULFIL_RETRY_AFTER_MINUTES = 10;

/**
 * Re-checks open orders with the provider and applies the same state machine (covers lost
 * webhooks and browsers that never come back). Expires orders past our TTL that the provider
 * doesn't report as paid. Re-queues fulfilment that has stalled. Safe to run twice at once: every
 * change goes through applyProviderPayment / transition under a row lock with compare-and-set.
 */
export async function reconcilePayments({ limit = 100 }: { limit?: number } = {}) {
  const { provider } = paymentsRuntime();
  const now = await dbNow();
  const stats = { checked: 0, changed: 0, expired: 0, requeued: 0, errors: 0 };
  if (provider) {
    const open = await prisma.order.findMany({
      where: {
        status: { in: OPEN },
        provider: provider.name,
        createdAt: { lt: new Date(now.getTime() - RECONCILE_MIN_AGE_MINUTES * 60_000) },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    for (const order of open) {
      stats.checked += 1;
      try {
        const payment = await provider.getPayment(order.reference);
        const r = await applyProviderPayment(order.reference, payment, 'reconcile');
        if (r.changed) stats.changed += 1;
        else if (order.expiresAt <= now) {
          const expired = await prisma.$transaction(async (tx) => {
            const o = await lockOrder(tx, { id: order.id });
            if (!o || !nextStatus(o.status, 'system.expire') || o.expiresAt > (await dbNow(tx))) return false;
            await transition(tx, o, 'EXPIRED', 'system.expire', {}, { detail: `reconcile: provider status "${payment.rawStatus}"` });
            return true;
          });
          if (expired) stats.expired += 1;
        }
      } catch (e) {
        stats.errors += 1;
        console.error(`[payments] reconcile failed ref=${order.reference}: ${(e as Error).message}`);
      }
    }
  }
  // Paid but not yet fulfilled for a while, with no fulfil job waiting: queue one (idempotent).
  const stalled = await prisma.$queryRaw<{ id: string }[]>`
    SELECT o."id" FROM "payment_order" o
    WHERE o."status" = 'FULFILMENT_PENDING' AND o."updatedAt" < ${new Date(now.getTime() - FULFIL_RETRY_AFTER_MINUTES * 60_000)}
      AND NOT EXISTS (SELECT 1 FROM "outbox_event" e WHERE e."topic" = 'payments.fulfil'
                      AND e."status" IN ('PENDING', 'PROCESSING') AND e."payload"->>'orderId' = o."id")
    LIMIT ${limit}`;
  for (const { id } of stalled) {
    await enqueue(prisma, 'payments.fulfil', { orderId: id });
    stats.requeued += 1;
  }
  return stats;
}

// ── Admin reads ──────────────────────────────────────────────

/** Revenue counts LIVE orders only: sandbox orders are excluded forever (owner rule). */
export async function revenueSummary() {
  const live = await prisma.order.aggregate({
    where: { mode: 'LIVE', status: { in: ['FULFILLED', 'FULFILMENT_PENDING'] } },
    _sum: { amountXaf: true },
    _count: true,
  });
  const byStatus = await prisma.order.groupBy({ by: ['mode', 'status'], _count: true });
  return {
    currency: 'XAF' as const,
    liveRevenueXaf: live._sum.amountXaf ?? 0,
    liveOrders: live._count,
    counts: byStatus.map((r) => ({ mode: r.mode, status: r.status, count: r._count })),
  };
}

export async function adminOrders(q: { status?: OrderStatus; mode?: 'SANDBOX' | 'LIVE'; cursor?: string; limit: number }) {
  const rows = await prisma.order.findMany({
    where: { ...(q.status && { status: q.status }), ...(q.mode && { mode: q.mode }) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
    ...(q.cursor && { cursor: { id: q.cursor }, skip: 1 }),
    include: { user: { select: { id: true, name: true, username: true } }, events: { orderBy: { createdAt: 'asc' } } },
  });
  const page = rows.slice(0, q.limit);
  return {
    nextCursor: rows.length > q.limit ? page.at(-1)!.id : null,
    items: page.map((o) => ({
      ...toOrderView(o),
      statusReason: o.statusReason,
      provider: o.provider,
      user: o.user,
      paidAt: o.paidAt?.toISOString() ?? null,
      refundedAt: o.refundedAt?.toISOString() ?? null,
      providerFeeRefunded: o.providerFeeRefunded,
      history: o.events.map((e) => ({
        from: e.fromStatus,
        to: e.toStatus,
        trigger: e.trigger,
        at: e.createdAt.toISOString(),
        detail: e.detail,
      })),
    })),
  };
}

export const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

// ── Admin operations (milestone 4): detail and narrowly-scoped, audited repairs ──

/** Everything an operator needs about one order: history, fulfilment, webhooks, allowed actions. */
export async function adminOrderDetail(reference: string) {
  const o = await prisma.order.findUnique({
    where: { reference },
    include: {
      user: { select: { id: true, name: true, username: true } },
      events: { orderBy: { createdAt: 'asc' } },
      fulfilments: true,
    },
  });
  if (!o) throw new HttpError(404, 'NOT_FOUND', 'Order not found');
  const hooks = await prisma.webhookEvent.findMany({ where: { orderReference: reference }, orderBy: { receivedAt: 'asc' } });
  const { provider } = paymentsRuntime();
  const sameProvider = provider?.name === o.provider;
  return {
    ...toOrderView(o),
    statusReason: o.statusReason,
    provider: o.provider === 'fake' ? 'TEST PROVIDER' : 'Notch Pay',
    providerTransactionId: o.providerTransactionId,
    targetId: o.targetId,
    user: o.user,
    paidAt: o.paidAt?.toISOString() ?? null,
    fulfilledAt: o.fulfilledAt?.toISOString() ?? null,
    refundedAt: o.refundedAt?.toISOString() ?? null,
    refundReason: o.refundReason,
    providerFeeRefunded: o.providerFeeRefunded,
    history: o.events.map((e) => ({
      from: e.fromStatus,
      to: e.toStatus,
      trigger: e.trigger,
      actorId: e.actorId,
      detail: e.detail,
      at: e.createdAt.toISOString(),
    })),
    fulfilments: o.fulfilments.map((f) => ({
      fulfiller: f.fulfiller,
      entitlementType: f.entitlementType,
      entitlementId: f.entitlementId,
      at: f.createdAt.toISOString(),
    })),
    webhooks: hooks.map((h) => ({ eventId: h.providerEventId, type: h.type, matched: h.matchedOrder, at: h.receivedAt.toISOString() })),
    actions: {
      recheck: sameProvider && ['PENDING', 'PROCESSING', 'NEEDS_REVIEW'].includes(o.status),
      retryFulfilment: o.status === 'FULFILMENT_PENDING',
      approveLate: sameProvider && o.status === 'NEEDS_REVIEW' && o.statusReason === 'paid_late',
      refund: Boolean(sameProvider && provider?.supportsRefund && nextStatus(o.status, 'admin.refund') && !o.refundRequestedAt),
    },
  };
}

const auditRepair = (tx: Tx, staff: StaffContext, action: string, reference: string, reason: string, before: object, after: object) =>
  writeAudit(tx, {
    actor: { id: staff.id, role: staff.role, ip: staff.ip },
    action,
    target: { type: 'order', id: reference },
    reason,
    before: before as Prisma.InputJsonValue,
    after: after as Prisma.InputJsonValue,
  });

/** Repair: ask the provider again now and apply the state machine (never forces a status). */
export async function adminRecheck(staff: StaffContext, reference: string, reason: string) {
  const before = await prisma.order.findUnique({ where: { reference } });
  if (!before) throw new HttpError(404, 'NOT_FOUND', 'Order not found');
  const result = await verifyOrder(reference, 'reconcile');
  await prisma.$transaction((tx) =>
    auditRepair(
      tx,
      staff,
      'payment.recheck',
      reference,
      reason,
      { status: before.status },
      { status: result.status, changed: result.changed },
    ),
  );
  return adminOrderDetail(reference);
}

/** Repair: queue fulfilment again for a paid order stuck before fulfilment (idempotent). */
export async function adminRetryFulfilment(staff: StaffContext, reference: string, reason: string) {
  await prisma.$transaction(async (tx) => {
    const o = await lockOrder(tx, { reference });
    if (!o) throw new HttpError(404, 'NOT_FOUND', 'Order not found');
    if (o.status !== 'FULFILMENT_PENDING')
      throw new HttpError(409, 'NOT_FULFILMENT_PENDING', 'Only paid orders waiting for fulfilment can be retried.');
    await enqueue(tx, 'payments.fulfil', { orderId: o.id });
    await auditRepair(tx, staff, 'payment.retry_fulfilment', reference, reason, { status: o.status }, { queued: true });
  });
  return adminOrderDetail(reference);
}

/**
 * Repair: approve a LATE success. Allowed only when the order is NEEDS_REVIEW because the payment
 * arrived after our expiry, AND the provider confirms right now that it is paid with exactly the
 * order's amount, currency and reference. Then it is fulfilled like any verified payment.
 */
export async function adminApproveLate(staff: StaffContext, reference: string, reason: string) {
  const { provider } = paymentsRuntime();
  const o = await prisma.order.findUnique({ where: { reference } });
  if (!o) throw new HttpError(404, 'NOT_FOUND', 'Order not found');
  if (o.status !== 'NEEDS_REVIEW' || o.statusReason !== 'paid_late') {
    throw new HttpError(409, 'NOT_APPROVABLE', 'Only late payments under review can be approved. Use a refund for anything else.');
  }
  if (!provider || provider.name !== o.provider)
    throw new HttpError(409, 'PROVIDER_UNAVAILABLE', 'The provider for this order is not configured.');
  const p = await provider.getPayment(reference);
  if (!(p.status === 'paid' && p.reference === o.reference && p.amountXaf === o.amountXaf && p.currency === o.currency)) {
    throw new HttpError(409, 'NOT_VERIFIED', 'The provider does not confirm this payment in full right now. Nothing was changed.');
  }
  await prisma.$transaction(async (tx) => {
    const current = (await lockOrder(tx, { reference }))!;
    if (!nextStatus(current.status, 'admin.approve_late')) throw new HttpError(409, 'NOT_APPROVABLE', 'This order changed; reload it.');
    await transition(
      tx,
      current,
      'FULFILMENT_PENDING',
      'admin.approve_late',
      { statusReason: null },
      { actorId: staff.id, detail: reason },
    );
    await enqueue(tx, 'payments.fulfil', { orderId: current.id });
    await auditRepair(
      tx,
      staff,
      'payment.approve_late',
      reference,
      reason,
      { status: 'NEEDS_REVIEW' },
      { status: 'FULFILMENT_PENDING', providerStatus: p.rawStatus },
    );
  });
  return adminOrderDetail(reference);
}
