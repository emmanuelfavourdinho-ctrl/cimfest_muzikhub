import {
  canRequestAction,
  COLLABORATION_STATUS_LABELS,
  COLLABORATION_TRANSITIONS,
  COLLABORATION_TYPES,
  DAILY_COLLAB_REQUESTS,
  REQUEST_TRANSITIONS,
  type CollabRequestView,
  type CollaborationStatus,
  type CollaborationView,
  type RequestAction,
} from '@muzikhub/shared';
import type { z } from 'zod';
import type { createCollabRequestSchema } from '@muzikhub/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { isVisibleStatus, visibleUser } from '../../lib/account-status.js';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { emitToUser } from '../../lib/realtime.js';
import { ensureConversation, postSystemMessage, toMessageView } from '../messaging/messaging.service.js';
import { notify } from '../notifications/notifications.service.js';
import { personSelect, toPerson } from '../profiles/people.js';
import { assertNotBlocked, onBlock } from '../safety/blocks.service.js';

type Tx = Prisma.TransactionClient;

/**
 * Collaboration (COL-001–008, UJ-06). A request is answered with accept / decline / a clarifying
 * question; the conversation between the two carries the discussion (a card per step, linking back
 * here), so there is one messaging system, not two. Accepting creates the shared record.
 * Every transition is checked against REQUEST_TRANSITIONS on the server.
 */
const requestInclude = {
  sender: { select: { id: true, ...personSelect } },
  recipient: { select: { id: true, ...personSelect } },
  collaboration: { select: { id: true } },
} satisfies Prisma.CollaborationRequestInclude;
type RequestRow = Prisma.CollaborationRequestGetPayload<{ include: typeof requestInclude }>;

function toRequestView(r: RequestRow, viewerId: string): CollabRequestView {
  const side = r.senderId === viewerId ? 'sender' : 'recipient';
  return {
    id: r.id,
    direction: side === 'sender' ? 'sent' : 'incoming',
    sender: toPerson(r.sender),
    recipient: toPerson(r.recipient),
    type: r.type,
    title: r.title,
    description: r.description,
    role: r.role,
    references: r.references,
    deadline: r.deadline?.toISOString() ?? null,
    status: r.status,
    clarificationQuestion: r.clarificationQuestion,
    clarificationAnswer: r.clarificationAnswer,
    responseNote: r.responseNote,
    conversationId: r.conversationId,
    collaborationId: r.collaboration?.id ?? null,
    actions: (Object.keys(REQUEST_TRANSITIONS) as RequestAction[]).filter((a) => canRequestAction(a, r.status, side)),
    createdAt: r.createdAt.toISOString(),
    respondedAt: r.respondedAt?.toISOString() ?? null,
  };
}

/** The request if the viewer is its sender or recipient, else 404 (no probing). */
async function requireRequest(id: string, viewerId: string, db: Tx | typeof prisma = prisma) {
  const r = await db.collaborationRequest.findFirst({
    where: { id, OR: [{ senderId: viewerId }, { recipientId: viewerId }] },
    include: requestInclude,
  });
  if (!r) throw new HttpError(404, 'REQUEST_NOT_FOUND', 'Collaboration request not found');
  return r;
}

/** A card in the pair's conversation, pushed to both after the transaction commits. */
async function card(tx: Tx, conversationId: string, senderId: string, body: string, requestId: string) {
  return postSystemMessage(tx, conversationId, senderId, body, requestId);
}
function pushCard(m: Awaited<ReturnType<typeof card>>, a: string, b: string) {
  emitToUser(a, 'message:new', toMessageView(m, a));
  emitToUser(b, 'message:new', toMessageView(m, b));
}

