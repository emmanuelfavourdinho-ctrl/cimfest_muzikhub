import type { AdminCatalogueRow, BillingProduct, CatalogueOption, OrderStatus } from '@muzikhub/shared';
import type { AccountStatus, MediaView, Permission, PersonSummary, PlatformRole, SetAccountStatusInput } from '@muzikhub/shared';
import { request } from '@/lib/api';

/* Response shapes of /api/v1/admin/* (see apps/api/src/modules/admin). */

export interface AdminMe {
  isStaff: boolean;
  role: 'MODERATOR' | 'ADMIN' | null;
  accountActive: boolean;
  twoFactorEnabled: boolean;
  permissions: Permission[];
  freshUntil: string;
}

export interface AuditEntry {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  actorLabel: string | null;
  actor?: { name: string; username: string | null } | null;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export interface Overview {
  generatedAt: string;
  users: {
    total: number;
    new7d: number;
    new30d: number;
    active7d: number;
    byStatus: Record<AccountStatus, number>;
    weeklySignups: { weekStart: string; signups: number }[];
  };
  content: { posts: number; posts7d: number; comments7d: number; publishedWork: number; removed30d: number };
  moderation: { openReports: number; unassigned: number; escalated: number; oldestOpenAt: string | null; closed7d: number };
  staff: { admins: number; moderators: number; withoutTwoFactor: number };
  pending: string[];
  recentAudit: AuditEntry[] | null;
}

export interface AdminUserRow {
  id: string;
  name: string;
  username: string | null;
  image: string | null;
  email: string | null;
  emailVerified: boolean;
  role: PlatformRole;
  status: AccountStatus;
  statusUntil: string | null;
  twoFactorEnabled: boolean;
  creativeRoles: string[];
  joinedAt: string;
}

export interface AdminUserDetail extends AdminUserRow {
  hasCover: boolean;
  isOrganiser: boolean;
  statusReason: string | null;
  statusChangedAt: string | null;
  primaryUse: string | null;
  location: string | null;
  bio: string | null;
  lastActiveAt: string | null;
  activity: { posts: number; comments: number; portfolioItems: number; publishedWork: number; reportsFiled: number };
  reportsAgainst: { id: string; targetType: string; targetId: string; reason: string; status: string; createdAt: string }[];
  history: AuditEntry[];
  allowed: {
    restrict: boolean;
    suspend: boolean;
    ban: boolean;
    reinstate: boolean;
    changeRole: boolean;
    resetTwoFactor: boolean;
    grantOrganiser: boolean;
    maxSuspensionDays: number;
  };
}

export interface ReportTarget {
  exists: boolean;
  removed?: boolean;
  removalReason?: string | null;
  ownerId?: string;
  owner?: PersonSummary;
  title: string;
  text?: string | null;
  media?: MediaView[];
  link?: string;
  moderationType?: 'post' | 'comment' | 'portfolio-item' | null;
  accountStatus?: AccountStatus;
  hasAvatar?: boolean;
  hasCover?: boolean;
}

export interface ReportRow {
  id: string;
  targetType: 'POST' | 'COMMENT' | 'PORTFOLIO_ITEM' | 'PROFILE';
  targetId: string;
  reason: string;
  details: string | null;
  status: 'PENDING' | 'UNDER_REVIEW' | 'RESOLVED' | 'DISMISSED';
  escalated: boolean;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
  reporter: PersonSummary;
  assignee: PersonSummary | null;
  target: ReportTarget;
  notesCount?: number;
  openReportsOnTarget?: number;
}

export interface ReportDetail extends ReportRow {
  resolvedBy: PersonSummary | null;
  notes: { id: string; body: string; author: PersonSummary | null; createdAt: string }[];
  otherReports: (Omit<ReportRow, 'target' | 'assignee'> & { reporter: PersonSummary })[];
  history: AuditEntry[];
  canDecide: boolean;
}

export interface ContentRow {
  id: string;
  kind: 'post' | 'comment' | 'portfolio-item';
  title: string | null;
  excerpt: string | null;
  author: PersonSummary;
  thumbnail: string | null;
  createdAt: string;
  removedAt: string | null;
  removalReason: string | null;
  link: string;
  openReports: number;
}

type Page<T> = { items: T[]; nextCursor: string | null };

export interface AdminOrderRow {
  reference: string;
  status: OrderStatus;
  statusMessage: string;
  statusReason: string | null;
  product: string;
  option: string;
  amountXaf: number;
  mode: 'SANDBOX' | 'LIVE';
  provider: string;
  createdAt: string;
  paidAt: string | null;
  user: { id: string; name: string; username: string | null };
}
export interface AdminOrderDetail extends AdminOrderRow {
  expiresAt: string;
  providerTransactionId: string | null;
  targetId: string | null;
  fulfilledAt: string | null;
  refundedAt: string | null;
  refundReason: string | null;
  providerFeeRefunded: boolean;
  history: { from: OrderStatus | null; to: OrderStatus; trigger: string; actorId: string | null; detail: string | null; at: string }[];
  fulfilments: { fulfiller: string; entitlementType: string | null; entitlementId: string | null; at: string }[];
  webhooks: { eventId: string; type: string; matched: boolean; at: string }[];
  actions: { recheck: boolean; retryFulfilment: boolean; approveLate: boolean; refund: boolean };
}
export interface PaymentsSummary {
  liveRevenueXaf: number;
  liveOrders: number;
  counts: { mode: 'SANDBOX' | 'LIVE'; status: OrderStatus; count: number }[];
}
export interface AdminPromotion {
  id: string;
  product: 'POST_BOOST' | 'PROFILE_SPOTLIGHT';
  targetType: 'POST' | 'PROFILE';
  targetId: string;
  user: { id: string; name: string; username: string | null };
  periodStart: string;
  periodEnd: string;
  status: string;
  running: boolean;
  endedReason: string | null;
}
export interface AdminDispute {
  id: string;
  status: 'OPEN' | 'UPHELD' | 'REJECTED';
  reason: string;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
  user: { id: string; name: string; username: string | null };
  competition: { slug: string; title: string };
}
export interface PriceVersion {
  id: string;
  priceXaf: number;
  active: boolean;
  effectiveFrom: string;
  updatedBy: string | null;
  reason: string | null;
}
type Q = Record<string, string | undefined>;

export const adminApi = {
  me: () => request<AdminMe>('/admin/me', null),
  overview: () => request<Overview>('/admin/overview', null),
  users: (query: Q) => request<Page<AdminUserRow>>('/admin/users', null, { query }),
  user: (id: string) => request<AdminUserDetail>(`/admin/users/${encodeURIComponent(id)}`, null),
  setStatus: (id: string, body: SetAccountStatusInput) =>
    request<unknown>(`/admin/users/${encodeURIComponent(id)}/status`, null, { method: 'POST', body }),
  setRole: (id: string, role: PlatformRole, reason: string) =>
    request<unknown>(`/admin/users/${encodeURIComponent(id)}/role`, null, { method: 'POST', body: { role, reason } }),
  resetTwoFactor: (id: string, reason: string) =>
    request<unknown>(`/admin/users/${encodeURIComponent(id)}/reset-two-factor`, null, { method: 'POST', body: { reason } }),
  setOrganiser: (id: string, grant: boolean, reason: string) =>
    request<{ isOrganiser: boolean }>(`/admin/users/${encodeURIComponent(id)}/organiser`, null, {
      method: 'POST',
      body: { grant, reason },
    }),
  reports: (query: Q) => request<Page<ReportRow>>('/admin/reports', null, { query }),
  report: (id: string) => request<ReportDetail>(`/admin/reports/${encodeURIComponent(id)}`, null),
  assign: (id: string, assignee: 'me' | 'nobody') =>
    request<unknown>(`/admin/reports/${encodeURIComponent(id)}/assign`, null, { method: 'POST', body: { assignee } }),
  note: (id: string, body: string) =>
    request<unknown>(`/admin/reports/${encodeURIComponent(id)}/notes`, null, { method: 'POST', body: { body } }),
  escalate: (id: string, reason: string) =>
    request<unknown>(`/admin/reports/${encodeURIComponent(id)}/escalate`, null, { method: 'POST', body: { reason } }),
  close: (id: string, outcome: 'resolve' | 'dismiss', resolution: string, includeRelated: boolean) =>
    request<{ closed: number }>(`/admin/reports/${encodeURIComponent(id)}/${outcome}`, null, {
      method: 'POST',
      body: { resolution, includeRelated },
    }),
  content: (query: Q) => request<Page<ContentRow>>('/admin/content', null, { query }),
  removeContent: (type: string, id: string, reason: string, reportId?: string) =>
    request<{ restorable: boolean }>(`/admin/content/${type}/${encodeURIComponent(id)}/remove`, null, {
      method: 'POST',
      body: { reason, ...(reportId && { reportId }) },
    }),
  restoreContent: (type: string, id: string, reason: string) =>
    request<unknown>(`/admin/content/${type}/${encodeURIComponent(id)}/restore`, null, { method: 'POST', body: { reason } }),
  audit: (query: Q) => request<Page<AuditEntry>>('/admin/audit', null, { query }),
  paymentsSummary: () => request<PaymentsSummary>('/admin/payments/summary', null),
  paymentOrders: (query: Q) => request<Page<AdminOrderRow>>('/admin/payments/orders', null, { query }),
  paymentOrder: (ref: string) => request<AdminOrderDetail>(`/admin/payments/orders/${encodeURIComponent(ref)}`, null),
  paymentAction: (ref: string, action: 'recheck' | 'retry-fulfilment' | 'approve-late' | 'refund', reason: string) =>
    request<unknown>(`/admin/payments/orders/${encodeURIComponent(ref)}/${action}`, null, { method: 'POST', body: { reason } }),
  competitionDisputes: (status: 'OPEN' | 'UPHELD' | 'REJECTED') =>
    request<{ items: AdminDispute[] }>('/admin/competition-disputes', null, { query: { status } }),
  resolveDispute: (id: string, outcome: 'UPHELD' | 'REJECTED', resolution: string) =>
    request<unknown>(`/admin/competition-disputes/${encodeURIComponent(id)}/resolve`, null, {
      method: 'POST',
      body: { outcome, resolution },
    }),
  promotions: (state: 'running' | 'all') => request<{ items: AdminPromotion[] }>('/admin/promotions', null, { query: { state } }),
  endPromotion: (id: string, reason: string) =>
    request<unknown>(`/admin/promotions/${encodeURIComponent(id)}/end`, null, { method: 'POST', body: { reason } }),
  priceHistory: (product: string, option: string) =>
    request<{ items: PriceVersion[] }>('/admin/catalogue/history', null, { query: { product, option } }),
  catalogue: () => request<{ items: AdminCatalogueRow[] }>('/admin/catalogue', null),
  changePrice: (product: BillingProduct, option: CatalogueOption, priceXaf: number, reason: string) =>
    request<{ items: AdminCatalogueRow[] }>('/admin/catalogue/price', null, {
      method: 'POST',
      body: { product, option, priceXaf, reason },
    }),
};
