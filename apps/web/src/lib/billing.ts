import { useQuery } from '@tanstack/react-query';
import {
  billingOverviewSchema,
  checkoutResultSchema,
  entitlementsSchema,
  orderViewSchema,
  publicCatalogueSchema,
  receiptSchema,
  postSchema,
  personSummarySchema,
  subscriptionPreviewSchema,
  type BillingProduct,
  type CatalogueOption,
} from '@muzikhub/shared';
import { z } from 'zod';
import { request } from './api';
import { useMe } from './queries';

/** Everything billing-related the web app asks the API for. The API is the only source of truth. */
export const billingKeys = {
  catalogue: ['catalogue'] as const,
  entitlements: ['billing', 'entitlements'] as const,
  overview: ['billing', 'overview'] as const,
  orders: ['billing', 'orders'] as const,
  order: (ref: string) => ['billing', 'order', ref] as const,
  notifications: ['notifications'] as const,
  unread: ['notifications', 'unread'] as const,
};

const page = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), nextCursor: z.string().nullable() });
export const notificationSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  read: z.boolean(),
  createdAt: z.string(),
});
export type NotificationView = z.infer<typeof notificationSchema>;

const promotionSchema = z.object({
  id: z.string(),
  product: z.enum(['POST_BOOST', 'PROFILE_SPOTLIGHT']),
  targetType: z.enum(['POST', 'PROFILE']),
  targetId: z.string(),
  targetLabel: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  state: z.enum(['running', 'queued', 'ended']),
  endedReason: z.string().nullable(),
});
export type OwnPromotion = z.infer<typeof promotionSchema>;
const promotionPreviewSchema = z.object({ startsAt: z.string(), endsAt: z.string(), extendsCurrent: z.boolean(), targetId: z.string() });

export const billingApi = {
  promotedPosts: () => request('/promoted/posts', z.object({ items: z.array(postSchema.extend({ promotedUntil: z.string() })) })),
  spotlight: () => request('/promoted/spotlight', z.object({ people: z.array(personSummarySchema) })),
  promotions: () => request('/billing/promotions', z.object({ items: z.array(promotionSchema) })),
  promotionPreview: (product: string, option: string, targetId?: string) =>
    request('/billing/promotion-preview', promotionPreviewSchema, { query: { product, option, targetId } }),
  catalogue: () => request('/catalogue', publicCatalogueSchema),
  entitlements: () => request('/billing/entitlements', entitlementsSchema),
  overview: () => request('/billing/overview', billingOverviewSchema),
  preview: (product: string, option: string) => request('/billing/preview', subscriptionPreviewSchema, { query: { product, option } }),
  checkout: (body: { product: BillingProduct; option: CatalogueOption; targetId?: string }, idempotencyKey: string) =>
    request('/checkout', checkoutResultSchema, { method: 'POST', body, idempotencyKey }),
  order: (reference: string) => request(`/checkout/orders/${encodeURIComponent(reference)}`, orderViewSchema),
  cancelOrder: (reference: string) =>
    request(`/checkout/orders/${encodeURIComponent(reference)}/cancel`, orderViewSchema, { method: 'POST' }),
  cancelSubscription: () => request('/billing/subscription/cancel', billingOverviewSchema, { method: 'POST' }),
  orders: (cursor?: string) => request('/billing/orders', page(orderViewSchema), { query: { cursor } }),
  receipt: (reference: string) => request(`/billing/orders/${encodeURIComponent(reference)}`, receiptSchema),
  notifications: (cursor?: string) => request('/notifications', page(notificationSchema), { query: { cursor } }),
  unreadCount: () => request('/notifications/unread-count', z.object({ count: z.number() })),
  markRead: (ids: string[] | 'all') => request('/notifications/read', z.object({ updated: z.number() }), { method: 'POST', body: { ids } }),
};

export const useCatalogue = () => useQuery({ queryKey: billingKeys.catalogue, queryFn: billingApi.catalogue });

/** The signed-in member's current limits (Free while signed out or loading). */
export function useEntitlements() {
  const { data: me } = useMe();
  return useQuery({ queryKey: billingKeys.entitlements, queryFn: billingApi.entitlements, enabled: Boolean(me) });
}
