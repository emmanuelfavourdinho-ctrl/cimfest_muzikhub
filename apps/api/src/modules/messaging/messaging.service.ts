import { UNANSWERED_MESSAGE_CAP, type ConversationView, type MessageView } from '@muzikhub/shared';
import type { Message, Prisma } from '../../generated/prisma/client.js';
import { isVisibleStatus, visibleUser } from '../../lib/account-status.js';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { emitToUser } from '../../lib/realtime.js';
import { notify } from '../notifications/notifications.service.js';
import { personSelect, toPerson } from '../profiles/people.js';
import { assertNotBlocked, isBlockedEither } from '../safety/blocks.service.js';

type Tx = Prisma.TransactionClient;

/**
 * Direct messaging. Invariants:
 *  - only participants can read or write a conversation (404 for anyone else: no probing);
 *  - a message is "sent" only once it is committed; the push happens after the commit;
 *  - a retried send with the same clientId returns the original message (no duplicates);
 *  - blocks, the recipient's message policy, account status and an anti-spam cap are checked
 *    on every send, not just when the conversation starts.
 */
export const directKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

export function toMessageView(m: Message, viewerId: string): MessageView {
  return {
    id: m.id,
    conversationId: m.conversationId,
    clientId: m.clientId,
    senderId: m.senderId,
    mine: m.senderId === viewerId,
    kind: m.kind,
    body: m.removedAt ? 'This message was removed by a moderator.' : m.body,
    removed: Boolean(m.removedAt),
    collaborationRequestId: m.collaborationRequestId,
    createdAt: m.createdAt.toISOString(),
  };
}

/** The conversation if the user participates, else 404. */
async function requireParticipant(conversationId: string, userId: string) {
  const c = await prisma.conversation.findFirst({
    where: { id: conversationId, participants: { some: { userId } } },
    include: { participants: { include: { user: { select: { id: true, status: true, ...personSelect } } } } },
  });
  if (!c) throw new HttpError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
  const me = c.participants.find((p) => p.userId === userId)!;
  const other = c.participants.find((p) => p.userId !== userId)!;
  return { c, me, other };
}

/** Whether `fromId` may start a conversation with `toId` under the recipient's message policy. */
async function policyAllows(fromId: string, toId: string) {
  const profile = await prisma.profile.findUnique({ where: { userId: toId }, select: { messagePolicy: true } });
  if (!profile || profile.messagePolicy === 'EVERYONE') return true;
  const [follows, connected] = await Promise.all([
    prisma.follow.count({ where: { followerId: toId, followingId: fromId } }),
    prisma.connection.count({
      where: {
        status: 'ACCEPTED',
        OR: [
          { requesterId: fromId, addresseeId: toId },
          { requesterId: toId, addresseeId: fromId },
        ],
      },
    }),
  ]);
  return follows + connected > 0;
}

/**
 * Anti-spam (MSG-004): until the other person has replied, someone who isn't connected to them
 * can send at most UNANSWERED_MESSAGE_CAP messages. Returns how many are left (null = no cap).
 */
async function unansweredAllowance(conversationId: string, senderId: string, recipientId: string): Promise<number | null> {
  const connected = await prisma.connection.count({
    where: {
      status: 'ACCEPTED',
      OR: [
        { requesterId: senderId, addresseeId: recipientId },
        { requesterId: recipientId, addresseeId: senderId },
      ],
    },
  });
  if (connected) return null;
  // Only typed messages count (collaboration cards are system messages).
  const replied = await prisma.message.count({ where: { conversationId, senderId: recipientId, kind: 'TEXT' } });
  if (replied) return null;
  const sent = await prisma.message.count({ where: { conversationId, senderId, kind: 'TEXT' } });
  return Math.max(0, UNANSWERED_MESSAGE_CAP - sent);
}

