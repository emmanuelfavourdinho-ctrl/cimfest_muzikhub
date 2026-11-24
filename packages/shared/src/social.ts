import { z } from 'zod';
import { mediaViewSchema } from './media.js';
import { pageQuerySchema, pageSchema, personSummarySchema, PORTFOLIO_TYPE_KEYS, portfolioItemSchema } from './portfolio.js';
import { CREATIVE_ROLE_KEYS, GENRE_KEYS, PRIMARY_USE_KEYS } from './taxonomy.js';

// ── Feed ──────────────────────────────────────────────────────
export const POST_BODY_MAX = 2000;
export const COMMENT_BODY_MAX = 1000;
export const MAX_POST_IMAGES = 4;

/**
 * POST /api/v1/posts — the post type is derived on the server from the attachments:
 * no media → TEXT, 1–4 images → IMAGE, one audio → AUDIO, one video → VIDEO.
 */
export const createPostSchema = z
  .object({
    body: z.string().trim().max(POST_BODY_MAX).default(''),
    mediaIds: z.array(z.string().min(1)).max(MAX_POST_IMAGES).default([]),
  })
  .strict()
  .refine((p) => p.body.length > 0 || p.mediaIds.length > 0, { message: 'Write something or attach media', path: ['body'] })
  .refine((p) => new Set(p.mediaIds).size === p.mediaIds.length, { message: 'Each file can be attached once', path: ['mediaIds'] });
export type CreatePostInput = z.input<typeof createPostSchema>;

/** PATCH /api/v1/posts/:id — text only; attachments are fixed once posted. */
export const updatePostSchema = z.object({ body: z.string().trim().max(POST_BODY_MAX) }).strict();

export const POST_TYPES = ['TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'SHOWCASE'] as const;

export const postSchema = z.object({
  id: z.string(),
  type: z.enum(POST_TYPES),
  body: z.string().nullable(),
  author: personSummarySchema,
  media: z.array(mediaViewSchema),
  portfolioItem: portfolioItemSchema.nullable(),
  likeCount: z.number().int(),
  commentCount: z.number().int(),
  likedByMe: z.boolean(),
  isAuthor: z.boolean(),
  createdAt: z.iso.datetime(),
  editedAt: z.iso.datetime().nullable(),
});
export type PostView = z.infer<typeof postSchema>;
export const postPageSchema = pageSchema(postSchema);

export const FEED_TABS = ['following', 'discover'] as const;
export type FeedTab = (typeof FEED_TABS)[number];
export const feedQuerySchema = pageQuerySchema.extend({ tab: z.enum(FEED_TABS).default('discover') });

export const likeStateSchema = z.object({ liked: z.boolean(), likeCount: z.number().int() });

export const createCommentSchema = z.object({ body: z.string().trim().min(1, 'Write a comment').max(COMMENT_BODY_MAX) }).strict();
export const commentSchema = z.object({
  id: z.string(),
  body: z.string(),
  author: personSummarySchema,
  createdAt: z.iso.datetime(),
  canDelete: z.boolean(),
});
export type CommentView = z.infer<typeof commentSchema>;
export const commentPageSchema = pageSchema(commentSchema);

// ── Reports (reviewed by moderators in Milestone 5) ──────────
export const REPORT_TARGETS = ['POST', 'COMMENT', 'PORTFOLIO_ITEM', 'PROFILE'] as const;
export const REPORT_REASONS = {
  SPAM: 'Spam or scam',
  HARASSMENT: 'Harassment or bullying',
  HATE: 'Hate speech',
  SEXUAL_CONTENT: 'Sexual content',
  VIOLENCE: 'Violence or threats',
  COPYRIGHT: 'Copyright infringement',
  IMPERSONATION: 'Impersonation',
  OTHER: 'Something else',
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;
export const createReportSchema = z
  .object({
    targetType: z.enum(REPORT_TARGETS),
    targetId: z.string().min(1),
    reason: z.enum(Object.keys(REPORT_REASONS) as [ReportReason, ...ReportReason[]]),
    details: z.string().trim().max(1000).optional(),
  })
  .strict();
export type CreateReportInput = z.infer<typeof createReportSchema>;

// ── Relationships ─────────────────────────────────────────────
export const CONNECTION_COOLDOWN_DAYS = 30; // approved 2026-11-23
export const CONNECTION_MESSAGE_MAX = 300;

export const CONNECTION_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'REMOVED'] as const;
export const createConnectionSchema = z
  .object({
    username: z.string().trim().toLowerCase().min(1),
    message: z.string().trim().max(CONNECTION_MESSAGE_MAX).optional(),
  })
  .strict();

export const connectionSchema = z.object({
  id: z.string(),
  status: z.enum(CONNECTION_STATUSES),
  /** From the viewer's point of view. */
  direction: z.enum(['incoming', 'outgoing']),
  person: personSummarySchema,
  message: z.string().nullable(),
  createdAt: z.iso.datetime(),
  respondedAt: z.iso.datetime().nullable(),
});
export type ConnectionView = z.infer<typeof connectionSchema>;
export const connectionPageSchema = pageSchema(connectionSchema);
export const connectionListQuerySchema = pageQuerySchema.extend({
  filter: z.enum(['incoming', 'outgoing', 'accepted']).default('accepted'),
});

/** How the viewer relates to a profile — drives the Follow / Connect buttons. */
export const relationshipSchema = z.object({
  isSelf: z.boolean(),
  following: z.boolean(),
  followsYou: z.boolean(),
  connection: z.object({ id: z.string(), status: z.enum(['PENDING', 'ACCEPTED']), direction: z.enum(['incoming', 'outgoing']) }).nullable(),
  /** When a declined request can be sent again (approved 30-day cooldown), else null. */
  canRequestAfter: z.iso.datetime().nullable(),
});
export type Relationship = z.infer<typeof relationshipSchema>;

export const followStateSchema = z.object({ following: z.boolean(), followers: z.number().int() });
export const personPageSchema = pageSchema(personSummarySchema);

// ── Discovery ─────────────────────────────────────────────────
const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    )
    .pipe(z.array(z.enum(values)).max(10));

export const discoverPeopleQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(80).optional(),
  roles: csvEnum(CREATIVE_ROLE_KEYS),
  genres: csvEnum(GENRE_KEYS),
  location: z.string().trim().max(80).optional(),
});
export type DiscoverPeopleQuery = z.input<typeof discoverPeopleQuerySchema>;

export const personCardSchema = personSummarySchema.extend({
  primaryUse: z.enum(PRIMARY_USE_KEYS).nullable(),
  roles: z.array(z.enum(CREATIVE_ROLE_KEYS)),
  genres: z.array(z.enum(GENRE_KEYS)),
  location: z.string().nullable(),
  bio: z.string().nullable(),
  cover: mediaViewSchema.nullable(),
  publishedWorkCount: z.number().int(),
  /** Whether the signed-in viewer follows this person (false when signed out). */
  following: z.boolean(),
});
export type PersonCard = z.infer<typeof personCardSchema>;
export const personCardPageSchema = pageSchema(personCardSchema);

export const discoverWorkQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(80).optional(),
  types: csvEnum(PORTFOLIO_TYPE_KEYS),
  genres: csvEnum(GENRE_KEYS),
});
export type DiscoverWorkQuery = z.input<typeof discoverWorkQuerySchema>;

// ── Profile stats (derived from real rows) ────────────────────
export const profileStatsSchema = z.object({
  followers: z.number().int(),
  following: z.number().int(),
  connections: z.number().int(),
  publishedWork: z.number().int(),
});
export type ProfileStats = z.infer<typeof profileStatsSchema>;
