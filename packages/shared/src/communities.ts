import { z } from 'zod';
import { personSummarySchema } from './portfolio.js';
import { GENRE_KEYS } from './taxonomy.js';

/** Communities (FR-24–29): discussion, knowledge-sharing and mentorship around shared interests. */
export const COMMUNITY_CATEGORIES = {
  PRODUCTION: 'Production and beats',
  SONGWRITING: 'Songwriting',
  PERFORMANCE: 'Performance and live',
  ENGINEERING: 'Mixing and engineering',
  BUSINESS: 'Music business',
  MARKETING: 'Marketing and release',
  GENRE: 'Genre scene',
  LOCAL_SCENE: 'Local scene',
  MENTORSHIP: 'Mentorship',
  OTHER: 'Other',
} as const;
export type CommunityCategory = keyof typeof COMMUNITY_CATEGORIES;
export const COMMUNITY_CATEGORY_KEYS = Object.keys(COMMUNITY_CATEGORIES) as [CommunityCategory, ...CommunityCategory[]];

export const COMMUNITY_POLICIES = {
  OPEN: { label: 'Open', help: 'Anyone can read and join.' },
  REQUEST: { label: 'Request to join', help: 'Moderators approve new members. Discussions are for members only.' },
  INVITE: { label: 'Invitation only', help: 'Members join by invitation. Discussions are for members only.' },
} as const;
export type CommunityPolicy = keyof typeof COMMUNITY_POLICIES;
export const COMMUNITY_POLICY_KEYS = Object.keys(COMMUNITY_POLICIES) as [CommunityPolicy, ...CommunityPolicy[]];

export const COMMUNITY_ROLES = { OWNER: 'Owner', ADMIN: 'Admin', MODERATOR: 'Moderator', MEMBER: 'Member' } as const;
export type CommunityRole = keyof typeof COMMUNITY_ROLES;

export const DISCUSSION_KINDS = {
  DISCUSSION: 'Discussion',
  QUESTION: 'Question',
  GUIDE: 'Knowledge share',
  MENTORSHIP: 'Mentorship',
  ANNOUNCEMENT: 'Announcement',
} as const;
export type DiscussionKind = keyof typeof DISCUSSION_KINDS;
export const DISCUSSION_KIND_KEYS = Object.keys(DISCUSSION_KINDS) as [DiscussionKind, ...DiscussionKind[]];

/** Communities a member may own at once (stops spam; platform staff can remove any). */
export const MAX_OWNED_COMMUNITIES = 5;

const text = (min: number, max: number, label: string) =>
  z.string().trim().min(min, `${label} needs at least ${min} characters`).max(max, `${label} can be up to ${max} characters`);

export const createCommunitySchema = z.strictObject({
  name: text(3, 80, 'Name'),
  description: text(20, 1000, 'Description'),
  category: z.enum(COMMUNITY_CATEGORY_KEYS),
  rules: text(10, 4000, 'Rules'),
  policy: z.enum(COMMUNITY_POLICY_KEYS),
  interests: z.array(z.enum(GENRE_KEYS)).max(5, 'Choose up to 5 genres').default([]),
  coverId: z.string().min(1).nullable().optional(),
});
export type CreateCommunityInput = z.infer<typeof createCommunitySchema>;
export const updateCommunitySchema = createCommunitySchema.partial().strict();

export const communityQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  category: z.enum(COMMUNITY_CATEGORY_KEYS).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(30).default(12),
});

export const joinCommunitySchema = z.strictObject({ note: z.string().trim().max(300).optional() });
export const inviteSchema = z.strictObject({ username: z.string().trim().toLowerCase().min(1).max(40) });
export const memberRoleSchema = z.strictObject({ role: z.enum(['ADMIN', 'MODERATOR', 'MEMBER']) });
export const memberActionSchema = z.strictObject({ reason: z.string().trim().max(500).optional() });

