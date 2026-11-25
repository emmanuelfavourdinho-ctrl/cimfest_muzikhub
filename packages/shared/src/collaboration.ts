import { z } from 'zod';
import { normaliseHttpsUrl } from './links.js';
import { personSummarySchema } from './portfolio.js';

/** Collaboration (FR-23, COL-001–008): structured requests → a lightweight shared record. */
export const COLLABORATION_TYPES = {
  FEATURE: 'Feature / guest verse',
  PRODUCTION: 'Production',
  SONGWRITING: 'Songwriting',
  MIXING_MASTERING: 'Mixing and mastering',
  PERFORMANCE: 'Live performance',
  VIDEO: 'Music video',
  REMIX: 'Remix',
  OTHER: 'Something else',
} as const;
export type CollaborationType = keyof typeof COLLABORATION_TYPES;
export const COLLABORATION_TYPE_KEYS = Object.keys(COLLABORATION_TYPES) as [CollaborationType, ...CollaborationType[]];

export const REQUEST_STATUSES = ['PENDING', 'CLARIFICATION_REQUESTED', 'ACCEPTED', 'DECLINED', 'CANCELLED'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  PENDING: 'Waiting for a reply',
  CLARIFICATION_REQUESTED: 'Question asked',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  CANCELLED: 'Withdrawn',
};
export const COLLABORATION_STATUSES = ['ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const;
export type CollaborationStatus = (typeof COLLABORATION_STATUSES)[number];
export const COLLABORATION_STATUS_LABELS: Record<CollaborationStatus, string> = {
  ACTIVE: 'In progress',
  ON_HOLD: 'On hold',
  COMPLETED: 'Completed',
  CANCELLED: 'Closed',
};

/** Request lifecycle (who may do what, from which status). Pure; enforced server-side. */
export type RequestAction = 'accept' | 'decline' | 'clarify' | 'answer' | 'cancel';
export const REQUEST_TRANSITIONS: Record<RequestAction, { from: readonly RequestStatus[]; to: RequestStatus; by: 'sender' | 'recipient' }> =
  {
    accept: { from: ['PENDING', 'CLARIFICATION_REQUESTED'], to: 'ACCEPTED', by: 'recipient' },
    decline: { from: ['PENDING', 'CLARIFICATION_REQUESTED'], to: 'DECLINED', by: 'recipient' },
    clarify: { from: ['PENDING'], to: 'CLARIFICATION_REQUESTED', by: 'recipient' },
    answer: { from: ['CLARIFICATION_REQUESTED'], to: 'PENDING', by: 'sender' },
    cancel: { from: ['PENDING', 'CLARIFICATION_REQUESTED'], to: 'CANCELLED', by: 'sender' },
  };
export function canRequestAction(action: RequestAction, status: RequestStatus, actor: 'sender' | 'recipient') {
  const t = REQUEST_TRANSITIONS[action];
  return t.by === actor && t.from.includes(status);
}
/** Collaboration status changes either participant may make; COMPLETED and CANCELLED are final. */
export const COLLABORATION_TRANSITIONS: Record<CollaborationStatus, readonly CollaborationStatus[]> = {
  ACTIVE: ['ON_HOLD', 'COMPLETED', 'CANCELLED'],
  ON_HOLD: ['ACTIVE', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

/** Requests one member may send per day (anti-spam). */
export const DAILY_COLLAB_REQUESTS = 10;

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .transform((v, ctx) => {
    const u = normaliseHttpsUrl(v);
    if (!u) {
      ctx.addIssue({ code: 'custom', message: 'Use full https:// links' });
      return z.NEVER;
    }
    return u;
  });

export const createCollabRequestSchema = z.strictObject({
  username: z.string().trim().toLowerCase().min(1).max(40),
  type: z.enum(COLLABORATION_TYPE_KEYS),
  title: z.string().trim().min(3, 'Give it a title').max(120),
  description: z.string().trim().min(20, 'Describe the project in at least 20 characters').max(3000),
  role: z.string().trim().min(2, 'Say what you’d like them to do').max(80),
  references: z.array(httpsUrl).max(5, 'Up to 5 links').default([]),
  deadline: z.iso.datetime().nullable().optional(),
});
export type CreateCollabRequestInput = z.input<typeof createCollabRequestSchema>;
export const clarifySchema = z.strictObject({ question: z.string().trim().min(5, 'Ask a question').max(1000) });
export const answerSchema = z.strictObject({ answer: z.string().trim().min(2, 'Write an answer').max(2000) });
export const respondSchema = z.strictObject({ note: z.string().trim().max(1000).optional() });
export const collaborationStatusSchema = z.strictObject({
  status: z.enum(COLLABORATION_STATUSES),
  note: z.string().trim().max(1000).optional(),
});
export const collaborationNoteSchema = z.strictObject({ body: z.string().trim().min(1).max(2000) });
export const requestBoxQuerySchema = z.object({
  box: z.enum(['incoming', 'sent']).default('incoming'),
  cursor: z.string().max(64).optional(),
});

export const collabRequestViewSchema = z.object({
  id: z.string(),
  direction: z.enum(['incoming', 'sent']),
  sender: personSummarySchema,
  recipient: personSummarySchema,
  type: z.enum(COLLABORATION_TYPE_KEYS),
  title: z.string(),
  description: z.string(),
  role: z.string(),
  references: z.array(z.string()),
  deadline: z.string().nullable(),
  status: z.enum(REQUEST_STATUSES),
  clarificationQuestion: z.string().nullable(),
  clarificationAnswer: z.string().nullable(),
  responseNote: z.string().nullable(),
  conversationId: z.string().nullable(),
  collaborationId: z.string().nullable(),
  actions: z.array(z.enum(['accept', 'decline', 'clarify', 'answer', 'cancel'])),
  createdAt: z.string(),
  respondedAt: z.string().nullable(),
});
export type CollabRequestView = z.infer<typeof collabRequestViewSchema>;

export const collaborationViewSchema = z.object({
  id: z.string(),
  requestId: z.string(),
  title: z.string(),
  summary: z.string(),
  type: z.enum(COLLABORATION_TYPE_KEYS),
  status: z.enum(COLLABORATION_STATUSES),
  dueAt: z.string().nullable(),
  conversationId: z.string().nullable(),
  startedAt: z.string(),
  closedAt: z.string().nullable(),
  participants: z.array(personSummarySchema.extend({ role: z.string() })),
  nextStatuses: z.array(z.enum(COLLABORATION_STATUSES)),
  updates: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['STATUS', 'NOTE']),
      status: z.enum(COLLABORATION_STATUSES).nullable(),
      body: z.string(),
      author: personSummarySchema,
      createdAt: z.string(),
    }),
  ),
});
export type CollaborationView = z.infer<typeof collaborationViewSchema>;
