import { describe, expect, it } from 'vitest';
import { canAssign, canRead, outranks, permissionsFor, type Membership } from './permissions.js';

const m = (
  role: 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER',
  status: 'ACTIVE' | 'PENDING' | 'INVITED' | 'BANNED' = 'ACTIVE',
): Membership => ({ role, status });

describe('community permissions', () => {
  it('reading: open communities for everyone; others for active members only', () => {
    expect(canRead('OPEN', null)).toBe(true);
    for (const p of ['REQUEST', 'INVITE'] as const) {
      expect(canRead(p, null)).toBe(false);
      expect(canRead(p, m('MEMBER', 'PENDING'))).toBe(false);
      expect(canRead(p, m('MEMBER', 'BANNED'))).toBe(false);
      expect(canRead(p, m('MEMBER'))).toBe(true);
    }
  });
  it('the role ladder', () => {
    expect(permissionsFor(null)).toEqual({
      post: false,
      announce: false,
      moderate: false,
      manageMembers: false,
      manageRoles: false,
      editSettings: false,
    });
    expect(permissionsFor(m('MEMBER'))).toMatchObject({ post: true, announce: false, moderate: false });
    expect(permissionsFor(m('MODERATOR'))).toMatchObject({ moderate: true, manageMembers: true, manageRoles: false, editSettings: false });
    expect(permissionsFor(m('ADMIN'))).toMatchObject({ announce: true, manageRoles: true, editSettings: true });
    expect(permissionsFor(m('OWNER', 'BANNED')).post).toBe(false);
  });
  it('acting on others needs a strictly higher role; nobody can make an owner', () => {
    expect(outranks(m('MODERATOR'), 'MEMBER')).toBe(true);
    expect(outranks(m('MODERATOR'), 'MODERATOR')).toBe(false);
    expect(canAssign(m('OWNER'), 'MEMBER', 'ADMIN')).toBe(true);
    expect(canAssign(m('ADMIN'), 'MEMBER', 'MODERATOR')).toBe(true);
    expect(canAssign(m('ADMIN'), 'MEMBER', 'ADMIN')).toBe(false);
    expect(canAssign(m('ADMIN'), 'ADMIN', 'MEMBER')).toBe(false);
    expect(canAssign(m('MODERATOR'), 'MEMBER', 'MODERATOR')).toBe(false);
    expect(canAssign(m('OWNER'), 'MEMBER', 'OWNER')).toBe(false);
  });
});
