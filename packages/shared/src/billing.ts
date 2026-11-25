import { z } from 'zod';
import { MAX_PROFILE_LINKS } from './links.js';
import { MEDIA_RULES } from './media.js';

/** Billing catalogue and entitlements (ADR 0004). Prices are whole XAF. */
export const BILLING_PRODUCTS = {
  CREATOR_PLUS: 'Creator Plus',
  PRO: 'MuzikHub Pro',
  POST_BOOST: 'Post Boost',
  PROFILE_SPOTLIGHT: 'Profile Spotlight',
} as const;
export type BillingProduct = keyof typeof BILLING_PRODUCTS;
export const BILLING_PRODUCT_KEYS = Object.keys(BILLING_PRODUCTS) as [BillingProduct, ...BillingProduct[]];

export const CATALOGUE_OPTIONS = {
  MONTHLY: { label: 'Monthly', days: 30 },
  ANNUAL: { label: 'Annual', days: 365 },
  DAYS_3: { label: '3 days', days: 3 },
  DAYS_7: { label: '7 days', days: 7 },
  DAYS_14: { label: '14 days', days: 14 },
} as const;
export type CatalogueOption = keyof typeof CATALOGUE_OPTIONS;
export const CATALOGUE_OPTION_KEYS = Object.keys(CATALOGUE_OPTIONS) as [CatalogueOption, ...CatalogueOption[]];

/**
 * Products that may be put on sale. EMPTY until each product's benefits are built and tested
 * (owner rule: no plan goes on sale before its benefits work). The server refuses to activate others.
 */
export const SELLABLE_PRODUCTS: readonly BillingProduct[] = [];

/** Owner-confirmed catalogue (CLAUDE.md pricing section; Phase 1 decisions). Seeded inactive. */
export const CATALOGUE_SEED: { product: BillingProduct; option: CatalogueOption; priceXaf: number }[] = [
  { product: 'CREATOR_PLUS', option: 'MONTHLY', priceXaf: 1500 },
  { product: 'CREATOR_PLUS', option: 'ANNUAL', priceXaf: 15000 },
  { product: 'PRO', option: 'MONTHLY', priceXaf: 3000 },
  { product: 'PRO', option: 'ANNUAL', priceXaf: 30000 },
  { product: 'POST_BOOST', option: 'DAYS_3', priceXaf: 1000 },
  { product: 'POST_BOOST', option: 'DAYS_7', priceXaf: 2500 },
  { product: 'POST_BOOST', option: 'DAYS_14', priceXaf: 5000 },
  { product: 'PROFILE_SPOTLIGHT', option: 'DAYS_3', priceXaf: 1500 },
  { product: 'PROFILE_SPOTLIGHT', option: 'DAYS_7', priceXaf: 3500 },
];

export const MB = 1024 * 1024;
export type PlanKey = 'FREE' | 'CREATOR_PLUS' | 'PRO';
export const PLAN_NAMES: Record<PlanKey, string> = { FREE: 'Free', CREATOR_PLUS: 'Creator Plus', PRO: 'MuzikHub Pro' };
export const PLAN_RANK: Record<PlanKey, number> = { FREE: 0, CREATOR_PLUS: 1, PRO: 2 };

export interface PlanLimits {
  imageBytes: number;
  audioBytes: number;
  videoBytes: number;
  profileLinks: number;
  profileAccent: boolean;
  /** Days of aggregated analytics history; 0 = none. */
  analyticsDays: number;
  /** Per-item (each work / post) analytics breakdown. */
  itemAnalytics: boolean;
}

/**
 * Per-file limits of the media account, VERIFIED 2026-11-24 with Cloudinary's Admin API usage
 * endpoint: plan "Free" — images 10 MB, video (Cloudinary stores audio as video) 100 MB.
 * No plan may promise more than this until the Cloudinary plan changes.
 */
export const MEDIA_ACCOUNT_CAPS = { plan: 'Cloudinary Free', imageBytes: 10 * MB, videoBytes: 100 * MB } as const;

