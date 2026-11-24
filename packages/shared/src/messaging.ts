import { z } from 'zod';
import { personSummarySchema } from './portfolio.js';

/** Direct messaging (FR-47–54, MSG-001–007). */
export const MESSAGE_MAX = 4000;
/** Anti-spam: messages you can send before someone who isn't connected to you has replied. */
export const UNANSWERED_MESSAGE_CAP = 3;

export const MESSAGE_POLICIES = {
  EVERYONE: 'Anyone on MuzikHub',
  CONNECTIONS: 'Only my connections and people I follow',
} as const;
export type MessagePolicy = keyof typeof MESSAGE_POLICIES;

export const clientIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid client id');
export const startConversationSchema = z.strictObject({ username: z.string().trim().toLowerCase().min(1).max(40) });
export const sendMessageSchema = z.strictObject({
  clientId: clientIdSchema,
  body: z.string().trim().min(1, 'Write something first').max(MESSAGE_MAX, `Messages can be up to ${MESSAGE_MAX} characters`),
});
export const messageReceiptSchema = z.strictObject({ upTo: z.string().min(1).max(64) });
export const messagesQuerySchema = z.object({
  before: z.string().max(64).optional(),
  after: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
export const messagePolicySchema = z.strictObject({ policy: z.enum(['EVERYONE', 'CONNECTIONS']) });

export const messageViewSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  clientId: z.string(),
  senderId: z.string(),
  mine: z.boolean(),
  kind: z.enum(['TEXT', 'COLLABORATION']),
  body: z.string(),
  removed: z.boolean(),
  collaborationRequestId: z.string().nullable(),
  createdAt: z.string(),
});
export type MessageView = z.infer<typeof messageViewSchema>;

export const conversationViewSchema = z.object({
  id: z.string(),
  other: personSummarySchema.extend({ id: z.string() }),
  lastMessage: z.object({ body: z.string(), mine: z.boolean(), createdAt: z.string() }).nullable(),
  lastMessageAt: z.string(),
  unread: z.number().int(),
  /** Their receipts for your messages: everything up to these times was delivered / read. */
  otherDeliveredAt: z.string().nullable(),
  otherReadAt: z.string().nullable(),
  /** Either of you blocked the other: sending is disabled. */
  blocked: z.boolean(),
  /** You can't send more until they reply (anti-spam), with how many are left. */
  canSend: z.boolean(),
  sendLimitNote: z.string().nullable(),
});
export type ConversationView = z.infer<typeof conversationViewSchema>;