async function viewFor(conversationId: string, userId: string): Promise<ConversationView> {
  const { c, me, other } = await requireParticipant(conversationId, userId);
  const [last, unread, blocked, allowance] = await Promise.all([
    prisma.message.findFirst({ where: { conversationId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    prisma.message.count({ where: { conversationId, senderId: other.userId, ...(me.lastReadAt && { createdAt: { gt: me.lastReadAt } }) } }),
    isBlockedEither(userId, other.userId),
    unansweredAllowance(conversationId, userId, other.userId),
  ]);
  const inactive = !isVisibleStatus(other.user.status);
  return {
    id: c.id,
    other: { id: other.userId, ...toPerson(other.user) },
    lastMessage: last
      ? {
          body: last.removedAt ? 'Message removed' : last.body.slice(0, 140),
          mine: last.senderId === userId,
          createdAt: last.createdAt.toISOString(),
        }
      : null,
    lastMessageAt: c.lastMessageAt.toISOString(),
    unread,
    otherDeliveredAt: other.lastDeliveredAt?.toISOString() ?? null,
    otherReadAt: other.lastReadAt?.toISOString() ?? null,
    blocked,
    canSend: !blocked && !inactive && allowance !== 0,
    sendLimitNote:
      allowance === null
        ? null
        : allowance === 0
          ? `You can send more once ${other.user.name} replies.`
          : `Until ${other.user.name} replies you can send ${allowance} more ${allowance === 1 ? 'message' : 'messages'}.`,
  };
}

/** Your conversations, most recent first (MSG-002 ordering). */
export async function listConversations(userId: string, cursor?: string) {
  const rows = await prisma.conversation.findMany({
    where: { participants: { some: { userId } }, messages: { some: {} } },
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
    take: 31,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    select: { id: true },
  });
  const page = rows.slice(0, 30);
  return { items: await Promise.all(page.map((r) => viewFor(r.id, userId))), nextCursor: rows.length > 30 ? page.at(-1)!.id : null };
}

export const getConversation = viewFor;

/** Open the one direct conversation with someone (creating it if needed). */
export async function openConversation(userId: string, username: string): Promise<ConversationView> {
  const other = await prisma.user.findFirst({ where: { username: username.toLowerCase(), ...visibleUser }, select: { id: true } });
  if (!other) throw new HttpError(404, 'USER_NOT_FOUND', 'No member with that username.');
  if (other.id === userId) throw new HttpError(400, 'CANNOT_MESSAGE_SELF', "You can't message yourself.");
  await assertNotBlocked(userId, other.id);
  const key = directKey(userId, other.id);
  const existing = await prisma.conversation.findUnique({ where: { directKey: key }, select: { id: true } });
  if (existing) return viewFor(existing.id, userId);
  if (!(await policyAllows(userId, other.id))) {
    throw new HttpError(403, 'MESSAGES_RESTRICTED', 'This member only accepts messages from their connections and people they follow.');
  }
  const c = await ensureConversation(prisma, userId, other.id);
  return viewFor(c, userId);
}

/** Find or create the direct conversation for two users (race-safe via the unique key). */
export async function ensureConversation(db: Tx | typeof prisma, a: string, b: string): Promise<string> {
  const key = directKey(a, b);
  const c = await db.conversation.upsert({
    where: { directKey: key },
    create: { directKey: key, participants: { create: [{ userId: a }, { userId: b }] } },
    update: {},
    select: { id: true },
  });
  return c.id;
}

/** History, newest page by default; `before` pages back, `after` catches up after a reconnect. */
export async function listMessages(userId: string, conversationId: string, q: { before?: string; after?: string; limit: number }) {
  const { other } = await requireParticipant(conversationId, userId);
  const pivot = async (id: string) => {
    const m = await prisma.message.findFirst({ where: { id, conversationId }, select: { createdAt: true, id: true } });
    if (!m) throw new HttpError(400, 'BAD_CURSOR', 'Unknown message cursor');
    return m;
  };
  let rows: Message[];
  if (q.after) {
    const p = await pivot(q.after);
    rows = await prisma.message.findMany({
      where: { conversationId, OR: [{ createdAt: { gt: p.createdAt } }, { createdAt: p.createdAt, id: { gt: p.id } }] },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: q.limit,
    });
  } else {
    const p = q.before ? await pivot(q.before) : null;
    rows = (
      await prisma.message.findMany({
        where: { conversationId, ...(p && { OR: [{ createdAt: { lt: p.createdAt } }, { createdAt: p.createdAt, id: { lt: p.id } }] }) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit,
      })
    ).reverse();
  }
  // Fetching is delivery: everything the other person sent up to the newest fetched is delivered.
  const newestTheirs = [...rows].reverse().find((m) => m.senderId === other.userId);
  if (newestTheirs) await markDelivered(userId, conversationId, newestTheirs.id);
  return { items: rows.map((m) => toMessageView(m, userId)), hasMore: rows.length === q.limit };
}

export async function sendMessage(userId: string, conversationId: string, input: { clientId: string; body: string }) {
  // Idempotency first: a retry returns the original, whatever happened since.
  const dup = await prisma.message.findUnique({ where: { senderId_clientId: { senderId: userId, clientId: input.clientId } } });
  if (dup) {
    if (dup.conversationId !== conversationId) throw new HttpError(422, 'CLIENT_ID_REUSED', 'This message id was already used elsewhere.');
    return { message: toMessageView(dup, userId), replayed: true };
  }
  const { other } = await requireParticipant(conversationId, userId);
  await assertNotBlocked(userId, other.userId);
  if (!isVisibleStatus(other.user.status))
    throw new HttpError(409, 'RECIPIENT_UNAVAILABLE', 'This member can’t receive messages right now.');
  if ((await unansweredAllowance(conversationId, userId, other.userId)) === 0) {
    throw new HttpError(429, 'AWAITING_REPLY', 'Wait for a reply before sending more messages.');
  }
  const me = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  let message: Message;
  try {
    message = await prisma.$transaction(async (tx) => {
      const m = await tx.message.create({ data: { conversationId, senderId: userId, clientId: input.clientId, body: input.body } });
      await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: m.createdAt } });
      // Sending implies you've read everything before it.
      await tx.conversationParticipant.update({
        where: { conversationId_userId: { conversationId, userId } },
        data: { lastReadAt: m.createdAt },
      });
      const theirs = await tx.conversationParticipant.findUniqueOrThrow({
        where: { conversationId_userId: { conversationId, userId: other.userId } },
      });
      // One notification per unread streak, not per message.
      await notify(tx, other.userId, {
        type: 'message.new',
        title: `New message from ${me.name}`,
        body: input.body.slice(0, 120),
        link: `/messages/${conversationId}`,
        dedupeKey: `message:${conversationId}:${other.userId}:${theirs.lastReadAt?.getTime() ?? 0}`,
      });
      return m;
    });
  } catch (e) {
    // Two identical retries racing: the unique (sender, clientId) caught the second.
    const again = await prisma.message.findUnique({ where: { senderId_clientId: { senderId: userId, clientId: input.clientId } } });
    if (again) return { message: toMessageView(again, userId), replayed: true };
    throw e;
  }
  // Push only after the commit (the DB is the source of truth).
  emitToUser(other.userId, 'message:new', toMessageView(message, other.userId));
  emitToUser(userId, 'message:new', toMessageView(message, userId));
  return { message: toMessageView(message, userId), replayed: false };
}

/** System card in a conversation (used by collaboration requests), inside the caller's transaction. */
export async function postSystemMessage(tx: Tx, conversationId: string, senderId: string, body: string, collaborationRequestId: string) {
  const m = await tx.message.create({
    data: {
      conversationId,
      senderId,
      clientId: `collab-${collaborationRequestId}-${Date.now().toString(36)}`,
      kind: 'COLLABORATION',
      body,
      collaborationRequestId,
    },
  });
  await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: m.createdAt } });
  return m;
}

