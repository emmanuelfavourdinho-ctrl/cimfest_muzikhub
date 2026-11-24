import type {
  ApplicationStatus,
  ApplicationView,
  CreateOpportunityInput,
  OpportunityView,
  OrganiserStatus,
  Page,
  PageQuery,
  UpdateOpportunityInput,
} from '@muzikhub/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { visibleUser } from '../../lib/account-status.js';
import { writeAudit } from '../../lib/audit.js';
import { HttpError } from '../../lib/http-error.js';
import { mapPage, paginate } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { personSelect, toPerson } from '../profiles/people.js';

/**
 * Opportunities (FR-34..37). State machine (server-enforced):
 *   opportunity: DRAFT → PUBLISHED → CLOSED   (only the organiser; publish needs a future deadline)
 *   application: SUBMITTED ↔ SHORTLISTED → ACCEPTED | REJECTED  (organiser)
 *                SUBMITTED | SHORTLISTED → WITHDRAWN            (applicant, before the deadline)
 *                WITHDRAWN → SUBMITTED                          (re-apply, before the deadline)
 */

const include = {
  organiser: { select: personSelect },
  _count: { select: { applications: { where: { status: { not: 'WITHDRAWN' as const } } } } },
} satisfies Prisma.OpportunityInclude;
type Row = Prisma.OpportunityGetPayload<{ include: typeof include }>;

const accepting = (o: { status: string; deadline: Date }) => o.status === 'PUBLISHED' && o.deadline > new Date();

function toView(
  o: Row,
  viewerId: string | null,
  mine: { id: string; status: ApplicationStatus; message: string; createdAt: Date } | null,
): OpportunityView {
  const isOwner = viewerId === o.organiserId;
  return {
    id: o.id,
    type: o.type,
    title: o.title,
    description: o.description,
    requirements: o.requirements,
    location: o.location,
    remote: o.remote,
    deadline: o.deadline.toISOString(),
    status: o.status,
    publishedAt: o.publishedAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
    organiser: toPerson(o.organiser),
    acceptingApplications: accepting(o),
    isOwner,
    applicationCount: isOwner ? o._count.applications : null,
    myApplication: mine ? { ...mine, createdAt: mine.createdAt.toISOString() } : null,
  };
}

/** D7: admin approval + verified email + "Industry professional" primary use. */
export async function organiserStatus(userId: string): Promise<OrganiserStatus> {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { isOrganiser: true, emailVerified: true, primaryUse: true },
  });
  const missing: OrganiserStatus['missing'] = [];
  if (!u.isOrganiser) missing.push('ADMIN_APPROVAL');
  if (!u.emailVerified) missing.push('VERIFIED_EMAIL');
  if (u.primaryUse !== 'PROFESSIONAL') missing.push('PROFESSIONAL_ACCOUNT');
  return { canOrganise: missing.length === 0, missing };
}

async function assertOrganiser(userId: string) {
  const s = await organiserStatus(userId);
  if (!s.canOrganise) {
    throw new HttpError(
      403,
      'NOT_AN_ORGANISER',
      'Publishing opportunities needs an approved organiser account (verified email, industry professional, admin approval).',
    );
  }
}

async function loadOwned(userId: string, id: string) {
  const o = await prisma.opportunity.findUnique({ where: { id } });
  // Someone else's draft is indistinguishable from a missing one (no ID probing).
  if (!o || (o.organiserId !== userId && o.status === 'DRAFT')) throw new HttpError(404, 'OPPORTUNITY_NOT_FOUND', 'Opportunity not found');
  if (o.organiserId !== userId) throw new HttpError(403, 'NOT_OWNER', 'Only the organiser can change this opportunity');
  return o;
}

async function myApplication(viewerId: string | null, opportunityId: string) {
  if (!viewerId) return null;
  return prisma.opportunityApplication.findUnique({
    where: { opportunityId_applicantId: { opportunityId, applicantId: viewerId } },
    select: { id: true, status: true, message: true, createdAt: true },
  });
}

export async function listOpportunities(
  viewerId: string | null,
  q: PageQuery & { type?: string; location?: string; open: boolean },
): Promise<Page<OpportunityView>> {
  const where: Prisma.OpportunityWhereInput = {
    status: q.open ? 'PUBLISHED' : { in: ['PUBLISHED', 'CLOSED'] },
    ...(q.open && { deadline: { gt: new Date() } }),
    ...(q.type && { type: q.type as Prisma.OpportunityWhereInput['type'] }),
    ...(q.location && { location: { contains: q.location, mode: 'insensitive' } }),
    organiser: visibleUser,
  };
  const page = await paginate(q, (args) =>
    prisma.opportunity.findMany({ where, include, orderBy: [{ deadline: 'asc' }, { id: 'asc' }], ...args }),
  );
  return mapPage(page, (o) => toView(o, viewerId, null));
}

