import {
  detectLinkPlatform,
  type Me,
  type PublicProfile,
  type ReplaceLinksInput,
  type UpdateProfileInput,
  replaceLinksSchema,
} from '@muzikhub/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { releaseAssets, requireAttachable, toMediaView } from '../media/media.service.js';
import { profileStats } from '../network/network.service.js';
import { isVisibleStatus } from '../../lib/account-status.js';

const profileInclude = {
  profile: { include: { links: { orderBy: { position: 'asc' } }, avatarAsset: true, coverAsset: true } },
} satisfies Prisma.UserInclude;

type UserWithProfile = Prisma.UserGetPayload<{ include: typeof profileInclude }>;

function requireProfile(user: UserWithProfile) {
  // Created by the Better Auth user.create.after hook; absence means data corruption.
  if (!user.profile || !user.username) {
    throw new HttpError(500, 'PROFILE_MISSING', 'Profile record is missing');
  }
  return { profile: user.profile, username: user.username };
}

/** Maps DB rows to the public shape. Deliberately omits email, status and role. */
function toPublicProfile(user: UserWithProfile, stats: PublicProfile['stats']): PublicProfile {
  const { profile, username } = requireProfile(user);
  return {
    username,
    name: user.name,
    image: profile.avatarAsset ? (toMediaView(profile.avatarAsset).urls.square ?? null) : null,
    cover: profile.coverAsset ? toMediaView(profile.coverAsset) : null,
    bio: profile.bio,
    location: profile.location,
    primaryUse: user.primaryUse,
    roles: profile.roles,
    genres: profile.genres as PublicProfile['genres'],
    skills: profile.skills,
    careerStage: profile.careerStage,
    links: profile.links.map((l) => ({ id: l.id, platform: l.platform, url: l.url })),
    joinedAt: user.createdAt.toISOString(),
    stats,
  };
}

function toMe(user: UserWithProfile, stats: PublicProfile['stats']): Me {
  const { profile } = requireProfile(user);
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    platformRole: user.platformRole,
    accountStatus: user.status,
    statusReason: user.statusReason,
    statusUntil: user.statusUntil?.toISOString() ?? null,
    twoFactorEnabled: user.twoFactorEnabled,
    profile: {
      ...toPublicProfile(user, stats),
      goals: profile.goals as Me['profile']['goals'],
      onboardingStep: profile.onboardingStep,
      onboardingCompletedAt: profile.onboardingCompletedAt?.toISOString() ?? null,
    },
  };
}

export async function getPublicProfile(username: string): Promise<PublicProfile> {
  const user = await prisma.user.findUnique({
    where: { username: username.toLowerCase() },
    include: profileInclude,
  });
  // Inactive accounts are indistinguishable from missing ones to visitors.
  if (!user || !isVisibleStatus(user.status)) {
    throw new HttpError(404, 'PROFILE_NOT_FOUND', 'No profile with that username');
  }
  return toPublicProfile(user, await profileStats(user.id));
}

export async function getMe(userId: string): Promise<Me> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: profileInclude });
  return toMe(user, await profileStats(userId));
}

export async function updateProfile(userId: string, input: UpdateProfileInput): Promise<Me> {
  const { name, primaryUse, ...profileFields } = input;
  await prisma.$transaction(async (tx) => {
    if (name !== undefined || primaryUse !== undefined) {
      await tx.user.update({ where: { id: userId }, data: { name, primaryUse } });
    }
    if (Object.keys(profileFields).length > 0) {
      const { onboardingStep, ...rest } = profileFields;
      const current = await tx.profile.findUniqueOrThrow({
        where: { userId },
        select: { onboardingStep: true },
      });
      await tx.profile.update({
        where: { userId },
        data: {
          ...rest,
          // Progress only moves forward, so going back a step never loses saved progress.
          ...(onboardingStep !== undefined && {
            onboardingStep: Math.max(current.onboardingStep, onboardingStep),
          }),
        },
      });
    }
  });
  return getMe(userId);
}

export async function replaceLinks(userId: string, input: ReplaceLinksInput): Promise<Me> {
  // Parse again here so the service is safe even if called without the route's validation.
  const { links } = replaceLinksSchema.parse(input);
  await prisma.$transaction([
    prisma.profileLink.deleteMany({ where: { profileId: userId } }),
    prisma.profileLink.createMany({
      data: links.map((link, position) => ({
        profileId: userId,
        url: link.url,
        platform: detectLinkPlatform(link.url),
        position,
      })),
    }),
  ]);
  return getMe(userId);
}

export async function completeOnboarding(userId: string): Promise<Me> {
  // updateMany with a null filter makes this idempotent: repeating it keeps the first timestamp.
  await prisma.profile.updateMany({
    where: { userId, onboardingCompletedAt: null },
    data: { onboardingCompletedAt: new Date() },
  });
  return getMe(userId);
}

/**
 * Sets (or clears) the profile photo or cover. The previous image is removed from
 * Cloudinary afterwards, so replaced photos don't accumulate as orphans.
 */
export async function setProfileImage(
  userId: string,
  slot: 'avatar' | 'cover',
  mediaId: string | null,
): Promise<Me> {
  const field = slot === 'avatar' ? 'avatarAssetId' : 'coverAssetId';
  const current = await prisma.profile.findUniqueOrThrow({
    where: { userId },
    select: { avatarAssetId: true, coverAssetId: true },
  });
  const previousId = current[field];
  if (previousId === mediaId) return getMe(userId);

  if (mediaId) await requireAttachable(userId, mediaId, slot === 'avatar' ? 'AVATAR' : 'COVER');
  await prisma.profile.update({ where: { userId }, data: { [field]: mediaId } });
  if (previousId) await releaseAssets([previousId]);
  return getMe(userId);
}