/** Free = exactly today's limits (referenced, never copied). Nothing free is ever reduced. */
export const FREE_LIMITS: PlanLimits = {
  imageBytes: MEDIA_RULES.IMAGE.maxBytes,
  audioBytes: MEDIA_RULES.AUDIO.maxBytes,
  videoBytes: MEDIA_RULES.VIDEO.maxBytes,
  profileLinks: MAX_PROFILE_LINKS,
  profileAccent: false,
  analyticsDays: 0,
  itemAnalytics: false,
};

/**
 * Paid limits. Images and video already use the full account cap on Free, so they can't be
 * raised; audio can (50 → 100 MB, within the 100 MB cap). Analytics: aggregated daily counters.
 */
const PAID_BASE = {
  imageBytes: MEDIA_ACCOUNT_CAPS.imageBytes,
  audioBytes: MEDIA_ACCOUNT_CAPS.videoBytes,
  videoBytes: MEDIA_ACCOUNT_CAPS.videoBytes,
  profileLinks: 20,
  profileAccent: true,
} as const;
export const PLAN_LIMITS: Record<PlanKey, PlanLimits> = {
  FREE: FREE_LIMITS,
  CREATOR_PLUS: { ...PAID_BASE, analyticsDays: 30, itemAnalytics: false },
  PRO: { ...PAID_BASE, analyticsDays: 365, itemAnalytics: true },
};
/** The most links any plan allows (the request schema's ceiling; the plan check is server-side). */
export const MAX_LINKS_ANY_PLAN = Math.max(...Object.values(PLAN_LIMITS).map((l) => l.profileLinks));

/** Profile accent colours — names of approved palette roles only (CLAUDE.md §20). */
export const PROFILE_ACCENTS = { LIME: 'Lime', GOLD: 'Gold', VIOLET: 'Violet', SKY: 'Sky', MINT: 'Mint' } as const;
export type ProfileAccent = keyof typeof PROFILE_ACCENTS;
export const PROFILE_ACCENT_KEYS = Object.keys(PROFILE_ACCENTS) as [ProfileAccent, ...ProfileAccent[]];

const mb = (b: number) => `${Math.round(b / MB)} MB`;
/** What a plan includes, generated from PLAN_LIMITS so the pricing page can't drift from enforcement. */
export function planBenefits(plan: PlanKey): string[] {
  const l = PLAN_LIMITS[plan];
  const out = [
    `Uploads: images up to ${mb(l.imageBytes)}, audio up to ${mb(l.audioBytes)}, video up to ${mb(l.videoBytes)}`,
    `Up to ${l.profileLinks} links on your profile`,
  ];
  if (l.profileAccent) out.push('Profile accent colour');
  if (l.analyticsDays > 0) out.push(`Profile analytics: views, plays and link clicks, ${l.analyticsDays} days of history`);
  if (l.itemAnalytics) out.push('Per-item analytics for each work and post');
  return out;
}

export const catalogueItemSchema = z.object({
  product: z.enum(BILLING_PRODUCT_KEYS),
  option: z.enum(CATALOGUE_OPTION_KEYS),
  durationDays: z.number().int(),
  /** On sale for real money (live, owner-approved). False for everything today. */
  onSale: z.boolean(),
  /** Can be bought in the current payment mode (sandbox: with test money only). */
  purchasable: z.boolean(),
  /** Shown only when purchasable (owner rule: show a price only for what can be bought). */
  priceXaf: z.number().int().nullable(),
});
export type CatalogueItem = z.infer<typeof catalogueItemSchema>;
export const planSummarySchema = z.object({
  key: z.enum(['FREE', 'CREATOR_PLUS', 'PRO']),
  name: z.string(),
  limits: z.custom<PlanLimits>(),
  benefits: z.array(z.string()),
});
export const publicCatalogueSchema = z.object({
  currency: z.literal('XAF'),
  /** "sandbox": only test payments are possible; any checkout UI must say "Test payments". */
  paymentsMode: z.enum(['off', 'sandbox', 'live']),
  free: z.object({ limits: z.custom<PlanLimits>() }),
  plans: z.array(planSummarySchema),
  items: z.array(catalogueItemSchema),
});
export type PublicCatalogue = z.infer<typeof publicCatalogueSchema>;

