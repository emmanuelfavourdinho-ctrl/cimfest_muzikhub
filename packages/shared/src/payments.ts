import { z } from 'zod';
import { BILLING_PRODUCT_KEYS, CATALOGUE_OPTION_KEYS } from './billing.js';

/** Payments lifecycle (Phase 3, ADR 0004, docs/payments-state-machine.md). */
export const ORDER_STATUSES = [
  'PENDING',
  'PROCESSING',
  'FULFILMENT_PENDING',
  'FULFILLED',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
  'NEEDS_REVIEW',
  'REFUNDED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Our own order lifetime (authoritative). Notch Pay documents 3 h on one page; ours applies regardless. */
export const ORDER_TTL_HOURS = 3;
/** A member may have at most this many unexpired pending orders at once. */
export const PENDING_ORDER_CAP = 3;

/** What a member sees for each status — our own state only, never the provider's redirect. */
export const ORDER_STATUS_MESSAGES: Record<OrderStatus, string> = {
  PENDING: 'Waiting for your payment.',
  PROCESSING: 'Your payment is being processed.',
  FULFILMENT_PENDING: 'Payment confirmed. Activating your purchase…',
  FULFILLED: 'Payment confirmed. Your purchase is active.',
  FAILED: 'The payment did not go through. You have not been charged by MuzikHub.',
  CANCELLED: 'This order was cancelled.',
  EXPIRED: 'This order expired before payment was confirmed.',
  NEEDS_REVIEW: 'We are checking this payment. Nothing more is needed from you right now.',
  REFUNDED: 'This order was refunded.',
};

export const startCheckoutSchema = z.strictObject({
  product: z.enum(BILLING_PRODUCT_KEYS),
  option: z.enum(CATALOGUE_OPTION_KEYS),
  /** Post Boost: the post id. Profile Spotlight: optional (always your own profile). */
  targetId: z.string().min(1).max(64).optional(),
});
export type StartCheckoutInput = z.infer<typeof startCheckoutSchema>;

export const orderViewSchema = z.object({
  reference: z.string(),
  status: z.enum(ORDER_STATUSES),
  statusMessage: z.string(),
  product: z.string(),
  option: z.string(),
  amountXaf: z.number().int(),
  currency: z.literal('XAF'),
  mode: z.enum(['SANDBOX', 'LIVE']),
  createdAt: z.string(),
  expiresAt: z.string(),
  /** Present only while the order can still be paid. */
  checkoutUrl: z.string().nullable(),
});
export type OrderView = z.infer<typeof orderViewSchema>;

export const checkoutResultSchema = z.object({
  order: orderViewSchema,
  /** True when an existing pending order for the same item was returned instead of a new one. */
  reused: z.boolean(),
});
export type CheckoutResult = z.infer<typeof checkoutResultSchema>;
