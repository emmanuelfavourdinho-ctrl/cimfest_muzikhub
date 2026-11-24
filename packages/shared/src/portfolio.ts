import { z } from 'zod';
import { LINK_PLATFORM_KEYS, normaliseHttpsUrl } from './links.js';
import { mediaViewSchema, type MediaKind } from './media.js';
import { GENRE_KEYS } from './taxonomy.js';

// ── Pagination (shared by portfolio, feed, discovery) ─────────
export const DEFAULT_PAGE_SIZE = 12;
export const MAX_PAGE_SIZE = 30;

export const pageQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });
export type Page<T> = { items: T[]; nextCursor: string | null };

// ── Portfolio ─────────────────────────────────────────────────
export const PORTFOLIO_TYPES = {
  AUDIO: { label: 'Song or recording', media: ['AUDIO'] },
  BEAT: { label: 'Beat or instrumental', media: ['AUDIO'] },
  VIDEO: { label: 'Video or performance', media: ['VIDEO'] },
  IMAGE: { label: 'Artwork or photo', media: ['IMAGE'] },
  PROJECT: { label: 'Project or credit', media: [] },
} as const satisfies Record<string, { label: string; media: readonly MediaKind[] }>;
export type PortfolioType = keyof typeof PORTFOLIO_TYPES;
export const PORTFOLIO_TYPE_KEYS = Object.keys(PORTFOLIO_TYPES) as [PortfolioType, ...PortfolioType[]];

export const PORTFOLIO_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type PortfolioStatus = (typeof PORTFOLIO_STATUSES)[number];
export const VISIBILITIES = ['PUBLIC', 'PRIVATE'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const PORTFOLIO_TITLE_MAX = 120;
export const PORTFOLIO_DESCRIPTION_MAX = 2000;

const optionalHttpsUrl = z
  .string()
  .trim()
  .max(500)
  .transform((value, ctx) => {
    const normalised = normaliseHttpsUrl(value);
    if (!normalised) {
      ctx.addIssue({ code: 'custom', message: 'Use a full https:// link' });
      return z.NEVER;
    }
    return normalised;
  })
  .nullable();

const portfolioFields = {
  type: z.enum(PORTFOLIO_TYPE_KEYS),
  title: z.string().trim().min(1, 'Give your work a title').max(PORTFOLIO_TITLE_MAX),
  description: z.string().trim().max(PORTFOLIO_DESCRIPTION_MAX).nullable(),
  genres: z.array(z.enum(GENRE_KEYS)).max(5, 'Choose up to 5 genres').transform((g) => [...new Set(g)]),
  credits: z.string().trim().max(500).nullable(),
  externalUrl: optionalHttpsUrl,
  /** A READY MediaAsset uploaded with purpose PORTFOLIO. */
  mediaId: z.string().min(1).nullable(),
  /** A READY image uploaded with purpose PORTFOLIO. */
  coverId: z.string().min(1).nullable(),
  visibility: z.enum(VISIBILITIES),
  featured: z.boolean(),
};

/** POST /api/v1/portfolio */
export const createPortfolioSchema = z
  .object({
    ...portfolioFields,
    description: portfolioFields.description.default(null),
    genres: portfolioFields.genres.default([]),
    credits: portfolioFields.credits.default(null),
    externalUrl: portfolioFields.externalUrl.default(null),
    mediaId: portfolioFields.mediaId.default(null),
    coverId: portfolioFields.coverId.default(null),
    visibility: portfolioFields.visibility.default('PUBLIC'),
    featured: portfolioFields.featured.default(false),
    /** Publish immediately instead of saving a draft. */
    publish: z.boolean().default(false),
    /** Approved 2026-11-23: opt-in, ticked by default in the UI. */
    shareToFeed: z.boolean().default(false),
  })
  .strict();
export type CreatePortfolioInput = z.input<typeof createPortfolioSchema>;

/** PATCH /api/v1/portfolio/:id — send only what changed. */
export const updatePortfolioSchema = z.object(portfolioFields).partial().strict();
export type UpdatePortfolioInput = z.input<typeof updatePortfolioSchema>;

/** POST /api/v1/portfolio/:id/publish */
export const publishPortfolioSchema = z.object({ shareToFeed: z.boolean().default(false) }).strict();

/**
 * What a piece of work needs before it can be published (drafts may be incomplete).
 * Returns a user-facing message or null.
 */
export function publishProblem(item: {
  type: PortfolioType;
  hasMedia: boolean;
  externalUrl: string | null;
  description: string | null;
}): string | null {
  switch (item.type) {
    case 'IMAGE':
      return item.hasMedia ? null : 'Upload the image before publishing.';
    case 'AUDIO':
    case 'BEAT':
    case 'VIDEO':
      return item.hasMedia || item.externalUrl ? null : 'Upload a file or add a link before publishing.';
    case 'PROJECT':
      return item.description || item.externalUrl ? null : 'Add a description or a link before publishing.';
  }
}

export const personSummarySchema = z.object({
  username: z.string(),
  name: z.string(),
  image: z.string().nullable(),
});
export type PersonSummary = z.infer<typeof personSummarySchema>;

export const portfolioItemSchema = z.object({
  id: z.string(),
  type: z.enum(PORTFOLIO_TYPE_KEYS),
  title: z.string(),
  description: z.string().nullable(),
  genres: z.array(z.enum(GENRE_KEYS)),
  credits: z.string().nullable(),
  externalUrl: z.string().nullable(),
  externalPlatform: z.enum(LINK_PLATFORM_KEYS).nullable(),
  media: mediaViewSchema.nullable(),
  cover: mediaViewSchema.nullable(),
  status: z.enum(PORTFOLIO_STATUSES),
  visibility: z.enum(VISIBILITIES),
  featured: z.boolean(),
  publishedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  owner: personSummarySchema,
  /** True when the signed-in viewer owns this item. */
  isOwner: z.boolean(),
  /** Shown to the owner only: the work was removed by moderators (hidden from everyone else). */
  moderation: z.object({ removedAt: z.iso.datetime(), reason: z.string().nullable() }).nullable(),
});
export type PortfolioItemView = z.infer<typeof portfolioItemSchema>;
export const portfolioPageSchema = pageSchema(portfolioItemSchema);