export async function createRequest(senderId: string, input: z.output<typeof createCollabRequestSchema>) {
  const recipient = await prisma.user.findFirst({ where: { username: input.username, ...visibleUser }, select: { id: true, name: true } });
  if (!recipient) throw new HttpError(404, 'USER_NOT_FOUND', 'No member with that username.');
  if (recipient.id === senderId) throw new HttpError(400, 'CANNOT_REQUEST_SELF', "You can't send yourself a collaboration request.");
  await assertNotBlocked(senderId, recipient.id);
  if (input.deadline && new Date(input.deadline) <= new Date())
    throw new HttpError(400, 'VALIDATION_ERROR', 'The deadline must be in the future.');
  const since = new Date(Date.now() - 86_400_000);
  if ((await prisma.collaborationRequest.count({ where: { senderId, createdAt: { gte: since } } })) >= DAILY_COLLAB_REQUESTS) {
    throw new HttpError(429, 'TOO_MANY_REQUESTS', `You can send up to ${DAILY_COLLAB_REQUESTS} collaboration requests a day.`);
  }
  const me = await prisma.user.findUniqueOrThrow({ where: { id: senderId }, select: { name: true } });
  let posted;
  let id: string;
  try {
    ({ id, posted } = await prisma.$transaction(async (tx) => {
      const conversationId = await ensureConversation(tx, senderId, recipient.id);
      const r = await tx.collaborationRequest.create({
        data: {
          senderId,
          recipientId: recipient.id,
          type: input.type,
          title: input.title,
          description: input.description,
          role: input.role,
          references: input.references,
          deadline: input.deadline ? new Date(input.deadline) : null,
          conversationId,
        },
      });
      const posted = await card(
        tx,
        conversationId,
        senderId,
        `${me.name} sent a collaboration request: “${input.title}” — ${input.role} (${COLLABORATION_TYPES[input.type]}).`,
        r.id,
      );
      await notify(tx, recipient.id, {
        type: 'collaboration.request',
        title: `${me.name} wants to collaborate`,
        body: `“${input.title}” — they’d like you for: ${input.role}`,
        link: `/collaborate/requests/${r.id}`,
      });
      return { id: r.id, posted };
    }));
  } catch (e) {
    // COL-004: the partial unique index allows one open request per sender → recipient.
    if ((e as { code?: string }).code === 'P2002')
      throw new HttpError(409, 'REQUEST_ALREADY_OPEN', 'You already have an open request with this member.');
    throw e;
  }
  pushCard(posted, senderId, recipient.id);
  return toRequestView(await requireRequest(id, senderId), senderId);
}

export async function listRequests(userId: string, box: 'incoming' | 'sent', cursor?: string) {
  const rows = await prisma.collaborationRequest.findMany({
    where: box === 'incoming' ? { recipientId: userId, sender: visibleUser } : { senderId: userId, recipient: visibleUser },
    include: requestInclude,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 21,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  });
  const page = rows.slice(0, 20);
  return { items: page.map((r) => toRequestView(r, userId)), nextCursor: rows.length > 20 ? page.at(-1)!.id : null };
}

export async function getRequest(userId: string, id: string) {
  return toRequestView(await requireRequest(id, userId), userId);
}

