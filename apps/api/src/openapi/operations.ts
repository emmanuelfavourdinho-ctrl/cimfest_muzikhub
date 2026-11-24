import type { z } from 'zod';
import {
  applicationDecisionSchema,
  applySchema,
  assignReportSchema,
  createOpportunitySchema,
  grantOrganiserSchema,
  changePriceSchema,
  startCheckoutSchema,
  blockSchema,
  startConversationSchema,
  sendMessageSchema,
  messageReceiptSchema,
  messagePolicySchema,
  createCommunitySchema,
  updateCommunitySchema,
  joinCommunitySchema,
  inviteSchema,
  memberActionSchema,
  memberRoleSchema,
  createDiscussionSchema,
  updateDiscussionSchema,
  moderationReasonSchema,
  createDiscussionCommentSchema,
  updateDiscussionCommentSchema,
  updateNotificationSettingsSchema,
  setAvailabilitySchema,
  updateOpportunitySchema,
  createCommentSchema,
  createConnectionSchema,
  createPortfolioSchema,
  createPostSchema,
  createReportSchema,
  createUploadSchema,
  moderationActionSchema,
  publishPortfolioSchema,
  reasonOnlySchema,
  replaceLinksSchema,
  reportNoteSchema,
  resolveReportSchema,
  setAccountStatusSchema,
  setProfileImageSchema,
  setRoleSchema,
  updatePortfolioSchema,
  updatePostSchema,
  updateProfileSchema,
} from '@muzikhub/shared';

/**
 * Every /api/v1 operation (OpenAPI skeleton, M0). The drift test compares this list with the
 * real route table (route-scan.ts), so adding a route without documenting it fails CI.
 * Response schemas and query parameters are filled in milestone by milestone.
 *
 * auth: public (no session) · optional (works signed out, personalised when signed in) ·
 *       member (session required) · staff (moderator/admin with 2FA, server-checked)
 */
export type Auth = 'public' | 'optional' | 'member' | 'staff';
export type Operation = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  tag: string;
  summary: string;
  auth: Auth;
  body?: z.ZodType;
  /** Accepts Idempotency-Key (ADR 0003). */
  idempotent?: boolean;
  /** Rate-limited endpoint class (lib/rate-limit.ts). */
  rateLimit?: string;
};

const op = (
  method: Operation['method'],
  path: string,
  tag: string,
  summary: string,
  auth: Auth,
  extra: Partial<Operation> = {},
): Operation => ({
  method,
  path: `/api/v1${path}`,
  tag,
  summary,
  auth,
  ...extra,
});

