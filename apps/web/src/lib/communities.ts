import {
  communityCardSchema,
  communityDetailSchema,
  discussionCommentViewSchema,
  discussionViewSchema,
  memberViewSchema,
  pageSchema,
  type CreateCommunityInput,
  type DiscussionKind,
} from '@muzikhub/shared';
import { z } from 'zod';
import { request } from './api';

export const communityKeys = {
  all: ['communities'] as const,
  list: (q: Record<string, string | undefined>) => ['communities', 'list', q] as const,
  mine: ['communities', 'mine'] as const,
  featured: ['communities', 'featured'] as const,
  detail: (slug: string) => ['communities', 'detail', slug] as const,
  discussions: (slug: string, kind?: string) => ['communities', 'discussions', slug, kind ?? 'all'] as const,
  members: (slug: string, status: string) => ['communities', 'members', slug, status] as const,
  discussion: (id: string) => ['discussion', id] as const,
  comments: (id: string) => ['discussion', id, 'comments'] as const,
};

const enc = encodeURIComponent;
const ok = z.object({}).passthrough();

export const communitiesApi = {
  list: (query: { q?: string; category?: string; cursor?: string }) => request('/communities', pageSchema(communityCardSchema), { query }),
  featured: () => request('/communities/featured', z.object({ items: z.array(communityCardSchema) })),
  mine: () => request('/communities/mine', z.object({ items: z.array(communityCardSchema), recent: z.array(discussionViewSchema) })),
  detail: (slug: string) => request(`/communities/${enc(slug)}`, communityDetailSchema),
  create: (body: CreateCommunityInput) => request('/communities', communityDetailSchema, { method: 'POST', body }),
  update: (slug: string, body: Partial<CreateCommunityInput>) =>
    request(`/communities/${enc(slug)}`, communityDetailSchema, { method: 'PATCH', body }),
  close: (slug: string) => request(`/communities/${enc(slug)}`, ok, { method: 'DELETE' }),
  join: (slug: string, note?: string) =>
    request(`/communities/${enc(slug)}/join`, communityDetailSchema, { method: 'POST', body: note ? { note } : {} }),
  leave: (slug: string) => request(`/communities/${enc(slug)}/leave`, communityDetailSchema, { method: 'POST' }),
  acceptInvite: (slug: string) => request(`/communities/${enc(slug)}/invitation/accept`, communityDetailSchema, { method: 'POST' }),
  declineInvite: (slug: string) => request(`/communities/${enc(slug)}/invitation/decline`, ok, { method: 'POST' }),
  invite: (slug: string, username: string) => request(`/communities/${enc(slug)}/invitations`, ok, { method: 'POST', body: { username } }),
  members: (slug: string, status: string, cursor?: string) =>
    request(`/communities/${enc(slug)}/members`, pageSchema(memberViewSchema), { query: { status, cursor } }),
  memberAction: (slug: string, username: string, action: 'approve' | 'decline' | 'ban' | 'unban' | 'owner', reason?: string) =>
    request(`/communities/${enc(slug)}/members/${enc(username)}/${action}`, ok, { method: 'POST', body: reason ? { reason } : {} }),
  setRole: (slug: string, username: string, role: 'ADMIN' | 'MODERATOR' | 'MEMBER') =>
    request(`/communities/${enc(slug)}/members/${enc(username)}/role`, ok, { method: 'PUT', body: { role } }),
  discussions: (slug: string, kind?: string, cursor?: string) =>
    request(`/communities/${enc(slug)}/discussions`, pageSchema(discussionViewSchema), { query: { kind, cursor } }),
  createDiscussion: (slug: string, body: { kind: DiscussionKind; title: string; body: string }) =>
    request(`/communities/${enc(slug)}/discussions`, discussionViewSchema, { method: 'POST', body }),
  discussion: (id: string) => request(`/discussions/${enc(id)}`, discussionViewSchema),
  updateDiscussion: (id: string, body: { title?: string; body?: string }) =>
    request(`/discussions/${enc(id)}`, discussionViewSchema, { method: 'PATCH', body }),
  deleteDiscussion: (id: string) => request(`/discussions/${enc(id)}`, ok, { method: 'DELETE' }),
  moderate: (id: string, action: 'pin' | 'unpin' | 'lock' | 'unlock') =>
    request(`/discussions/${enc(id)}/${action}`, discussionViewSchema, { method: 'POST' }),
  removeDiscussion: (id: string, reason: string) => request(`/discussions/${enc(id)}/remove`, ok, { method: 'POST', body: { reason } }),
  helpful: (id: string, on: boolean) => request(`/discussions/${enc(id)}/helpful`, discussionViewSchema, { method: on ? 'PUT' : 'DELETE' }),
  follow: (id: string, on: boolean) => request(`/discussions/${enc(id)}/follow`, discussionViewSchema, { method: on ? 'PUT' : 'DELETE' }),
  answer: (id: string, commentId: string | null) =>
    request(`/discussions/${enc(id)}/answer`, discussionViewSchema, { method: 'POST', body: { commentId } }),
  comments: (id: string, cursor?: string) =>
    request(`/discussions/${enc(id)}/comments`, pageSchema(discussionCommentViewSchema), { query: { cursor } }),
  addComment: (id: string, body: string, parentId?: string) =>
    request(`/discussions/${enc(id)}/comments`, discussionCommentViewSchema, {
      method: 'POST',
      body: parentId ? { body, parentId } : { body },
    }),
  updateComment: (id: string, body: string) =>
    request(`/community-comments/${enc(id)}`, discussionCommentViewSchema, { method: 'PATCH', body: { body } }),
  deleteComment: (id: string) => request(`/community-comments/${enc(id)}`, ok, { method: 'DELETE' }),
  removeComment: (id: string, reason: string) => request(`/community-comments/${enc(id)}/remove`, ok, { method: 'POST', body: { reason } }),
};
