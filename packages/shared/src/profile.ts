import { z } from 'zod';
import {
  CAREER_STAGE_KEYS,
  CREATIVE_ROLE_KEYS,
  GENRE_KEYS,
  GOAL_KEYS,
  PRIMARY_USE_KEYS,
} from './taxonomy.js';
import { LINK_PLATFORM_KEYS, MAX_PROFILE_LINKS, normaliseHttpsUrl } from './links.js';
import { mediaViewSchema } from './media.js';

// ── Username ──────────────────────────────────────────────────
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9_.]*[a-z0-9])?$/;
/** Words that would collide with app routes or impersonate staff. */
export const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'api', 'app', 'auth', 'login', 'logout', 'register', 'signup',
  'settings', 'onboarding', 'me', 'muzikhub', 'support', 'help', 'staff', 'moderator',
  'root', 'system', 'discover', 'feed', 'messages', 'notifications', 'u', 'profile',
]);

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(USERNAME_MIN, `Use at least ${USERNAME_MIN} characters`)
  .max(USERNAME_MAX, `Use at most ${USERNAME_MAX} characters`)
  .regex(USERNAME_PATTERN, 'Use letters, numbers, dots or underscores (not at the start or end)')
  .refine((v) => !RESERVED_USERNAMES.has(v), 'This username is reserved');

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

// ── Registration (validated in the browser, enforced again by the API) ──
export const registerSchema = z.object({
  primaryUse: z.enum(PRIMARY_USE_KEYS),
  name: z.string().trim().min(2, 'Enter your name').max(80),
  username: usernameSchema,
  email: z.email('Enter a valid email address').trim().toLowerCase(),
  password: z
    .string()
    .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
    .max(PASSWORD_MAX),
});
export type RegisterInput = z.infer<typeof registerSchema>;

// ── Profile ───────────────────────────────────────────────────
export const BIO_MAX = 600;

const tagList = (max: number) =>
  z
    .array(z.string().trim().min(1).max(40))
    .max(max)
    .transform((items) => [...new Set(items)]);

/** PATCH /api/v1/me/profile — every field optional; send only what changed. */
export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    bio: z.string().trim().max(BIO_MAX).nullable(),
    location: z.string().trim().max(80).nullable(),
    roles: z.array(z.enum(CREATIVE_ROLE_KEYS)).max(6, 'Choose up to 6 roles').transform((r) => [...new Set(r)]),
    genres: z.array(z.enum(GENRE_KEYS)).max(8, 'Choose up to 8 genres').transform((g) => [...new Set(g)]),
    skills: tagList(12),
    goals: z.array(z.enum(GOAL_KEYS)).max(GOAL_KEYS.length).transform((g) => [...new Set(g)]),
    careerStage: z.enum(CAREER_STAGE_KEYS).nullable(),
    primaryUse: z.enum(PRIMARY_USE_KEYS),
    /** Furthest onboarding step reached, so setup can resume where the user left off. */
    onboardingStep: z.number().int().min(0).max(20),
  })
  .partial()
  .strict();
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const profileLinkInputSchema = z.object({
  url: z
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
    }),
});

/** PUT /api/v1/me/profile/links — replaces the whole ordered list. */
export const replaceLinksSchema = z.object({
  links: z
    .array(profileLinkInputSchema)
    .max(MAX_PROFILE_LINKS, `Add up to ${MAX_PROFILE_LINKS} links`)
    .refine((links) => new Set(links.map((l) => l.url)).size === links.length, 'Each link can only be added once'),
});
export type ReplaceLinksInput = z.input<typeof replaceLinksSchema>;

/** PUT /api/v1/me/profile/avatar and /cover — a verified upload's id, or null to remove. */
export const setProfileImageSchema = z.object({ mediaId: z.string().min(1).nullable() });
export type SetProfileImageInput = z.infer<typeof setProfileImageSchema>;

// ── Responses ─────────────────────────────────────────────────
export const profileLinkSchema = z.object({
  id: z.string(),
  platform: z.enum(LINK_PLATFORM_KEYS),
  url: z.string(),
});
export type ProfileLink = z.infer<typeof profileLinkSchema>;

/** What anyone may see about a profile. Never includes email or account status. */
export const publicProfileSchema = z.object({
  username: z.string(),
  name: z.string(),
  /** Square avatar URL (192px), or null for the initials fallback. */
  image: z.string().nullable(),
  cover: mediaViewSchema.nullable(),
  bio: z.string().nullable(),
  location: z.string().nullable(),
  primaryUse: z.enum(PRIMARY_USE_KEYS).nullable(),
  roles: z.array(z.enum(CREATIVE_ROLE_KEYS)),
  genres: z.array(z.enum(GENRE_KEYS)),
  skills: z.array(z.string()),
  careerStage: z.enum(CAREER_STAGE_KEYS).nullable(),
  links: z.array(profileLinkSchema),
  joinedAt: z.iso.datetime(),
  /** Derived from real follow/connection/portfolio rows. */
  stats: z.object({ followers: z.number(), following: z.number(), connections: z.number(), publishedWork: z.number() }),
});
export type PublicProfile = z.infer<typeof publicProfileSchema>;

/** The signed-in user's own view: public profile + private account fields. */
export const meSchema = z.object({
  id: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  platformRole: z.enum(['USER', 'MODERATOR', 'ADMIN']),
  /** The viewer's own account state, so the app can explain restrictions. */
  accountStatus: z.enum(['ACTIVE', 'RESTRICTED', 'SUSPENDED', 'BANNED', 'DEACTIVATED']),
  statusReason: z.string().nullable(),
  statusUntil: z.iso.datetime().nullable(),
  twoFactorEnabled: z.boolean(),
  profile: publicProfileSchema.extend({
    goals: z.array(z.enum(GOAL_KEYS)),
    onboardingStep: z.number(),
    onboardingCompletedAt: z.iso.datetime().nullable(),
  }),
});
export type Me = z.infer<typeof meSchema>;