export const operations: Operation[] = [
  op('GET', '/health', 'System', 'Service and database health', 'public'),
  op('GET', '/openapi.json', 'System', 'This OpenAPI document', 'public'),

  op('GET', '/me', 'Me', 'The signed-in user, profile and links', 'member'),
  op('PATCH', '/me/profile', 'Me', 'Update profile fields (onboarding and settings)', 'member', { body: updateProfileSchema }),
  op('PUT', '/me/profile/links', 'Me', 'Replace external profile links', 'member', { body: replaceLinksSchema }),
  op('PUT', '/me/profile/avatar', 'Me', 'Set or clear the profile photo', 'member', { body: setProfileImageSchema }),
  op('PUT', '/me/profile/cover', 'Me', 'Set or clear the cover image', 'member', { body: setProfileImageSchema }),
  op('POST', '/me/onboarding/complete', 'Me', 'Mark onboarding finished', 'member'),
  op('GET', '/me/portfolio', 'Portfolio', "The signed-in user's portfolio, drafts included", 'member'),

  op('GET', '/profiles/{username}', 'Profiles', 'Counts a profile view for the owner’s analytics. Public profile', 'optional'),
  op('GET', '/profiles/{username}/portfolio', 'Portfolio', "A profile's published portfolio", 'optional'),
  op('GET', '/profiles/{username}/posts', 'Feed', "A profile's posts", 'optional'),

  op('GET', '/portfolio/{id}', 'Portfolio', 'A portfolio item (owner sees drafts and moderation notes)', 'optional'),
  op('POST', '/portfolio', 'Portfolio', 'Create a portfolio item (draft)', 'member', {
    body: createPortfolioSchema,
    rateLimit: 'content-write',
  }),
  op('PATCH', '/portfolio/{id}', 'Portfolio', 'Edit a portfolio item', 'member', {
    body: updatePortfolioSchema,
    rateLimit: 'content-write',
  }),
  op('POST', '/portfolio/{id}/publish', 'Portfolio', 'Publish (optionally share to feed)', 'member', {
    body: publishPortfolioSchema,
    rateLimit: 'content-write',
  }),
  op('POST', '/portfolio/{id}/archive', 'Portfolio', 'Archive a portfolio item', 'member'),
  op('DELETE', '/portfolio/{id}', 'Portfolio', 'Delete a portfolio item', 'member'),

  op('POST', '/media/uploads', 'Media', 'Start a signed direct upload to the media store', 'member', {
    body: createUploadSchema,
    rateLimit: 'upload',
  }),
  op('POST', '/media/{id}/confirm', 'Media', 'Confirm an upload (server re-checks type, size, duration)', 'member'),
  op('DELETE', '/media/{id}', 'Media', 'Delete an unattached upload', 'member'),

  op('GET', '/feed', 'Feed', 'Discover or Following feed (cursor-paginated)', 'optional'),
  op('POST', '/posts', 'Feed', 'Create a post', 'member', { body: createPostSchema, idempotent: true, rateLimit: 'content-write' }),
  op('GET', '/posts/{id}', 'Feed', 'A post', 'optional'),
  op('PATCH', '/posts/{id}', 'Feed', 'Edit your post', 'member', { body: updatePostSchema, rateLimit: 'content-write' }),
  op('DELETE', '/posts/{id}', 'Feed', 'Delete your post', 'member'),
  op('PUT', '/posts/{id}/like', 'Feed', 'Like a post', 'member', { rateLimit: 'reaction' }),
  op('DELETE', '/posts/{id}/like', 'Feed', 'Remove your like', 'member', { rateLimit: 'reaction' }),
  op('GET', '/posts/{id}/comments', 'Feed', 'Comments on a post', 'optional'),
  op('POST', '/posts/{id}/comments', 'Feed', 'Comment on a post', 'member', {
    body: createCommentSchema,
    idempotent: true,
    rateLimit: 'content-write',
  }),
  op('DELETE', '/comments/{id}', 'Feed', 'Delete your comment', 'member'),

  op('PUT', '/users/{username}/follow', 'Network', 'Follow someone', 'member', { rateLimit: 'reaction' }),
  op('DELETE', '/users/{username}/follow', 'Network', 'Unfollow', 'member', { rateLimit: 'reaction' }),
  op('GET', '/users/{username}/followers', 'Network', 'Followers', 'optional'),
  op('GET', '/users/{username}/following', 'Network', 'Following', 'optional'),
  op('GET', '/users/{username}/relationship', 'Network', 'Your follow/connection state with someone', 'optional'),
  op('GET', '/connections', 'Network', 'Your connections and requests', 'member'),
  op('POST', '/connections', 'Network', 'Send a connection request', 'member', {
    body: createConnectionSchema,
    idempotent: true,
    rateLimit: 'connection-request',
  }),
  op('POST', '/connections/{id}/accept', 'Network', 'Accept a request', 'member'),
  op('POST', '/connections/{id}/decline', 'Network', 'Decline a request', 'member'),
  op('POST', '/connections/{id}/cancel', 'Network', 'Withdraw your pending request', 'member'),
  op('DELETE', '/connections/{id}', 'Network', 'Remove a connection', 'member'),

  op('GET', '/discover/people', 'Discover', 'Search people by name, role, genre, location', 'optional'),
  op('GET', '/discover/work', 'Discover', 'Search published work', 'optional'),

  op('POST', '/reports', 'Moderation', 'Report a post, comment, work or profile', 'member', {
    body: createReportSchema,
    idempotent: true,
    rateLimit: 'report',
  }),

  op('GET', '/admin/me', 'Admin', 'Your staff role, 2FA state and permissions (works before 2FA)', 'member'),
  op('GET', '/admin/overview', 'Admin', 'Operational overview (real data only)', 'staff'),
  op('GET', '/admin/users', 'Admin', 'Search members', 'staff'),
  op('GET', '/admin/users/{id}', 'Admin', 'Member detail and history', 'staff'),
  op('POST', '/admin/users/{id}/status', 'Admin', 'Restrict, suspend, ban or reinstate (reason required)', 'staff', {
    body: setAccountStatusSchema,
  }),
  op('POST', '/admin/users/{id}/role', 'Admin', 'Change platform role (admin, fresh session)', 'staff', { body: setRoleSchema }),
  op('POST', '/admin/users/{id}/reset-two-factor', 'Admin', "Reset a member's 2FA (admin, fresh session)", 'staff', {
    body: reasonOnlySchema,
  }),
  op('GET', '/admin/reports', 'Admin', 'Reports queue', 'staff'),
  op('GET', '/admin/reports/{id}', 'Admin', 'Report detail', 'staff'),
  op('POST', '/admin/reports/{id}/assign', 'Admin', 'Take or release a report', 'staff', { body: assignReportSchema }),
  op('POST', '/admin/reports/{id}/notes', 'Admin', 'Add an internal note', 'staff', { body: reportNoteSchema }),
  op('POST', '/admin/reports/{id}/escalate', 'Admin', 'Escalate to an admin', 'staff', { body: reasonOnlySchema }),
  op('POST', '/admin/reports/{id}/resolve', 'Admin', 'Resolve a report', 'staff', { body: resolveReportSchema }),
  op('POST', '/admin/reports/{id}/dismiss', 'Admin', 'Dismiss a report', 'staff', { body: resolveReportSchema }),
  op('GET', '/admin/content', 'Admin', 'Browse content for moderation', 'staff'),
  op('POST', '/admin/content/{type}/{id}/remove', 'Admin', 'Remove content (reason required)', 'staff', { body: moderationActionSchema }),
  op('POST', '/admin/content/{type}/{id}/restore', 'Admin', 'Restore removed content', 'staff', { body: reasonOnlySchema }),
  op('GET', '/admin/audit', 'Admin', 'Append-only audit log', 'staff'),
  op('POST', '/admin/users/{id}/organiser', 'Admin', 'Grant or revoke organiser access (admin, reason required, audited)', 'staff', {
    body: grantOrganiserSchema,
  }),

  op('GET', '/opportunities', 'Opportunities', 'Browse opportunities (type, location, open only)', 'optional'),
  op('GET', '/opportunities/mine', 'Opportunities', 'Opportunities you organise, drafts included', 'member'),
  op('GET', '/opportunities/organiser-status', 'Opportunities', 'Whether you may organise, and what is missing', 'member'),
  op('GET', '/opportunities/{id}', 'Opportunities', 'Opportunity detail (drafts: organiser only)', 'optional'),
  op('POST', '/opportunities', 'Opportunities', 'Create a draft (approved organisers)', 'member', {
    body: createOpportunitySchema,
    idempotent: true,
    rateLimit: 'content-write',
  }),
  op('PATCH', '/opportunities/{id}', 'Opportunities', 'Edit your opportunity', 'member', {
    body: updateOpportunitySchema,
    rateLimit: 'content-write',
  }),
  op('POST', '/opportunities/{id}/publish', 'Opportunities', 'Publish a draft (future deadline required)', 'member', {
    rateLimit: 'content-write',
  }),
  op('POST', '/opportunities/{id}/close', 'Opportunities', 'Close an opportunity', 'member'),
  op('POST', '/opportunities/{id}/apply', 'Opportunities', 'Apply or express interest (once, before the deadline)', 'member', {
    body: applySchema,
    idempotent: true,
    rateLimit: 'apply',
  }),
  op('POST', '/opportunities/{id}/withdraw', 'Opportunities', 'Withdraw your application before the deadline', 'member'),
  op('GET', '/opportunities/{id}/applications', 'Opportunities', 'Applicants (organiser only)', 'member'),
  op('POST', '/applications/{id}/status', 'Opportunities', 'Shortlist, accept or reject an application (organiser, audited)', 'member', {
    body: applicationDecisionSchema,
  }),
  // Billing (Phase 2: read-only; no checkout yet — ADR 0004)
  op(
    'GET',
    '/catalogue',
    'Billing',
    'Public catalogue: Free limits and products; a price appears only when the product can be bought',
    'public',
  ),
  op('GET', '/billing/entitlements', 'Billing', 'Your current plan and limits, computed from stored periods (Free by default)', 'member'),
  op('GET', '/billing/subscriptions/{id}', 'Billing', 'One of your subscription periods (owner only; others get 404)', 'member'),
  op('GET', '/billing/promotions/{id}', 'Billing', 'One of your promotions (owner only; others get 404)', 'member'),
  op('GET', '/admin/catalogue', 'Admin', 'Catalogue rows in force, with who changed them last (admin)', 'staff'),
  op('POST', '/admin/catalogue/price', 'Admin', 'Change a price: new version, new orders only, reason required, audited (admin)', 'staff', {
    body: changePriceSchema,
  }),
  op(
    'POST',
    '/admin/catalogue/availability',
    'Admin',
    'Put on or take off sale; refused unless the product is sellable (admin, audited)',
    'staff',
    {
      body: setAvailabilitySchema,
    },
  ),
  op('GET', '/admin/billing/subscriptions/{id}', 'Admin', "Read any member's subscription period (billing.view)", 'staff'),
  op('GET', '/admin/billing/promotions/{id}', 'Admin', "Read any member's promotion (billing.view)", 'staff'),
  // Payments (Phase 3: TEST PROVIDER only; Notch Pay externally blocked — ADR 0004)
  op(
    'POST',
    '/checkout',
    'Payments',
    'Start a payment for a catalogue item (refused when PAYMENTS_MODE=off; reuses an open order for the same item; max 3 open)',
    'member',
    {
      body: startCheckoutSchema,
      idempotent: true,
      rateLimit: 'checkout',
    },
  ),
  op('GET', '/checkout/orders/{reference}', 'Payments', 'Your order’s status as MuzikHub knows it (owner only; others get 404)', 'member'),
  op('POST', '/checkout/orders/{reference}/cancel', 'Payments', 'Cancel your own pending order', 'member'),
  op(
    'POST',
    '/payments/webhooks/{provider}',
    'Payments',
    'Provider webhook: raw JSON, signature-authenticated by the adapter, de-duplicated, trigger only (no browser origin check)',
    'public',
    {
      rateLimit: 'payment-webhook',
    },
  ),
  op(
    'GET',
    '/dev/payments/status',
    'Payments (development only)',
    'Sandbox status; mounted only outside production with PAYMENTS_MODE=sandbox and the TEST PROVIDER',
    'member',
  ),
  op(
    'POST',
    '/dev/payments/test-item',
    'Payments (development only)',
    'Create the test-only catalogue item (refused in production)',
    'member',
  ),
  op(
    'POST',
    '/dev/payments/orders/{reference}/settle',
    'Payments (development only)',
    'TEST PROVIDER: set an outcome and deliver a signed webhook',
    'member',
  ),
  op(
    'GET',
    '/admin/payments/summary',
    'Admin',
    'Revenue from LIVE orders only (sandbox excluded) and order counts (billing.view)',
    'staff',
  ),
  op('GET', '/admin/payments/orders', 'Admin', 'Orders with history, filterable by status, e.g. NEEDS_REVIEW (billing.view)', 'staff'),
  op(
    'POST',
    '/admin/payments/orders/{reference}/refund',
    'Admin',
    'Refund (admin, fresh session, reason, audited; only if the provider supports refunds)',
    'staff',
    {
      body: reasonOnlySchema,
    },
  ),
  // Subscriptions, receipts and notifications (monetization milestone 1)
  op('GET', '/billing/overview', 'Billing', 'Your plan, its dates, and current, queued and ended periods', 'member'),
  op(
    'GET',
    '/billing/preview',
    'Billing',
    'What buying a plan would do (new, extend, upgrade now, downgrade later), shown before paying',
    'member',
  ),
  op(
    'POST',
    '/billing/subscription/cancel',
    'Billing',
    'Cancel: no reminders; benefits continue to the end date (plans never auto-renew)',
    'member',
  ),
  op('GET', '/billing/orders', 'Billing', 'Your transaction history', 'member'),
  op('GET', '/billing/orders/{reference}', 'Billing', 'On-screen receipt for one of your orders (owner only; others get 404)', 'member'),
  op('GET', '/notifications', 'Notifications', 'Your notifications, newest first', 'member'),
  op('GET', '/notifications/unread-count', 'Notifications', 'How many are unread', 'member'),
  op('POST', '/notifications/read', 'Notifications', 'Mark some or all as read', 'member'),
  // Analytics (monetization milestone 2): aggregated daily counters only
  op(
    'POST',
    '/analytics/events',
    'Analytics',
    'Play or link-click beacon; validated, de-duplicated (once per viewer per day), owner and bots excluded; always 204',
    'optional',
    {
      rateLimit: 'analytics-event',
    },
  ),
  op(
    'GET',
    '/analytics/summary',
    'Analytics',
    'Your totals and daily series, limited to your plan’s history (Creator Plus 30 days, Pro 365)',
    'member',
  ),
  op('GET', '/analytics/items', 'Analytics', 'Per-item plays and clicks (MuzikHub Pro)', 'member'),
  // Promotions (monetization milestone 3)
  op(
    'GET',
    '/promoted/posts',
    'Promotions',
    'The labelled Promoted slot: one running Post Boost, outside the organic feed and its paging',
    'optional',
  ),
  op('GET', '/promoted/spotlight', 'Promotions', 'The labelled Spotlight row: profiles with a running Profile Spotlight', 'optional'),
  op('GET', '/billing/promotions', 'Billing', 'Your promotions: running, queued or ended (with any early-end reason)', 'member'),
  op('GET', '/billing/promotion-preview', 'Billing', 'When a promotion would run (extends from the current end; never overlaps)', 'member'),
  op('GET', '/admin/promotions', 'Admin', 'Running (or all) promotions (content.moderate)', 'staff'),
  op(
    'POST',
    '/admin/promotions/{id}/end',
    'Admin',
    'End a promotion early with a reason; audited; owner notified (content.moderate)',
    'staff',
    { body: reasonOnlySchema },
  ),
  // Admin payment operations (monetization milestone 4)
  op('GET', '/admin/catalogue/history', 'Admin', 'Every price version of one item: who, when, why (pricing.manage)', 'staff'),
  op(
    'GET',
    '/admin/payments/orders/{reference}',
    'Admin',
    'Order detail: history, fulfilment, webhooks and allowed actions (billing.view)',
    'staff',
  ),
  op(
    'POST',
    '/admin/payments/orders/{reference}/recheck',
    'Admin',
    'Repair: re-verify with the provider and apply the state machine (payments.repair, reason, audited)',
    'staff',
    { body: reasonOnlySchema },
  ),
  op(
    'POST',
    '/admin/payments/orders/{reference}/retry-fulfilment',
    'Admin',
    'Repair: queue fulfilment again for a paid order (payments.repair, reason, audited)',
    'staff',
    { body: reasonOnlySchema },
  ),
  op(
    'POST',
    '/admin/payments/orders/{reference}/approve-late',
    'Admin',
    'Repair: approve a late payment the provider re-confirms now (payments.repair, fresh session, reason, audited)',
    'staff',
    { body: reasonOnlySchema },
  ),
  // Safety and preferences (platform milestone 1)
  op('GET', '/blocks', 'Safety', 'Members you have blocked', 'member'),
  op(
    'POST',
    '/blocks',
    'Safety',
    'Block a member: ends follows and connections; blocks messages, requests and invites both ways',
    'member',
    { body: blockSchema },
  ),
  op('DELETE', '/blocks/{username}', 'Safety', 'Unblock a member', 'member'),
  op('GET', '/notifications/settings', 'Notifications', 'Your in-app notification categories', 'member'),
  op('PUT', '/notifications/settings', 'Notifications', 'Turn categories on or off (payments and safety notices always on)', 'member', {
    body: updateNotificationSettingsSchema,
  }),
  // Communities (platform milestone 2): FR-24–29, scoped community roles
  op('GET', '/communities', 'Communities', 'Discover communities (search, category); real counts and recent activity', 'optional'),
  op('GET', '/communities/featured', 'Communities', 'Communities featured by platform staff', 'optional'),
  op('GET', '/communities/mine', 'Communities', 'Your communities and the latest discussions in them', 'member'),
  op('POST', '/communities', 'Communities', 'Start a community (you become its owner; max 5 owned)', 'member', {
    body: createCommunitySchema,
    rateLimit: 'content-write',
  }),
  op(
    'GET',
    '/communities/{slug}',
    'Communities',
    'Community page: purpose, rules, policy, counts, your membership and permissions',
    'optional',
  ),
  op('PATCH', '/communities/{slug}', 'Communities', 'Change settings (owner or community admins)', 'member', {
    body: updateCommunitySchema,
  }),
  op('DELETE', '/communities/{slug}', 'Communities', 'Close the community (owner)', 'member'),
  op('POST', '/communities/{slug}/join', 'Communities', 'Join (open), ask to join (request) — moderators are notified', 'member', {
    body: joinCommunitySchema,
    rateLimit: 'apply',
  }),
  op('POST', '/communities/{slug}/leave', 'Communities', 'Leave, or withdraw a join request (the owner must transfer first)', 'member'),
  op('POST', '/communities/{slug}/invitation/accept', 'Communities', 'Accept an invitation', 'member'),
  op('POST', '/communities/{slug}/invitation/decline', 'Communities', 'Decline an invitation', 'member'),
  op('POST', '/communities/{slug}/invitations', 'Communities', 'Invite a member by username (moderators; blocks respected)', 'member', {
    body: inviteSchema,
    rateLimit: 'connection-request',
  }),
  op(
    'GET',
    '/communities/{slug}/members',
    'Communities',
    'Members; requests, invitations and removed lists are for moderators',
    'optional',
  ),
  op('POST', '/communities/{slug}/members/{username}/approve', 'Communities', 'Approve a join request (moderators)', 'member'),
  op('POST', '/communities/{slug}/members/{username}/decline', 'Communities', 'Decline a join request (moderators)', 'member'),
  op(
    'POST',
    '/communities/{slug}/members/{username}/ban',
    'Communities',
    'Remove and keep out a member of a lower role (moderators; audited)',
    'member',
    { body: memberActionSchema },
  ),
  op('POST', '/communities/{slug}/members/{username}/unban', 'Communities', 'Allow a removed member back (moderators; audited)', 'member'),
  op(
    'PUT',
    '/communities/{slug}/members/{username}/role',
    'Communities',
    'Change a member’s community role (owner: admin/moderator; admins: moderator; audited)',
    'member',
    { body: memberRoleSchema },
  ),
  op(
    'POST',
    '/communities/{slug}/members/{username}/owner',
    'Communities',
    'Hand the community to another member (owner; audited)',
    'member',
  ),
  op(
    'GET',
    '/communities/{slug}/discussions',
    'Communities',
    'Discussions: pinned first, then latest activity (members-only communities need membership)',
    'optional',
  ),
  op(
    'POST',
    '/communities/{slug}/discussions',
    'Communities',
    'Start a discussion, question, knowledge share, mentorship thread or (admins) announcement',
    'member',
    { body: createDiscussionSchema, rateLimit: 'content-write' },
  ),
  op('GET', '/discussions/{id}', 'Communities', 'One discussion', 'optional'),
  op('PATCH', '/discussions/{id}', 'Communities', 'Edit your discussion', 'member', { body: updateDiscussionSchema }),
  op('DELETE', '/discussions/{id}', 'Communities', 'Delete your discussion', 'member'),
  op('POST', '/discussions/{id}/pin', 'Communities', 'Pin (community moderators)', 'member'),
  op('POST', '/discussions/{id}/unpin', 'Communities', 'Unpin (community moderators)', 'member'),
  op('POST', '/discussions/{id}/lock', 'Communities', 'Lock replies (community moderators; audited)', 'member'),
  op('POST', '/discussions/{id}/unlock', 'Communities', 'Unlock replies (community moderators)', 'member'),
  op('POST', '/discussions/{id}/remove', 'Communities', 'Remove with a reason (community moderators; audited; author told)', 'member', {
    body: moderationReasonSchema,
  }),
  op('PUT', '/discussions/{id}/helpful', 'Communities', 'Mark as helpful', 'member', { rateLimit: 'reaction' }),
  op('DELETE', '/discussions/{id}/helpful', 'Communities', 'Unmark as helpful', 'member', { rateLimit: 'reaction' }),
  op('PUT', '/discussions/{id}/follow', 'Communities', 'Get reply notifications', 'member'),
  op('DELETE', '/discussions/{id}/follow', 'Communities', 'Stop reply notifications', 'member'),
  op(
    'POST',
    '/discussions/{id}/answer',
    'Communities',
    'Mark (or clear) the accepted answer to a question (asker or moderators)',
    'member',
  ),
  op('GET', '/discussions/{id}/comments', 'Communities', 'Replies, oldest first', 'optional'),
  op('POST', '/discussions/{id}/comments', 'Communities', 'Reply (one level of nesting); followers and @mentions notified', 'member', {
    body: createDiscussionCommentSchema,
    rateLimit: 'content-write',
  }),
  op('PATCH', '/community-comments/{id}', 'Communities', 'Edit your reply', 'member', { body: updateDiscussionCommentSchema }),
  op('DELETE', '/community-comments/{id}', 'Communities', 'Delete your reply', 'member'),
  op('POST', '/community-comments/{id}/remove', 'Communities', 'Remove a reply with a reason (community moderators; audited)', 'member', {
    body: moderationReasonSchema,
  }),
  // Direct messaging (platform milestone 3): FR-47–54, MSG-001–007; push over /api/realtime (Socket.IO)
  op('GET', '/conversations', 'Messaging', 'Your conversations, most recent first, with unread counts and receipts', 'member'),
  op(
    'POST',
    '/conversations',
    'Messaging',
    'Open (or create) the direct conversation with a member (blocks and their message policy apply)',
    'member',
    { body: startConversationSchema, rateLimit: 'conversation-start' },
  ),
  op('GET', '/conversations/unread-count', 'Messaging', 'How many conversations have unread messages', 'member'),
  op('GET', '/conversations/settings/policy', 'Messaging', 'Who may start a conversation with you', 'member'),
  op('PUT', '/conversations/settings/policy', 'Messaging', 'Set who may start a conversation with you', 'member', {
    body: messagePolicySchema,
  }),
  op('GET', '/conversations/{id}', 'Messaging', 'One conversation (participants only; others 404)', 'member'),
  op(
    'GET',
    '/conversations/{id}/messages',
    'Messaging',
    'History: newest page, `before` for older, `after` to catch up after reconnecting; marks delivery',
    'member',
  ),
  op(
    'POST',
    '/conversations/{id}/messages',
    'Messaging',
    'Send: persisted before it is pushed; same clientId = same message (no duplicates); anti-spam cap until a reply',
    'member',
    { body: sendMessageSchema, rateLimit: 'message-send' },
  ),
  op('POST', '/conversations/{id}/read', 'Messaging', 'Read receipt up to a message (only moves forward)', 'member', {
    body: messageReceiptSchema,
  }),
  op('POST', '/conversations/{id}/delivered', 'Messaging', 'Delivery receipt up to a message', 'member', { body: messageReceiptSchema }),
];