export async function listMine(userId: string, q: PageQuery): Promise<Page<OpportunityView>> {
  const page = await paginate(q, (args) =>
    prisma.opportunity.findMany({ where: { organiserId: userId }, include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...args }),
  );
  return mapPage(page, (o) => toView(o, userId, null));
}

export async function getOpportunity(viewerId: string | null, id: string): Promise<OpportunityView> {
  const o = await prisma.opportunity.findUnique({
    where: { id },
    include: { ...include, organiser: { select: { ...personSelect, status: true } } },
  });
  if (
    !o ||
    (o.status === 'DRAFT' && o.organiserId !== viewerId) ||
    (o.organiserId !== viewerId && !['ACTIVE', 'RESTRICTED'].includes(o.organiser.status))
  ) {
    throw new HttpError(404, 'OPPORTUNITY_NOT_FOUND', 'Opportunity not found');
  }
  return toView(o, viewerId, await myApplication(viewerId, id));
}

export async function createOpportunity(userId: string, input: CreateOpportunityInput): Promise<OpportunityView> {
  await assertOrganiser(userId);
  const o = await prisma.opportunity.create({
    data: { ...input, remote: input.remote ?? false, deadline: new Date(input.deadline), organiserId: userId },
    include,
  });
  return toView(o, userId, null);
}

export async function updateOpportunity(userId: string, id: string, input: UpdateOpportunityInput): Promise<OpportunityView> {
  const o = await loadOwned(userId, id);
  if (o.status === 'CLOSED') throw new HttpError(409, 'OPPORTUNITY_CLOSED', 'A closed opportunity can no longer be edited');
  const deadline = input.deadline ? new Date(input.deadline) : undefined;
  if (o.status === 'PUBLISHED' && deadline && deadline <= new Date())
    throw new HttpError(400, 'DEADLINE_IN_PAST', 'The deadline must be in the future');
  const updated = await prisma.opportunity.update({ where: { id }, data: { ...input, ...(deadline && { deadline }) }, include });
  return toView(updated, userId, null);
}

export async function publishOpportunity(userId: string, id: string, ip: string | null): Promise<OpportunityView> {
  await assertOrganiser(userId);
  const o = await loadOwned(userId, id);
  if (o.status !== 'DRAFT') throw new HttpError(409, 'NOT_A_DRAFT', 'Only drafts can be published');
  if (o.deadline <= new Date()) throw new HttpError(400, 'DEADLINE_IN_PAST', 'Set a deadline in the future before publishing');
  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.opportunity.update({ where: { id }, data: { status: 'PUBLISHED', publishedAt: new Date() }, include });
    await writeAudit(tx, {
      actor: { id: userId, role: 'ORGANISER', ip },
      action: 'opportunity.publish',
      target: { type: 'opportunity', id },
      after: { status: 'PUBLISHED' },
    });
    return res;
  });
  return toView(updated, userId, null);
}

export async function closeOpportunity(userId: string, id: string, ip: string | null): Promise<OpportunityView> {
  const o = await loadOwned(userId, id);
  if (o.status === 'CLOSED') throw new HttpError(409, 'OPPORTUNITY_CLOSED', 'Already closed');
  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.opportunity.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date() }, include });
    await writeAudit(tx, {
      actor: { id: userId, role: 'ORGANISER', ip },
      action: 'opportunity.close',
      target: { type: 'opportunity', id },
      before: { status: o.status },
      after: { status: 'CLOSED' },
    });
    return res;
  });
  return toView(updated, userId, null);
}

export async function apply(userId: string, id: string, message: string): Promise<OpportunityView> {
  const o = await prisma.opportunity.findUnique({ where: { id } });
  if (!o || o.status === 'DRAFT') throw new HttpError(404, 'OPPORTUNITY_NOT_FOUND', 'Opportunity not found');
  if (o.organiserId === userId) throw new HttpError(400, 'CANNOT_APPLY_OWN', "You can't apply to your own opportunity");
  if (!accepting(o)) throw new HttpError(409, 'APPLICATIONS_CLOSED', 'This opportunity is no longer accepting applications');
  const existing = await myApplication(userId, id);
  if (existing && existing.status !== 'WITHDRAWN') throw new HttpError(409, 'ALREADY_APPLIED', "You've already applied");
  await prisma.opportunityApplication.upsert({
    where: { opportunityId_applicantId: { opportunityId: id, applicantId: userId } },
    create: { opportunityId: id, applicantId: userId, message },
    update: { message, status: 'SUBMITTED' },
  });
  return getOpportunity(userId, id);
}

