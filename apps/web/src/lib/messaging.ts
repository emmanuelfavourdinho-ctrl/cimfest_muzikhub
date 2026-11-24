import { conversationViewSchema, messageViewSchema } from '@muzikhub/shared';
import { z } from 'zod';
import { request } from './api';

export const messagingKeys = {
  list: ['conversations'] as const,
  conversation: (id: string) => ['conversations', id] as const,
  messages: (id: string) => ['conversations', id, 'messages'] as const,
  unread: ['conversations', 'unread'] as const,
  policy: ['conversations', 'policy'] as const,
};
const enc = encodeURIComponent;

export const messagingApi = {
  list: () => request('/conversations', z.object({ items: z.array(conversationViewSchema), nextCursor: z.string().nullable() })),
  open: (username: string) => request('/conversations', conversationViewSchema, { method: 'POST', body: { username } }),
  conversation: (id: string) => request(`/conversations/${enc(id)}`, conversationViewSchema),
  messages: (id: string, q: { before?: string; after?: string; limit?: number } = {}) =>
    request(`/conversations/${enc(id)}/messages`, z.object({ items: z.array(messageViewSchema), hasMore: z.boolean() }), { query: q }),
  send: (id: string, clientId: string, body: string) =>
    request(`/conversations/${enc(id)}/messages`, messageViewSchema, { method: 'POST', body: { clientId, body } }),
  read: (id: string, upTo: string) => request(`/conversations/${enc(id)}/read`, null, { method: 'POST', body: { upTo } }),
  delivered: (id: string, upTo: string) => request(`/conversations/${enc(id)}/delivered`, null, { method: 'POST', body: { upTo } }),
  unread: () => request('/conversations/unread-count', z.object({ count: z.number() })),
  policy: () => request('/conversations/settings/policy', z.object({ policy: z.enum(['EVERYONE', 'CONNECTIONS']) })),
  setPolicy: (policy: 'EVERYONE' | 'CONNECTIONS') =>
    request('/conversations/settings/policy', z.object({ policy: z.enum(['EVERYONE', 'CONNECTIONS']) }), {
      method: 'PUT',
      body: { policy },
    }),
};

/** A random client message id (idempotency key for one send; reused on retry). */
export const newClientId = () => crypto.randomUUID().replaceAll('-', '');

/** Drafts survive reloads and flaky connections (FR-52); stored per conversation in this browser. */
export const drafts = {
  get(id: string) {
    try {
      return localStorage.getItem(`muzikhub:draft:${id}`) ?? '';
    } catch {
      return '';
    }
  },
  set(id: string, text: string) {
    try {
      if (text) localStorage.setItem(`muzikhub:draft:${id}`, text);
      else localStorage.removeItem(`muzikhub:draft:${id}`);
    } catch {
      // storage unavailable (private mode): drafts just aren't kept
    }
  },
};
