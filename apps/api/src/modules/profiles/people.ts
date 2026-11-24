import type { PersonSummary } from '@muzikhub/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { toMediaView } from '../media/media.service.js';

/** Minimal public identity shown next to content (cards, posts, comments). */
export const personSelect = {
  username: true,
  name: true,
  profile: { select: { avatarAsset: true } },
} satisfies Prisma.UserSelect;

export type PersonRow = Prisma.UserGetPayload<{ select: typeof personSelect }>;

export function toPerson(user: PersonRow): PersonSummary {
  const avatar = user.profile?.avatarAsset;
  return {
    username: user.username ?? '',
    name: user.name,
    image: avatar ? (toMediaView(avatar).urls.square ?? null) : null,
  };
}