export async function withdraw(userId: string, id: string): Promise<OpportunityView> {
  const o = await prisma.opportunity.findUnique({ where: { id } });
  const mine = await myApplication(userId, id);
  if (!o || !mine) throw new HttpError(404, 'APPLICATION_NOT_FOUND', 'Application not found');
  if (!['SUBMITTED', 'SHORTLISTED'].includes(mine.status))
    throw new HttpError(409, 'CANNOT_WITHDRAW', 'This application has already been decided');
  if (o.deadline <= new Date()) throw new HttpError(409, 'DEADLINE_PASSED', 'The deadline has passed');
  // Conditional update: a decision made at the same moment wins, never silently overwritten.
  const { count } = await prisma.opportunityApplication.updateMany({
    where: { id: mine.id, status: { in: ['SUBMITTED', 'SHORTLISTED'] } },
    data: { status: 'WITHDRAWN' },
  });
  if (!count) throw new HttpError(409, 'CANNOT_WITHDRAW', 'This application has already been decided');
  return getOpportunity(userId, id);
}

export async function listApplications(userId: string, id: string, q: PageQuery): Promise<Page<ApplicationView>> {
  await loadOwned(userId, id);
  const page = await paginate(q, (args) =>
    prisma.opportunityApplication.findMany({
      where: { opportunityId: id, status: { not: 'WITHDRAWN' } },
      include: { applicant: { select: personSelect } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      ...args,
    }),
  );
  return mapPage(page, (a) => ({
    id: a.id,
    status: a.status,
    message: a.message,
    createdAt: a.createdAt.toISOString(),
    applicant: toPerson(a.applicant),
  }));
}

export async function decide(
  userId: string,
  applicationId: string,
  status: 'SHORTLISTED' | 'ACCEPTED' | 'REJECTED',
  ip: string | null,
): Promise<ApplicationView> {
  const a = await prisma.opportunityApplication.findUnique({
    where: { id: applicationId },
    include: { opportunity: true, applicant: { select: personSelect } },
  });
  if (!a || a.opportunity.organiserId !== userId) throw new HttpError(404, 'APPLICATION_NOT_FOUND', 'Application not found');
  const allowedFrom: Record<string, string[]> = {
    SHORTLISTED: ['SUBMITTED'],
    ACCEPTED: ['SUBMITTED', 'SHORTLISTED'],
    REJECTED: ['SUBMITTED', 'SHORTLISTED'],
  };
  if (!allowedFrom[status]!.includes(a.status))
    throw new HttpError(409, 'INVALID_TRANSITION', `Can't move an application from ${a.status.toLowerCase()} to ${status.toLowerCase()}`);
  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.opportunityApplication.updateMany({ where: { id: applicationId, status: a.status }, data: { status } });
    if (!count) throw new HttpError(409, 'CONFLICT_RETRY', 'The application changed meanwhile. Refresh and try again.');
    await writeAudit(tx, {
      actor: { id: userId, role: 'ORGANISER', ip },
      action: 'opportunity.application.decide',
      target: { type: 'opportunity_application', id: applicationId },
      before: { status: a.status },
      after: { status },
    });
    return tx.opportunityApplication.findUniqueOrThrow({ where: { id: applicationId }, include: { applicant: { select: personSelect } } });
  });
  return {
    id: updated.id,
    status: updated.status,
    message: updated.message,
    createdAt: updated.createdAt.toISOString(),
    applicant: toPerson(updated.applicant),
  };
}

/** Admin-only (permission organisers.grant), audited. */
export async function setOrganiser(
  actor: { id: string; role: string; ip: string | null },
  targetId: string,
  grant: boolean,
  reason: string,
) {
  const u = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, isOrganiser: true } });
  if (!u) throw new HttpError(404, 'USER_NOT_FOUND', 'User not found');
  if (u.id === actor.id) throw new HttpError(403, 'CANNOT_TARGET_SELF', "You can't change your own organiser access");
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: targetId }, data: { isOrganiser: grant, organiserSince: grant ? new Date() : null } });
    await writeAudit(tx, {
      actor,
      action: grant ? 'user.organiser.grant' : 'user.organiser.revoke',
      target: { type: 'user', id: targetId },
      reason,
      before: { isOrganiser: u.isOrganiser },
      after: { isOrganiser: grant },
    });
  });
  return { isOrganiser: grant };
}
