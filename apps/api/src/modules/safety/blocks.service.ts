import type { PersonSummary } from '@muzikhub/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { visibleUser } from '../../lib/account-status.js';
import { personSelect, toPerson } from '../profiles/people.js';

type Db = Prisma.TransactionClient | typeof prisma;

/** A visible member's id by username, or 404 (kept here so blocks has no dependency on network). */
async function requireActiveUser(username: string) {
  const user = await prisma.user.findFirst({ where: { username: username.toLowerCase(), ...visibleUser }, select: { id: true } });
  if (!user) throw new HttpError(404, 'USER_NOT_FOUND', 'No member with that username');
  return user.id;
}

/** True when either user has blocked the other. */
export async function isBlockedEither(a: string, b: string, db: Db = prisma): Promise<boolean> {
  if (a === b) return false;
  const n = await db.userBlock.count({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
  });
  return n > 0;
}

/** The single check every interaction service calls (messages, requests, follows, invites). */
export async function assertNotBlocked(a: string, b: string, db: Db = prisma) {
  if (await isBlockedEither(a, b, db)) {
    // Neutral wording: it doesn't reveal which side blocked.
    throw new HttpError(403, 'BLOCKED', "You can't interact with this member.");
  }
}

/** Ids the viewer must not see in lists (blocked by them, or blocking them). */
export async function blockedIds(viewerId: string | null): Promise<string[]> {
  if (!viewerId) return [];
  const rows = await prisma.userBlock.findMany({
    where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
    select: { blockerId: true, blockedId: true },
  });
  return rows.map((r) => (r.blockerId === viewerId ? r.blockedId : r.blockerId));
}

/**
 * Block: also removes follows both ways and ends pending or accepted connections, so nothing
 * keeps the two connected. Collaboration requests between them are cancelled by that module's hook.
 */
export async function block(blockerId: string, username: string) {
  const blockedId = await requireActiveUser(username);
  if (blockedId === blockerId) throw new HttpError(400, 'CANNOT_BLOCK_SELF', "You can't block yourself.");
  await prisma.$transaction(async (tx) => {
    await tx.userBlock.createMany({ data: [{ blockerId, blockedId }], skipDuplicates: true });
    await tx.follow.deleteMany({
      where: {
        OR: [
          { followerId: blockerId, followingId: blockedId },
          { followerId: blockedId, followingId: blockerId },
        ],
      },
    });
    await tx.connection.updateMany({
      where: {
        status: { in: ['PENDING', 'ACCEPTED'] },
        OR: [
          { requesterId: blockerId, addresseeId: blockedId },
          { requesterId: blockedId, addresseeId: blockerId },
        ],
      },
      data: { status: 'REMOVED' },
    });
    for (const hook of onBlockHooks) await hook(tx, blockerId, blockedId);
  });
  return { blocked: true };
}

export async function unblock(blockerId: string, username: string) {
  const blockedId = await requireActiveUser(username);
  await prisma.userBlock.deleteMany({ where: { blockerId, blockedId } });
  return { blocked: false };
}

export async function listBlocks(blockerId: string): Promise<PersonSummary[]> {
  const rows = await prisma.userBlock.findMany({
    where: { blockerId },
    orderBy: { createdAt: 'desc' },
    include: { blocked: { select: personSelect } },
  });
  return rows.map((r) => toPerson(r.blocked));
}

/** Other modules (collaboration, communities) register clean-up that runs in the block transaction. */
type BlockHook = (tx: Prisma.TransactionClient, blockerId: string, blockedId: string) => Promise<void>;
const onBlockHooks: BlockHook[] = [];
export function onBlock(hook: BlockHook) {
  onBlockHooks.push(hook);
}