export const createDiscussionSchema = z.strictObject({
  kind: z.enum(DISCUSSION_KIND_KEYS),
  title: text(3, 160, 'Title'),
  body: text(1, 10000, 'Text'),
});
export const updateDiscussionSchema = z.strictObject({ title: text(3, 160, 'Title').optional(), body: text(1, 10000, 'Text').optional() });
export const discussionQuerySchema = z.object({
  kind: z.enum(DISCUSSION_KIND_KEYS).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(30).default(15),
});
export const createDiscussionCommentSchema = z.strictObject({ body: text(1, 4000, 'Reply'), parentId: z.string().max(64).optional() });
export const updateDiscussionCommentSchema = z.strictObject({ body: text(1, 4000, 'Reply') });
export const moderationReasonSchema = z.strictObject({
  reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500),
});

export const membershipSchema = z
  .object({ status: z.enum(['ACTIVE', 'PENDING', 'INVITED', 'BANNED']), role: z.enum(['OWNER', 'ADMIN', 'MODERATOR', 'MEMBER']) })
  .nullable();

export const communityCardSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.enum(COMMUNITY_CATEGORY_KEYS),
  policy: z.enum(COMMUNITY_POLICY_KEYS),
  interests: z.array(z.string()),
  cover: z.string().nullable(),
  memberCount: z.number().int(),
  discussionCount: z.number().int(),
  lastActivityAt: z.string().nullable(),
  featured: z.boolean(),
  membership: membershipSchema,
});
export type CommunityCard = z.infer<typeof communityCardSchema>;

export const communityDetailSchema = communityCardSchema.extend({
  rules: z.string(),
  createdAt: z.string(),
  canRead: z.boolean(),
  owner: personSummarySchema,
  moderators: z.array(personSummarySchema.extend({ role: z.enum(['OWNER', 'ADMIN', 'MODERATOR']) })),
  permissions: z.object({
    post: z.boolean(),
    announce: z.boolean(),
    moderate: z.boolean(),
    manageMembers: z.boolean(),
    manageRoles: z.boolean(),
    editSettings: z.boolean(),
  }),
  pendingRequests: z.number().int(),
});
export type CommunityDetail = z.infer<typeof communityDetailSchema>;

export const memberViewSchema = personSummarySchema.extend({
  role: z.enum(['OWNER', 'ADMIN', 'MODERATOR', 'MEMBER']),
  status: z.enum(['ACTIVE', 'PENDING', 'INVITED', 'BANNED']),
  requestNote: z.string().nullable(),
  joinedAt: z.string().nullable(),
});
export type MemberView = z.infer<typeof memberViewSchema>;

export const discussionViewSchema = z.object({
  id: z.string(),
  community: z.object({ slug: z.string(), name: z.string() }),
  kind: z.enum(DISCUSSION_KIND_KEYS),
  title: z.string(),
  body: z.string(),
  author: personSummarySchema.extend({ communityRole: z.enum(['OWNER', 'ADMIN', 'MODERATOR', 'MEMBER']).nullable() }),
  pinned: z.boolean(),
  locked: z.boolean(),
  answered: z.boolean(),
  acceptedCommentId: z.string().nullable(),
  commentCount: z.number().int(),
  helpfulCount: z.number().int(),
  helpfulByMe: z.boolean(),
  followedByMe: z.boolean(),
  isAuthor: z.boolean(),
  canModerate: z.boolean(),
  createdAt: z.string(),
  editedAt: z.string().nullable(),
  lastActivityAt: z.string(),
});
export type DiscussionView = z.infer<typeof discussionViewSchema>;

export const discussionCommentViewSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  body: z.string(),
  author: personSummarySchema.extend({ communityRole: z.enum(['OWNER', 'ADMIN', 'MODERATOR', 'MEMBER']).nullable() }),
  isAuthor: z.boolean(),
  canModerate: z.boolean(),
  accepted: z.boolean(),
  createdAt: z.string(),
  editedAt: z.string().nullable(),
});
export type DiscussionCommentView = z.infer<typeof discussionCommentViewSchema>;

/** `@username` mentions in community text (lower-case usernames, up to 5 notified). */
export function extractMentions(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/(^|[^\w@.])@([a-z0-9][a-z0-9._-]{1,29})/gi)) found.add(m[2]!.toLowerCase());
  return [...found].slice(0, 5);
}
