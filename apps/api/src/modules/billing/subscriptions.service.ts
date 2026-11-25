import { PLAN_NAMES, type BillingOverview } from '@muzikhub/shared';
import { dbNow } from '../../lib/db-time.js';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { notify } from '../notifications/notifications.service.js';
import { getEntitlements } from './entitlements.js';

const day = (d: Date) => d.toISOString().slice(0, 10);

/** The member's plan, dates and every period (current, queued, ended). */
export async function billingOverview(userId: string): Promise<BillingOverview> {
  const now = await dbNow();
  const ent = await getEntitlements(userId, now);
  const rows = await prisma.subscription.findMany({ where: { userId }, orderBy: [{ periodStart: 'desc' }], take: 50 });
  const live = rows.filter((r) => r.status === 'ACTIVE' && r.periodEnd > now);
  const lastEnding = live.reduce<(typeof live)[number] | null>((m, r) => (!m || r.periodEnd > m.periodEnd ? r : m), null);
  return {
    plan: ent.plan,
    planName: PLAN_NAMES[ent.plan],
    planUntil: ent.planUntil,
    limits: ent.limits,
    cancelled: Boolean(lastEnding?.cancelledAt),
    periods: rows.map((r) => ({
      id: r.id,
      plan: r.plan,
      periodStart: r.periodStart.toISOString(),
      periodEnd: r.periodEnd.toISOString(),
      status: r.status,
      cancelledAt: r.cancelledAt?.toISOString() ?? null,
      state: r.status !== 'ACTIVE' || r.periodEnd <= now ? 'ended' : r.periodStart <= now ? 'current' : 'queued',
    })),
  };
}

/**
 * Cancel. Plans are prepaid and NEVER renew automatically, so cancelling means: no renewal
 * reminders, and the plan simply ends at its end date. Benefits continue until then; no automatic
 * refund (an admin can refund on request). Confirmed with an in-app notification.
 */
export async function cancelSubscription(userId: string) {
  const now = await dbNow();
  const { count } = await prisma.subscription.updateMany({
    where: { userId, status: 'ACTIVE', periodEnd: { gt: now }, cancelledAt: null },
    data: { cancelledAt: now },
  });
  if (count === 0) throw new HttpError(409, 'NO_ACTIVE_PLAN', 'You have no active plan to cancel.');
  const ent = await getEntitlements(userId, now);
  const until = ent.planUntil ? day(new Date(ent.planUntil)) : day(now);
  await notify(prisma, userId, {
    type: 'subscription.cancelled',
    title: 'Cancellation confirmed',
    body: `You keep ${PLAN_NAMES[ent.plan]} until ${until}. Nothing will renew and you won't get renewal reminders.`,
    link: '/settings/billing',
  });
  return billingOverview(userId);
}

/** Days before the end of a plan when the in-app reminder appears. */
export const EXPIRY_REMINDER_DAYS = 3;

/**
 * In-app notices: "ends soon" (not for cancelled plans) and "has ended". At most once per period
 * (dedupe keys). Entitlements never depend on this job; it only informs.
 */
export async function subscriptionNoticesSweep() {
  const now = await dbNow();
  const soon = new Date(now.getTime() + EXPIRY_REMINDER_DAYS * 86_400_000);
  // Periods that end without anything continuing them (no same-user ACTIVE period covering the end).
  const ending = await prisma.$queryRaw<
    { id: string; userId: string; plan: 'CREATOR_PLUS' | 'PRO'; periodEnd: Date; cancelledAt: Date | null }[]
  >`
    SELECT s."id", s."userId", s."plan", s."periodEnd", s."cancelledAt" FROM "subscription" s
    WHERE s."status" = 'ACTIVE' AND s."periodEnd" > ${new Date(now.getTime() - 7 * 86_400_000)} AND s."periodEnd" <= ${soon}
      AND NOT EXISTS (SELECT 1 FROM "subscription" n WHERE n."userId" = s."userId" AND n."status" = 'ACTIVE'
                      AND n."id" <> s."id" AND n."periodStart" <= s."periodEnd" AND n."periodEnd" > s."periodEnd")`;
  let sent = 0;
  for (const s of ending) {
    if (s.periodEnd > now) {
      if (s.cancelledAt) continue;
      await notify(prisma, s.userId, {
        type: 'subscription.expiring',
        title: `${PLAN_NAMES[s.plan]} ends on ${day(s.periodEnd)}`,
        body: 'Plans don’t renew automatically. Renew from Billing to keep your benefits.',
        link: '/settings/billing',
        dedupeKey: `sub-expiring:${s.id}`,
      });
    } else {
      await notify(prisma, s.userId, {
        type: 'subscription.ended',
        title: `${PLAN_NAMES[s.plan]} has ended`,
        body: 'You’re on Free now. Your work and links are kept; paid extras are hidden until you renew.',
        link: '/settings/billing',
        dedupeKey: `sub-ended:${s.id}`,
      });
    }
    sent += 1;
  }
  return sent;
}
