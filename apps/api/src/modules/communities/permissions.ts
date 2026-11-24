import type { CommunityPolicy, CommunityRole } from '@muzikhub/shared';

/**
 * Community permission matrix — scoped to ONE community, never platform-wide (CLAUDE.md §11).
 * Pure functions so every rule is unit-tested; every service call goes through them.
 */
export type Membership = { role: CommunityRole; status: 'ACTIVE' | 'PENDING' | 'INVITED' | 'BANNED' } | null;
export const RANK: Record<CommunityRole, number> = { OWNER: 3, ADMIN: 2, MODERATOR: 1, MEMBER: 0 };

const active = (m: Membership): m is NonNullable<Membership> => m?.status === 'ACTIVE';

export const canRead = (policy: CommunityPolicy, m: Membership) => policy === 'OPEN' || active(m);
export const canPost = (m: Membership) => active(m);
export const canAnnounce = (m: Membership) => active(m) && RANK[m.role] >= RANK.ADMIN;
export const canModerate = (m: Membership) => active(m) && RANK[m.role] >= RANK.MODERATOR;
export const canManageMembers = canModerate;
export const canManageRoles = (m: Membership) => active(m) && RANK[m.role] >= RANK.ADMIN;
export const canEditSettings = (m: Membership) => active(m) && RANK[m.role] >= RANK.ADMIN;

/** Acting on another member (ban, change role) needs a strictly higher role. */
export const outranks = (actor: Membership, targetRole: CommunityRole) => active(actor) && RANK[actor.role] > RANK[targetRole];

/** Which roles an actor may give: owners give admin/moderator/member; admins give moderator/member. */
export function canAssign(actor: Membership, currentRole: CommunityRole, newRole: CommunityRole) {
  if (!active(actor) || newRole === 'OWNER') return false;
  if (!outranks(actor, currentRole)) return false;
  return RANK[actor.role] > RANK[newRole];
}

export function permissionsFor(m: Membership) {
  return {
    post: canPost(m),
    announce: canAnnounce(m),
    moderate: canModerate(m),
    manageMembers: canManageMembers(m),
    manageRoles: canManageRoles(m),
    editSettings: canEditSettings(m),
  };
}