/** accept / decline / clarify / answer / cancel — checked against the lifecycle on the server. */
export async function actOnRequest(userId: string, id: string, action: RequestAction, text?: string) {
  const r = await requireRequest(id, userId);
  const side = r.senderId === userId ? 'sender' : 'recipient';
  if (!canRequestAction(action, r.status, side)) {
    throw new HttpError(
      409,
      'INVALID_TRANSITION',
      `You can't ${action} this request now (it is ${r.status.toLowerCase().replaceAll('_', ' ')}).`,
    );
  }
  await assertNotBlocked(r.senderId, r.recipientId);
  const other = side === 'sender' ? r.recipientId : r.senderId;
  const otherUser = await prisma.user.findUnique({ where: { id: other }, select: { status: true } });
  if (action !== 'cancel' && action !== 'decline' && !isVisibleStatus(otherUser?.status)) {
    throw new HttpError(409, 'MEMBER_UNAVAILABLE', 'This member’s account isn’t active right now.');
  }
  const actorName = side === 'sender' ? r.sender.name : r.recipient.name;
  const to = REQUEST_TRANSITIONS[action].to;
  const link = `/collaborate/requests/${r.id}`;
  const { posted } = await prisma.$transaction(async (tx) => {
    // Compare-and-set on the status: a double click or a race can't apply twice.
    const { count } = await tx.collaborationRequest.updateMany({
      where: { id, status: r.status },
      data: {
        status: to,
        ...(action === 'clarify' && { clarificationQuestion: text ?? null, clarificationAnswer: null }),
        ...(action === 'answer' && { clarificationAnswer: text ?? null }),
        ...((action === 'accept' || action === 'decline') && { responseNote: text ?? null, respondedAt: new Date() }),
      },
    });
    if (count !== 1) throw new HttpError(409, 'INVALID_TRANSITION', 'This request has just changed. Reload it.');
    const conversationId = r.conversationId ?? (await ensureConversation(tx, r.senderId, r.recipientId));
    let body: string;
    let collaborationId: string | null = null;
    switch (action) {
      case 'accept': {
        const c = await tx.collaboration.create({
          data: {
            requestId: r.id,
            title: r.title,
            summary: r.description,
            type: r.type,
            dueAt: r.deadline,
            conversationId,
            participants: {
              create: [
                { userId: r.senderId, role: 'Started the project' },
                { userId: r.recipientId, role: r.role },
              ],
            },
            updates: {
              create: {
                authorId: userId,
                kind: 'STATUS',
                status: 'ACTIVE',
                body: text ? `Accepted: ${text}` : 'Accepted the request. The collaboration has started.',
              },
            },
          },
        });
        collaborationId = c.id;
        body = `${actorName} accepted “${r.title}”. The collaboration has started.`;
        await notify(tx, other, {
          type: 'collaboration.accepted',
          title: `${actorName} accepted your collaboration request`,
          body: `“${r.title}” is now an active collaboration.`,
          link: `/collaborate/${c.id}`,
        });
        break;
      }
      case 'decline':
        body = `${actorName} declined “${r.title}”.${text ? ` Note: ${text}` : ''}`;
        await notify(tx, other, {
          type: 'collaboration.declined',
          title: `${actorName} declined your collaboration request`,
          body: text ? `“${r.title}”: ${text}` : `“${r.title}”`,
          link,
        });
        break;
      case 'clarify':
        body = `${actorName} asked about “${r.title}”: ${text}`;
        await notify(tx, other, {
          type: 'collaboration.clarification',
          title: `${actorName} has a question about your request`,
          body: text?.slice(0, 140) ?? '',
          link,
        });
        break;
      case 'answer':
        body = `${actorName} answered: ${text}`;
        await notify(tx, other, {
          type: 'collaboration.answered',
          title: `${actorName} answered your question`,
          body: `“${r.title}”`,
          link,
        });
        break;
      case 'cancel':
        body = `${actorName} withdrew “${r.title}”.`;
        await notify(tx, other, {
          type: 'collaboration.cancelled',
          title: `${actorName} withdrew a collaboration request`,
          body: `“${r.title}”`,
          link,
        });
        break;
    }
    const posted = await card(tx, conversationId, userId, body, r.id);
    return { posted, collaborationId };
  });
  pushCard(posted, r.senderId, r.recipientId);
  return toRequestView(await requireRequest(id, userId), userId);
}

// ── Accepted collaborations ──────────────────────────────────

const collabInclude = {
  participants: { include: { user: { select: { id: true, ...personSelect } } } },
  updates: { orderBy: { createdAt: 'desc' as const }, take: 50, include: { author: { select: personSelect } } },
} satisfies Prisma.CollaborationInclude;
type CollabRow = Prisma.CollaborationGetPayload<{ include: typeof collabInclude }>;