export const adminCatalogueRowSchema = z.object({
  id: z.string(),
  product: z.enum(BILLING_PRODUCT_KEYS),
  option: z.enum(CATALOGUE_OPTION_KEYS),
  durationDays: z.number().int(),
  priceXaf: z.number().int(),
  active: z.boolean(),
  sellable: z.boolean(),
  effectiveFrom: z.string(),
  updatedBy: z.string().nullable(),
  reason: z.string().nullable(),
});
export type AdminCatalogueRow = z.infer<typeof adminCatalogueRowSchema>;

const reason = z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500);
export const changePriceSchema = z.strictObject({
  product: z.enum(BILLING_PRODUCT_KEYS),
  option: z.enum(CATALOGUE_OPTION_KEYS),
  priceXaf: z.number().int('Whole francs only').min(100, 'At least 100 FCFA').max(10_000_000),
  reason,
});
export type ChangePriceInput = z.infer<typeof changePriceSchema>;
export const setAvailabilitySchema = z.strictObject({
  product: z.enum(BILLING_PRODUCT_KEYS),
  option: z.enum(CATALOGUE_OPTION_KEYS),
  active: z.boolean(),
  reason,
});

export const entitlementsSchema = z.object({
  plan: z.enum(['FREE', 'CREATOR_PLUS', 'PRO']),
  planUntil: z.string().nullable(),
  limits: z.custom<PlanLimits>(),
  subscriptions: z.array(
    z.object({ id: z.string(), plan: z.enum(['CREATOR_PLUS', 'PRO']), periodStart: z.string(), periodEnd: z.string(), status: z.string() }),
  ),
});
export type Entitlements = z.infer<typeof entitlementsSchema>;

/** GET /api/v1/billing/preview — what buying this plan would do, computed by the server. */
export const subscriptionPreviewSchema = z.object({
  kind: z.enum(['new', 'extend', 'upgrade', 'downgrade']),
  plan: z.enum(['CREATOR_PLUS', 'PRO']),
  startsAt: z.string(),
  endsAt: z.string(),
  currentPlan: z.enum(['FREE', 'CREATOR_PLUS', 'PRO']),
  currentUntil: z.string().nullable(),
  note: z.string(),
});
export type SubscriptionPreview = z.infer<typeof subscriptionPreviewSchema>;

export const subscriptionPeriodSchema = z.object({
  id: z.string(),
  plan: z.enum(['CREATOR_PLUS', 'PRO']),
  periodStart: z.string(),
  periodEnd: z.string(),
  status: z.enum(['ACTIVE', 'CANCELLED', 'REFUNDED']),
  cancelledAt: z.string().nullable(),
  state: z.enum(['current', 'queued', 'ended']),
});
export const billingOverviewSchema = z.object({
  plan: z.enum(['FREE', 'CREATOR_PLUS', 'PRO']),
  planName: z.string(),
  planUntil: z.string().nullable(),
  limits: z.custom<PlanLimits>(),
  /** Plans never renew automatically; "cancelled" = you asked us to stop reminding you. */
  cancelled: z.boolean(),
  periods: z.array(subscriptionPeriodSchema),
});
export type BillingOverview = z.infer<typeof billingOverviewSchema>;

export const receiptSchema = z.object({
  reference: z.string(),
  status: z.string(),
  statusMessage: z.string(),
  product: z.string(),
  option: z.string(),
  amountXaf: z.number().int(),
  currency: z.literal('XAF'),
  mode: z.enum(['SANDBOX', 'LIVE']),
  provider: z.string(),
  createdAt: z.string(),
  paidAt: z.string().nullable(),
  refundedAt: z.string().nullable(),
  /** What was granted: e.g. the subscription period or the promotion window. */
  granted: z.object({ label: z.string(), from: z.string(), to: z.string() }).nullable(),
});
export type Receipt = z.infer<typeof receiptSchema>;
