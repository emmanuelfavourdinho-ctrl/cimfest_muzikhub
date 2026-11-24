import {
  collabRequestViewSchema,
  collaborationViewSchema,
  type CollaborationStatus,
  type CreateCollabRequestInput,
} from '@muzikhub/shared';
import { z } from 'zod';
import { request } from './api';

export const collabKeys = {
  requests: (box: string) => ['collab', 'requests', box] as const,
  request: (id: string) => ['collab', 'request', id] as const,
  list: ['collab', 'list'] as const,
  one: (id: string) => ['collab', 'one', id] as const,
};
const enc = encodeURIComponent;

export const collabApi = {
  requests: (box: 'incoming' | 'sent') =>
    request('/collaborations/requests', z.object({ items: z.array(collabRequestViewSchema), nextCursor: z.string().nullable() }), {
      query: { box },
    }),
  create: (body: CreateCollabRequestInput, idempotencyKey: string) =>
    request('/collaborations/requests', collabRequestViewSchema, { method: 'POST', body, idempotencyKey }),
  request: (id: string) => request(`/collaborations/requests/${enc(id)}`, collabRequestViewSchema),
  act: (id: string, action: 'accept' | 'decline' | 'clarify' | 'answer' | 'cancel', text?: string) => {
    const key = action === 'clarify' ? 'question' : action === 'answer' ? 'answer' : 'note';
    return request(`/collaborations/requests/${enc(id)}/${action}`, collabRequestViewSchema, {
      method: 'POST',
      body: text ? { [key]: text } : {},
    });
  },
  list: () => request('/collaborations', z.object({ items: z.array(collaborationViewSchema) })),
  one: (id: string) => request(`/collaborations/${enc(id)}`, collaborationViewSchema),
  setStatus: (id: string, status: CollaborationStatus, note?: string) =>
    request(`/collaborations/${enc(id)}/status`, collaborationViewSchema, { method: 'POST', body: note ? { status, note } : { status } }),
  note: (id: string, body: string) =>
    request(`/collaborations/${enc(id)}/notes`, collaborationViewSchema, { method: 'POST', body: { body } }),
};