function toCollabView(c: CollabRow): CollaborationView {
  return {
    id: c.id,
    requestId: c.requestId,
    title: c.title,
    summary: c.summary,
    type: c.type,
    status: c.status,
    dueAt: c.dueAt?.toISOString() ?? null,
    conversationId: c.conversationId,
    startedAt: c.startedAt.toISOString(),
    closedAt: c.closedAt?.toISOString() ?? null,
    participants: c.participants.map((p) => ({ ...toPerson(p.user), role: p.role })),
    nextStatuses: [...COLLABORATION_TRANSITIONS[c.status]],
    updates: c.updates.map((u) => ({
      id: u.id,
      kind: u.kind,
      status: u.status,
      body: u.body,
      author: toPerson(u.author),
      createdAt: u.createdAt.toISOString(),
    })),
  };
}

async function requireCollaboration(id: string, userId: string) {
  const c = await prisma.collaboration.findFirst({ where: { id, participants: { some: { userId } } }, include: collabInclude });
  if (!c) throw new HttpError(404, 'COLLABORATION_NOT_FOUND', 'Collaboration not found');
  return c;
}

export async function listCollaborations(userId: string) {
  const rows = await prisma.collaboration.findMany({
    where: { participants: { some: { userId } } },
    include: collabInclude,
    orderBy: [{ updatedAt: 'desc' }],
    take: 50,
  });
  return { items: rows.map(toCollabView) };
}

export async function getCollaboration(userId: string, id: string) {
  return toCollabView(await requireCollaboration(id, userId));
}

/** COL-006: either participant updates the agreed status; COMPLETED and CANCELLED close it. */
export async function setCollaborationStatus(userId: string, id: string, status: CollaborationStatus, note?: string) {
  const c = await requireCollaboration(id, userId);
  if (!COLLABORATION_TRANSITIONS[c.status].includes(status)) {
    throw new HttpError(
      409,
      'INVALID_TRANSITION',
      `A collaboration that is ${COLLABORATION_STATUS_LABELS[c.status].toLowerCase()} can't become ${COLLABORATION_STATUS_LABELS[status].toLowerCase()}.`,
    );
  }
  const me = c.participants.find((p) => p.userId === userId)!.user;
  const others = c.participants.filter((p) => p.userId !== userId).map((p) => p.userId);
  const closing = status === 'COMPLETED' || status === 'CANCELLED';
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.collaboration.updateMany({
      where: { id, status: c.status },
      data: { status, closedAt: closing ? new Date() : null },
    });
    if (count !== 1) throw new HttpError(409, 'INVALID_TRANSITION', 'This collaboration has just changed. Reload it.');
    await tx.collaborationUpdate.create({
      data: {
        collaborationId: id,
        authorId: userId,
        kind: 'STATUS',
        status,
        body: note || `Marked as ${COLLABORATION_STATUS_LABELS[status].toLowerCase()}.`,
      },
    });
    for (const o of others) {
      await notify(tx, o, {
        type: 'collaboration.status',
        title: `“${c.title}” is now ${COLLABORATION_STATUS_LABELS[status].toLowerCase()}`,
        body: note ? `${me.name}: ${note}` : `Updated by ${me.name}.`,
        link: `/collaborate/${id}`,
      });
    }
  });
  return getCollaboration(userId, id);
}

/** A short progress note visible to the participants (not notified, to avoid noise). */
export async function addNote(userId: string, id: string, body: string) {
  const c = await requireCollaboration(id, userId);
  if (c.status === 'COMPLETED' || c.status === 'CANCELLED') throw new HttpError(409, 'CLOSED', 'This collaboration is closed.');
  await prisma.collaborationUpdate.create({ data: { collaborationId: id, authorId: userId, kind: 'NOTE', body } });
  await prisma.collaboration.update({ where: { id }, data: { updatedAt: new Date() } });
  return getCollaboration(userId, id);
}

/** Blocking someone withdraws/declines open requests between the two. */
let hooked = false;
export function registerCollaborationHooks() {
  if (hooked) return;
  hooked = true;
  onBlock(async (tx, a, b) => {
    await tx.collaborationRequest.updateMany({
      where: {
        status: { in: ['PENDING', 'CLARIFICATION_REQUESTED'] },
        OR: [
          { senderId: a, recipientId: b },
          { senderId: b, recipientId: a },
        ],
      },
      data: { status: 'CANCELLED' },
    });
  });
}