async function receiptTime(conversationId: string, upTo: string) {
  const m = await prisma.message.findFirst({ where: { id: upTo, conversationId }, select: { createdAt: true } });
  if (!m) throw new HttpError(400, 'BAD_CURSOR', 'Unknown message');
  return m.createdAt;
}

export async function markRead(userId: string, conversationId: string, upTo: string) {
  const { other } = await requireParticipant(conversationId, userId);
  const at = await receiptTime(conversationId, upTo);
  // Only ever moves forward (out-of-order receipts can't un-read anything).
  await prisma.conversationParticipant.updateMany({
    where: { conversationId, userId, OR: [{ lastReadAt: null }, { lastReadAt: { lt: at } }] },
    data: { lastReadAt: at },
  });
  await prisma.conversationParticipant.updateMany({
    where: { conversationId, userId, OR: [{ lastDeliveredAt: null }, { lastDeliveredAt: { lt: at } }] },
    data: { lastDeliveredAt: at },
  });
  emitToUser(other.userId, 'conversation:receipt', { conversationId, readAt: at.toISOString(), deliveredAt: at.toISOString() });
  emitToUser(userId, 'conversation:receipt', { conversationId, self: true });
  return { readAt: at.toISOString() };
}

export async function markDelivered(userId: string, conversationId: string, upTo: string) {
  const { other } = await requireParticipant(conversationId, userId);
  const at = await receiptTime(conversationId, upTo);
  const { count } = await prisma.conversationParticipant.updateMany({
    where: { conversationId, userId, OR: [{ lastDeliveredAt: null }, { lastDeliveredAt: { lt: at } }] },
    data: { lastDeliveredAt: at },
  });
  if (count) emitToUser(other.userId, 'conversation:receipt', { conversationId, deliveredAt: at.toISOString() });
  return { deliveredAt: at.toISOString() };
}

/** Conversations with unread messages (the nav badge), in one query. */
export async function unreadConversations(userId: string) {
  const [row] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS "n" FROM "conversation_participant" p
    WHERE p."userId" = ${userId} AND EXISTS (
      SELECT 1 FROM "message" m
      WHERE m."conversationId" = p."conversationId" AND m."senderId" <> ${userId}
        AND (p."lastReadAt" IS NULL OR m."createdAt" > p."lastReadAt"))`;
  return Number(row?.n ?? 0);
}

export async function setMessagePolicy(userId: string, policy: 'EVERYONE' | 'CONNECTIONS') {
  await prisma.profile.update({ where: { userId }, data: { messagePolicy: policy } });
  return { policy };
}
export async function getMessagePolicy(userId: string) {
  const p = await prisma.profile.findUniqueOrThrow({ where: { userId }, select: { messagePolicy: true } });
  return { policy: p.messagePolicy };
}
