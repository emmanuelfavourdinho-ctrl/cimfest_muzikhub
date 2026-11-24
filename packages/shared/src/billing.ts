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
export interface PlanLimits {
  imageBytes: number;
  audioBytes: number;
  videoBytes: number;
  profileLinks: number;
  profileAccent: boolean;
  /** Days of aggregated analytics history; 0 = none. */
  analyticsDays: number;
}

/** Free = exactly today's limits (referenced, never copied). Nothing free is ever reduced. */
export const FREE_LIMITS: PlanLimits = {
  imageBytes: MEDIA_RULES.IMAGE.maxBytes,
  audioBytes: MEDIA_RULES.AUDIO.maxBytes,
  videoBytes: MEDIA_RULES.VIDEO.maxBytes,
  profileLinks: MAX_PROFILE_LINKS,
  profileAccent: false,
  analyticsDays: 0,
};

/**
 * PROPOSED paid limits — pending the owner's confirmation that the Cloudinary plan accepts these
 * file sizes. Not enforced anywhere until Phase 5; no plan is on sale.
 */
export const PLAN_LIMITS: Record<PlanKey, PlanLimits> = {
  FREE: FREE_LIMITS,
  CREATOR_PLUS: {
    imageBytes: 20 * MB,
    audioBytes: 100 * MB,
    videoBytes: 200 * MB,
    profileLinks: 20,
    profileAccent: true,
    analyticsDays: 30,
  },
  PRO: { imageBytes: 20 * MB, audioBytes: 100 * MB, videoBytes: 200 * MB, profileLinks: 20, profileAccent: true, analyticsDays: 365 },
};

export const catalogueItemSchema = z.object({
  product: z.enum(BILLING_PRODUCT_KEYS),
  option: z.enum(CATALOGUE_OPTION_KEYS),
  durationDays: z.number().int(),
  /** Can actually be bought right now. */
  onSale: z.boolean(),
  /** Shown only when onSale (owner rule: show a price only for products that can be bought). */
  priceXaf: z.number().int().nullable(),
});
export type CatalogueItem = z.infer<typeof catalogueItemSchema>;
export const publicCatalogueSchema = z.object({
  currency: z.literal('XAF'),
  free: z.object({ limits: z.custom<PlanLimits>() }),
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
