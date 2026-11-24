import { z } from 'zod';
import { pageQuerySchema } from './portfolio.js';
import { CREATIVE_ROLE_KEYS } from './taxonomy.js';

// ── Roles and permissions (approved 2026-11-24) ───────────────
// Professional identity (CreativeRole) is separate and grants no authority.
// FINANCE_ADMIN is deferred until payments exist.

export const PLATFORM_ROLES = ['USER', 'MODERATOR', 'ADMIN'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];
export const STAFF_ROLES = ['MODERATOR', 'ADMIN'] as const satisfies readonly PlatformRole[];

export const ACCOUNT_STATUSES = ['ACTIVE', 'RESTRICTED', 'SUSPENDED', 'BANNED', 'DEACTIVATED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/**
 * Single permission matrix. The API enforces it on every admin endpoint; the web app only
 * uses it to decide what to show. Least privilege: moderators get moderation, nothing more.
 */
export const PERMISSIONS = {
  'admin.access': ['MODERATOR', 'ADMIN'],
  'overview.view': ['MODERATOR', 'ADMIN'],
  'reports.manage': ['MODERATOR', 'ADMIN'],
  /** Escalated reports are decided by an administrator. */
  'reports.decideEscalated': ['ADMIN'],
  'content.moderate': ['MODERATOR', 'ADMIN'],
  'users.view': ['MODERATOR', 'ADMIN'],
  /** Email address and other private account details. */
  'users.viewPrivate': ['ADMIN'],
  'users.restrict': ['MODERATOR', 'ADMIN'],
  'users.suspend': ['MODERATOR', 'ADMIN'],
  'users.ban': ['ADMIN'],
  'users.reinstateBanned': ['ADMIN'],
  'roles.assign': ['ADMIN'],
  'staff.resetTwoFactor': ['ADMIN'],
  'audit.view': ['ADMIN'],
  /** Grant or revoke the organiser capability (D7: opportunities, competitions). */
  'organisers.grant': ['ADMIN'],
  /** Edit catalogue prices and availability (audited; new orders only). */
  'pricing.manage': ['ADMIN'],
  /** Read any member's subscriptions, promotions (and later orders). FINANCE_ADMIN later. */
  'billing.view': ['ADMIN'],
  'payments.refund': ['ADMIN'],
  'payments.repair': ['ADMIN'],
  /** D9: competition disputes are decided by an admin. */
  'competitions.disputes': ['ADMIN'],
} as const satisfies Record<string, readonly PlatformRole[]>;
export type Permission = keyof typeof PERMISSIONS;

export function can(role: string | null | undefined, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly string[]).includes(role ?? '');
}

/** Rank for "you can only act on accounts below your own role". */
export const ROLE_RANK: Record<PlatformRole, number> = { USER: 0, MODERATOR: 1, ADMIN: 2 };

/** Longest suspension each role may impose ("within defined limits"). */
export const SUSPENSION_MAX_DAYS: Record<'MODERATOR' | 'ADMIN', number> = { MODERATOR: 30, ADMIN: 365 };

/** Sensitive actions need a session created within this window (sign in again otherwise). */
export const FRESH_SESSION_MINUTES = 15;

// ── Requests ──────────────────────────────────────────────────
export const reasonSchema = z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(1000);

export const setAccountStatusSchema = z
  .object({
    status: z.enum(['ACTIVE', 'RESTRICTED', 'SUSPENDED', 'BANNED']),
    reason: reasonSchema,
    /** Required for SUSPENDED: when the suspension ends. */
    until: z.iso.datetime().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.status === 'SUSPENDED') {
      if (!v.until) ctx.addIssue({ code: 'custom', path: ['until'], message: 'A suspension needs an end date' });
      else if (new Date(v.until) <= new Date())
        ctx.addIssue({ code: 'custom', path: ['until'], message: 'The end date must be in the future' });
    } else if (v.until) {
      ctx.addIssue({ code: 'custom', path: ['until'], message: 'Only suspensions have an end date' });
    }
  });
export type SetAccountStatusInput = z.infer<typeof setAccountStatusSchema>;

export const setRoleSchema = z.object({ role: z.enum(PLATFORM_ROLES), reason: reasonSchema }).strict();
export const reasonOnlySchema = z.object({ reason: reasonSchema }).strict();

export const MODERATION_TARGETS = [
  'post',
  'comment',
  'portfolio-item',
  'profile-avatar',
  'profile-cover',
  'community',
  'discussion',
  'discussion-comment',
  'competition',
  'competition-entry',
  'message',
] as const;
export type ModerationTarget = (typeof MODERATION_TARGETS)[number];
export const moderationActionSchema = z.object({ reason: reasonSchema, reportId: z.string().min(1).optional() }).strict();

export const reportNoteSchema = z.object({ body: z.string().trim().min(1, 'Write a note').max(2000) }).strict();
export const resolveReportSchema = z
  .object({
    resolution: reasonSchema,
    /** Also close other open reports about the same content (default true). */
    includeRelated: z.boolean().default(true),
  })
  .strict();
export const assignReportSchema = z.object({ assignee: z.enum(['me', 'nobody']) }).strict();

// ── Queries ───────────────────────────────────────────────────
export const adminUsersQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(80).optional(),
  status: z.enum(ACCOUNT_STATUSES).optional(),
  role: z.enum(PLATFORM_ROLES).optional(),
  creativeRole: z.enum(CREATIVE_ROLE_KEYS).optional(),
});
export const REPORT_STATUSES = ['PENDING', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED'] as const;
export const adminReportsQuerySchema = pageQuerySchema.extend({
  status: z.enum(REPORT_STATUSES).optional(),
  open: z.enum(['true', 'false']).optional(),
  targetType: z.enum(['POST', 'COMMENT', 'PORTFOLIO_ITEM', 'PROFILE']).optional(),
  assigned: z.enum(['me', 'unassigned']).optional(),
  escalated: z.enum(['true', 'false']).optional(),
});
export const adminContentQuerySchema = pageQuerySchema.extend({
  type: z.enum(['post', 'comment', 'portfolio-item', 'community', 'competition']).default('post'),
  state: z.enum(['visible', 'removed']).default('visible'),
  q: z.string().trim().max(80).optional(),
});
export const auditQuerySchema = pageQuerySchema.extend({
  action: z.string().trim().max(80).optional(),
  targetType: z.string().trim().max(40).optional(),
  targetId: z.string().trim().max(80).optional(),
  actorId: z.string().trim().max(80).optional(),
});
