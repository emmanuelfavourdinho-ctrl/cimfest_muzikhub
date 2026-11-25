import { randomBytes } from 'node:crypto';
import {
  competitionPhase,
  DISPUTE_WINDOW_DAYS,
  PHASE_LABELS,
  rankEntries,
  weightedTotal,
  type CompetitionCard,
  type CompetitionDetail,
  type CompetitionInput,
  type Criterion,
  type EntryView,
} from '@muzikhub/shared';
import type { z } from 'zod';
import type { competitionQuerySchema, entryInputSchema, updateCompetitionSchema } from '@muzikhub/shared';
import type { Competition, MediaAsset, Prisma } from '../../generated/prisma/client.js';
import { isVisibleStatus, visibleUser } from '../../lib/account-status.js';
import { writeAudit } from '../../lib/audit.js';
import { dbNow } from '../../lib/db-time.js';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import type { StaffContext } from '../../middleware/require-staff.js';
import { slugify } from '../communities/communities.service.js';
import { releaseAssets, requireAttachable, toMediaView } from '../media/media.service.js';
import { notify } from '../notifications/notifications.service.js';
import { organiserStatus } from '../opportunities/opportunities.service.js';
import { personSelect, toPerson } from '../profiles/people.js';

type Tx = Prisma.TransactionClient;
type Row = Competition & { coverAsset: MediaAsset | null; organiser: Prisma.UserGetPayload<{ select: typeof personSelect }> };

/**
 * Competitions. Rules of the road (SRS COMP-001–009, D7, D9):
 *  - only admin-approved organisers create and publish; platform staff can remove;
 *  - every date check uses database time; a late entry needs a recorded extension;
 *  - entries record the rules version accepted; changing rules after publishing makes a new version;
 *  - organiser or assigned judges score against the published criteria until results are published,
 *    after which scores are frozen; results appear only once published;
 *  - disputes go to an ADMIN, who records a decision (outcomes are never altered silently).
 */
const include = { coverAsset: true, organiser: { select: personSelect } } satisfies Prisma.CompetitionInclude;
const cover = (a: MediaAsset | null) => (a ? (toMediaView(a).urls.wide ?? toMediaView(a).urls.medium ?? null) : null);
const phaseAt = (c: Competition, now: Date) => competitionPhase(c, now);

async function requireCompetition(slug: string, db: Tx | typeof prisma = prisma) {
  const c = await db.competition.findFirst({ where: { slug, removedAt: null }, include });
  if (!c) throw new HttpError(404, 'COMPETITION_NOT_FOUND', 'Competition not found');
  return c;
}

/** Drafts are visible only to their organiser (404 for everyone else). */
async function requireVisible(slug: string, viewerId: string | null) {
  const c = await requireCompetition(slug);
  if (c.status === 'DRAFT' && c.organiserId !== viewerId) throw new HttpError(404, 'COMPETITION_NOT_FOUND', 'Competition not found');
  return c;
}

async function cards(rows: Row[], now: Date): Promise<CompetitionCard[]> {
  const counts = await prisma.competitionEntry.groupBy({
    by: ['competitionId'],
    where: { competitionId: { in: rows.map((r) => r.id) }, status: 'SUBMITTED', removedAt: null },
    _count: true,
  });
  const n = new Map(counts.map((c) => [c.competitionId, c._count]));
  return rows.map((c) => ({
    id: c.id,
    slug: c.slug,
    title: c.title,
    category: c.category,
    phase: phaseAt(c, now),
    cover: cover(c.coverAsset),
    prize: c.prize,
    opensAt: c.opensAt.toISOString(),
    closesAt: c.closesAt.toISOString(),
    extendedUntil: c.extendedUntil?.toISOString() ?? null,
    entryCount: n.get(c.id) ?? 0,
    organiser: toPerson(c.organiser),
    featured: Boolean(c.featuredAt),
  }));
}

/** Discovery: published competitions only (drafts are private), filtered by phase computed from DB time. */
export async function listCompetitions(viewerId: string | null, q: z.output<typeof competitionQuerySchema>) {
  const now = await dbNow();
  const where: Prisma.CompetitionWhereInput = {
    removedAt: null,
    organiser: visibleUser,
    ...(q.category && { category: q.category }),
    ...(q.q && { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { description: { contains: q.q, mode: 'insensitive' } }] }),
  };
  if (q.mine && viewerId) {
    if (q.mine === 'organising') where.organiserId = viewerId;
    if (q.mine === 'entered') where.entries = { some: { participantId: viewerId } };
    if (q.mine === 'judging') where.judges = { some: { userId: viewerId } };
  }
  if (!(q.mine === 'organising')) where.status = { in: ['PUBLISHED', 'RESULTS_PUBLISHED', 'CANCELLED'] };
  if (q.phase === 'RESULTS') where.status = 'RESULTS_PUBLISHED';
  else if (q.phase) {
    where.status = 'PUBLISHED';
    if (q.phase === 'UPCOMING') where.opensAt = { gt: now };
    if (q.phase === 'OPEN')
      where.AND = [{ opensAt: { lte: now } }, { OR: [{ extendedUntil: { gt: now } }, { extendedUntil: null, closesAt: { gt: now } }] }];
    if (q.phase === 'JUDGING') where.AND = [{ OR: [{ extendedUntil: { lte: now } }, { extendedUntil: null, closesAt: { lte: now } }] }];
  }
  const rows = await prisma.competition.findMany({
    where,
    include,
    orderBy: [{ featuredAt: { sort: 'desc', nulls: 'last' } }, { closesAt: 'asc' }],
    take: 60,
  });
  return { items: await cards(rows, now) };
}

async function currentRules(c: Pick<Competition, 'id' | 'rulesVersion'>) {
  const r = await prisma.competitionRules.findUnique({
    where: { competitionId_version: { competitionId: c.id, version: c.rulesVersion } },
  });
  return r?.rules ?? '';
}

export async function competitionDetail(slug: string, viewerId: string | null): Promise<CompetitionDetail> {
  const c = await requireVisible(slug, viewerId);
  const now = await dbNow();
  const [card] = await cards([c], now);
  const phase = phaseAt(c, now);
  const [judges, mine, dispute, results, viewer] = await Promise.all([
    prisma.competitionJudge.findMany({ where: { competitionId: c.id }, include: { user: { select: personSelect } } }),
    viewerId
      ? prisma.competitionEntry.findUnique({ where: { competitionId_participantId: { competitionId: c.id, participantId: viewerId } } })
      : null,
    viewerId ? prisma.competitionDispute.findUnique({ where: { competitionId_userId: { competitionId: c.id, userId: viewerId } } }) : null,
    c.status === 'RESULTS_PUBLISHED'
      ? prisma.competitionResult.findMany({
          where: { competitionId: c.id, entry: { removedAt: null } },
          orderBy: { placement: 'asc' },
          include: { entry: { include: { participant: { select: personSelect }, mediaAsset: true } } },
        })
      : [],
    viewerId ? prisma.user.findUnique({ where: { id: viewerId }, select: { status: true } }) : null,
  ]);
  const isOrganiser = viewerId === c.organiserId;
  const isJudge = judges.some((j) => j.userId === viewerId);
  let cannotEnterReason: string | null = null;
  if (!viewerId) cannotEnterReason = 'Sign in to enter.';
  else if (isOrganiser || isJudge) cannotEnterReason = 'Organisers and judges can’t enter.';
  else if (!isVisibleStatus(viewer?.status) || viewer?.status === 'RESTRICTED')
    cannotEnterReason = 'Your account can’t enter competitions right now.';
  else if (phase !== 'OPEN') cannotEnterReason = phase === 'UPCOMING' ? 'Entries haven’t opened yet.' : 'Entries are closed.';
  else if (mine?.status === 'DISQUALIFIED') cannotEnterReason = 'Your entry was disqualified.';
  const windowEnd = c.resultsPublishedAt ? new Date(c.resultsPublishedAt.getTime() + DISPUTE_WINDOW_DAYS * 86_400_000) : null;
  return {
    ...card!,
    description: c.description,
    eligibility: c.eligibility,
    rules: await currentRules(c),
    rulesVersion: c.rulesVersion,
    prizePlaces: c.prizePlaces,
    judgingMethod: c.judgingMethod,
    disqualification: c.disqualification,
    disputeProcess: c.disputeProcess,
    formats: c.formats,
    criteria: c.criteria as unknown as Criterion[],
    extensionReason: c.extensionReason,
    cancelReason: c.cancelReason,
    resultsPublishedAt: c.resultsPublishedAt?.toISOString() ?? null,
    judges: judges.map((j) => toPerson(j.user)),
    viewer: {
      isOrganiser,
      isJudge,
      canEnter: cannotEnterReason === null,
      cannotEnterReason,
      entryId: mine && mine.status !== 'WITHDRAWN' ? mine.id : null,
      entryRulesVersion: mine && mine.status !== 'WITHDRAWN' ? mine.rulesVersion : null,
      canDispute: Boolean(mine && mine.status !== 'WITHDRAWN' && !dispute && windowEnd && now < windowEnd),
      disputeStatus: dispute?.status ?? null,
    },
    results: results.map((r) => ({
      placement: r.placement,
      averageScore: r.averageScore,
      entry: {
        id: r.entry.id,
        title: r.entry.title,
        participant: toPerson(r.entry.participant),
        externalUrl: r.entry.externalUrl,
        media: r.entry.mediaAsset ? toMediaView(r.entry.mediaAsset) : null,
      },
    })),
  };
}

// ── Organiser workflows ──────────────────────────────────────

async function assertOrganiser(userId: string) {
  if (!(await organiserStatus(userId)).canOrganise) {
    throw new HttpError(
      403,
      'NOT_AN_ORGANISER',
      'Running competitions needs an approved organiser account (verified email, industry professional, admin approval).',
    );
  }
}

async function ownCompetition(userId: string, slug: string) {
  const c = await requireCompetition(slug);
  if (c.organiserId !== userId) throw new HttpError(403, 'NOT_ORGANISER', 'Only the organiser can do that.');
  return c;
}

function checkDates(opensAt: Date, closesAt: Date, now: Date) {
  if (opensAt >= closesAt) throw new HttpError(400, 'VALIDATION_ERROR', 'Entries must open before they close.');
  if (closesAt <= now) throw new HttpError(400, 'VALIDATION_ERROR', 'The closing date must be in the future.');
  if (closesAt.getTime() - opensAt.getTime() < 3_600_000)
    throw new HttpError(400, 'VALIDATION_ERROR', 'Leave at least an hour for entries.');
}

export async function createCompetition(userId: string, input: CompetitionInput) {
  await assertOrganiser(userId);
  const now = await dbNow();
  checkDates(new Date(input.opensAt), new Date(input.closesAt), now);
  const slug = await prisma.$transaction(async (tx) => {
    if (input.coverId) await requireAttachable(userId, input.coverId, 'COMPETITION', ['IMAGE'], tx);
    const base = slugify(input.title);
    const slug = (await tx.competition.findUnique({ where: { slug: base }, select: { id: true } }))
      ? `${base.slice(0, 50)}-${randomBytes(3).toString('hex')}`
      : base;
    const c = await tx.competition.create({
      data: {
        slug,
        organiserId: userId,
        title: input.title,
        description: input.description,
        category: input.category,
        eligibility: input.eligibility,
        prize: input.prize,
        prizePlaces: input.prizePlaces,
        judgingMethod: input.judgingMethod,
        disqualification: input.disqualification,
        disputeProcess: input.disputeProcess,
        formats: input.formats,
        criteria: input.criteria,
        opensAt: new Date(input.opensAt),
        closesAt: new Date(input.closesAt),
        coverAssetId: input.coverId ?? null,
      },
    });
    await tx.competitionRules.create({ data: { competitionId: c.id, version: 1, rules: input.rules } });
    return slug;
  });
  return competitionDetail(slug, userId);
}

/**
 * Edits. Drafts change freely. Once published: dates and criteria are fixed (entrants relied on
 * them; use an extension instead), and a rules change creates a new version — entrants are told and
 * must accept the new version if they update their entry.
 */
export async function updateCompetition(userId: string, slug: string, input: z.output<typeof updateCompetitionSchema>) {
  const c = await ownCompetition(userId, slug);
  const now = await dbNow();
  if (c.status === 'RESULTS_PUBLISHED' || c.status === 'CANCELLED')
    throw new HttpError(409, 'CLOSED', 'This competition can no longer be edited.');
  const published = c.status === 'PUBLISHED';
  if (published && (input.opensAt || input.closesAt || input.criteria || input.formats || input.prizePlaces)) {
    throw new HttpError(
      409,
      'LOCKED_AFTER_PUBLISH',
      'Dates, criteria, entry formats and prize places are fixed once published. Use an extension for more time.',
    );
  }
  if (!published && (input.opensAt || input.closesAt))
    checkDates(new Date(input.opensAt ?? c.opensAt), new Date(input.closesAt ?? c.closesAt), now);
  const rulesChanged = input.rules !== undefined && input.rules !== (await currentRules(c));
  const oldCover = c.coverAssetId;
  await prisma.$transaction(async (tx) => {
    if (input.coverId) await requireAttachable(userId, input.coverId, 'COMPETITION', ['IMAGE'], tx);
    const version = rulesChanged ? (published ? c.rulesVersion + 1 : c.rulesVersion) : c.rulesVersion;
    await tx.competition.update({
      where: { id: c.id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.category !== undefined && { category: input.category }),
        ...(input.eligibility !== undefined && { eligibility: input.eligibility }),
        ...(input.prize !== undefined && { prize: input.prize }),
        ...(input.prizePlaces !== undefined && { prizePlaces: input.prizePlaces }),
        ...(input.judgingMethod !== undefined && { judgingMethod: input.judgingMethod }),
        ...(input.disqualification !== undefined && { disqualification: input.disqualification }),
        ...(input.disputeProcess !== undefined && { disputeProcess: input.disputeProcess }),
        ...(input.formats !== undefined && { formats: input.formats }),
        ...(input.criteria !== undefined && { criteria: input.criteria }),
        ...(input.opensAt !== undefined && { opensAt: new Date(input.opensAt) }),
        ...(input.closesAt !== undefined && { closesAt: new Date(input.closesAt) }),
        ...(input.coverId !== undefined && { coverAssetId: input.coverId }),
        rulesVersion: version,
      },
    });
    if (rulesChanged) {
      if (published) {
        await tx.competitionRules.create({ data: { competitionId: c.id, version, rules: input.rules! } });
        const entrants = await tx.competitionEntry.findMany({
          where: { competitionId: c.id, status: 'SUBMITTED' },
          select: { participantId: true },
        });
        for (const e of entrants) {
          await notify(tx, e.participantId, {
            type: 'competition.rules_updated',
            title: `The rules of “${c.title}” changed`,
            body: 'Your entry stays valid under the rules you accepted. Read the new version before you change it.',
            link: `/competitions/${c.slug}`,
          });
        }
      } else {
        await tx.competitionRules.update({
          where: { competitionId_version: { competitionId: c.id, version } },
          data: { rules: input.rules! },
        });
      }
    }
  });
  if (input.coverId !== undefined && oldCover && oldCover !== input.coverId) await releaseAssets([oldCover]);
  return competitionDetail(c.slug, userId);
}

export async function publishCompetition(userId: string, slug: string) {
  await assertOrganiser(userId);
  const c = await ownCompetition(userId, slug);
  if (c.status !== 'DRAFT') throw new HttpError(409, 'NOT_DRAFT', 'Only drafts can be published.');
  const now = await dbNow();
  if ((c.extendedUntil ?? c.closesAt) <= now)
    throw new HttpError(409, 'DATES_PASSED', 'The closing date has passed. Change the dates first.');
  await prisma.$transaction(async (tx) => {
    await tx.competition.update({ where: { id: c.id }, data: { status: 'PUBLISHED', publishedAt: now } });
    await writeAudit(tx, {
      actor: { id: userId, role: 'organiser' },
      action: 'competition.publish',
      target: { type: 'competition', id: c.id },
      after: { slug: c.slug, opensAt: c.opensAt.toISOString(), closesAt: c.closesAt.toISOString() },
    });
  });
  return competitionDetail(c.slug, userId);
}

/** COMP-006: more time only through a recorded, reasoned extension (audited; entrants told). */
export async function extendCompetition(userId: string, slug: string, until: Date, reason: string) {
  const c = await ownCompetition(userId, slug);
  const now = await dbNow();
  if (c.status !== 'PUBLISHED') throw new HttpError(409, 'NOT_PUBLISHED', 'Only published competitions can be extended.');
  if (until <= (c.extendedUntil ?? c.closesAt) || until <= now)
    throw new HttpError(400, 'VALIDATION_ERROR', 'The new closing time must be later than the current one.');
  await prisma.$transaction(async (tx) => {
    await tx.competition.update({ where: { id: c.id }, data: { extendedUntil: until, extensionReason: reason } });
    await writeAudit(tx, {
      actor: { id: userId, role: 'organiser' },
      action: 'competition.extend',
      target: { type: 'competition', id: c.id },
      reason,
      before: { closesAt: (c.extendedUntil ?? c.closesAt).toISOString() },
      after: { closesAt: until.toISOString() },
    });
    const entrants = await tx.competitionEntry.findMany({
      where: { competitionId: c.id, status: 'SUBMITTED' },
      select: { participantId: true },
    });
    for (const e of entrants) {
      await notify(tx, e.participantId, {
        type: 'competition.extended',
        title: `More time for “${c.title}”`,
        body: `Entries now close ${until.toUTCString()}. ${reason}`,
        link: `/competitions/${c.slug}`,
      });
    }
  });
  return competitionDetail(c.slug, userId);
}

export async function cancelCompetition(userId: string, slug: string, reason: string) {
  const c = await ownCompetition(userId, slug);
  if (c.status === 'RESULTS_PUBLISHED' || c.status === 'CANCELLED')
    throw new HttpError(409, 'CLOSED', 'This competition is already finished.');
  await prisma.$transaction(async (tx) => {
    await tx.competition.update({ where: { id: c.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason } });
    await writeAudit(tx, {
      actor: { id: userId, role: 'organiser' },
      action: 'competition.cancel',
      target: { type: 'competition', id: c.id },
      reason,
    });
    const entrants = await tx.competitionEntry.findMany({
      where: { competitionId: c.id, status: 'SUBMITTED' },
      select: { participantId: true },
    });
    for (const e of entrants) {
      await notify(tx, e.participantId, {
        type: 'competition.cancelled',
        title: `“${c.title}” was cancelled`,
        body: reason,
        link: `/competitions/${c.slug}`,
      });
    }
  });
  return competitionDetail(c.slug, userId);
}

export async function addJudge(userId: string, slug: string, username: string) {
  const c = await ownCompetition(userId, slug);
  if (c.status === 'RESULTS_PUBLISHED' || c.status === 'CANCELLED') throw new HttpError(409, 'CLOSED', 'Judging has finished.');
  const judge = await prisma.user.findFirst({ where: { username, ...visibleUser }, select: { id: true } });
  if (!judge) throw new HttpError(404, 'USER_NOT_FOUND', 'No member with that username.');
  if (judge.id === userId) throw new HttpError(400, 'ORGANISER_JUDGES', 'As organiser you can already score entries.');
  if (await prisma.competitionEntry.count({ where: { competitionId: c.id, participantId: judge.id, status: { not: 'WITHDRAWN' } } })) {
    throw new HttpError(409, 'CONFLICT_OF_INTEREST', 'Someone who entered can’t judge.');
  }
  await prisma.$transaction(async (tx) => {
    await tx.competitionJudge.createMany({ data: [{ competitionId: c.id, userId: judge.id }], skipDuplicates: true });
    await notify(tx, judge.id, {
      type: 'competition.judge',
      title: `You’re a judge for “${c.title}”`,
      body: 'You can score entries once entries close.',
      link: `/competitions/${c.slug}/judging`,
      dedupeKey: `judge:${c.id}:${judge.id}`,
    });
  });
  return competitionDetail(c.slug, userId);
}

export async function removeJudge(userId: string, slug: string, username: string) {
  const c = await ownCompetition(userId, slug);
  if (c.status === 'RESULTS_PUBLISHED') throw new HttpError(409, 'CLOSED', 'Judging has finished.');
  const judge = await prisma.user.findFirst({ where: { username }, select: { id: true } });
  if (judge) {
    await prisma.$transaction([
      prisma.judgement.deleteMany({ where: { judgeId: judge.id, entry: { competitionId: c.id } } }),
      prisma.competitionJudge.deleteMany({ where: { competitionId: c.id, userId: judge.id } }),
    ]);
  }
  return competitionDetail(c.slug, userId);
}

// ── Entries ──────────────────────────────────────────────────

/** Enter or update your entry while entries are open (one per person; rules version recorded). */
export async function submitEntry(userId: string, slug: string, input: z.output<typeof entryInputSchema>) {
  const c = await requireVisible(slug, userId);
  const detail = await competitionDetail(slug, userId);
  if (!detail.viewer.canEnter) throw new HttpError(409, 'CANNOT_ENTER', detail.viewer.cannotEnterReason ?? 'You can’t enter.');
  if (input.acceptedRulesVersion !== c.rulesVersion) {
    throw new HttpError(409, 'RULES_CHANGED', 'The rules have changed since you read them. Read the current rules and accept them.');
  }
  if (!input.mediaId && !input.externalUrl) throw new HttpError(400, 'VALIDATION_ERROR', 'Add your work: an upload or a link.');
  if (input.externalUrl && !c.formats.includes('LINK'))
    throw new HttpError(400, 'FORMAT_NOT_ALLOWED', 'This competition doesn’t accept links.');
  const result = await prisma.$transaction(async (tx) => {
    // Re-check the deadline inside the transaction with database time (no late entries).
    const now = await dbNow(tx);
    if (phaseAt(c, now) !== 'OPEN') throw new HttpError(409, 'CLOSED', 'Entries are closed.');
    if (input.mediaId) {
      const kinds = c.formats.filter((f) => f !== 'LINK') as ('AUDIO' | 'VIDEO' | 'IMAGE')[];
      if (kinds.length === 0) throw new HttpError(400, 'FORMAT_NOT_ALLOWED', 'This competition only accepts links.');
      const existing = await tx.competitionEntry.findUnique({
        where: { competitionId_participantId: { competitionId: c.id, participantId: userId } },
      });
      if (existing?.mediaAssetId !== input.mediaId) await requireAttachable(userId, input.mediaId, 'COMPETITION', kinds, tx);
    }
    const data = {
      title: input.title,
      description: input.description ?? null,
      mediaAssetId: input.mediaId ?? null,
      externalUrl: input.externalUrl ?? null,
      rulesVersion: input.acceptedRulesVersion,
      status: 'SUBMITTED' as const,
      submittedAt: now,
    };
    const entry = await tx.competitionEntry.upsert({
      where: { competitionId_participantId: { competitionId: c.id, participantId: userId } },
      create: { competitionId: c.id, participantId: userId, ...data },
      update: data,
    });
    await notify(tx, userId, {
      type: 'competition.entry_received',
      title: `Entry received: “${c.title}”`,
      body: `“${input.title}” was submitted ${now.toUTCString()} under rules version ${input.acceptedRulesVersion}.`,
      link: `/competitions/${c.slug}`,
    });
    return entry;
  });
  return entryFor(userId, result.id);
}

export async function withdrawEntry(userId: string, slug: string) {
  const c = await requireVisible(slug, userId);
  const now = await dbNow();
  if (phaseAt(c, now) !== 'OPEN') throw new HttpError(409, 'CLOSED', 'Entries can only be withdrawn while the competition is open.');
  const { count } = await prisma.competitionEntry.updateMany({
    where: { competitionId: c.id, participantId: userId, status: 'SUBMITTED' },
    data: { status: 'WITHDRAWN' },
  });
  if (count === 0) throw new HttpError(404, 'ENTRY_NOT_FOUND', 'You have no entry to withdraw.');
  return { withdrawn: true };
}

const entryInclude = {
  participant: { select: personSelect },
  mediaAsset: true,
  judgements: { include: { judge: { select: { id: true, ...personSelect } } } },
  competition: true,
} satisfies Prisma.CompetitionEntryInclude;
type EntryRow = Prisma.CompetitionEntryGetPayload<{ include: typeof entryInclude }>;

/** Who sees which judgements: organiser all; a judge their own; the entrant all, once results are out. */
function toEntryView(e: EntryRow, viewerId: string): EntryView {
  const c = e.competition;
  const organiser = viewerId === c.organiserId;
  const own = viewerId === e.participantId;
  const visible = e.judgements.filter((j) => organiser || j.judgeId === viewerId || (own && c.status === 'RESULTS_PUBLISHED'));
  const totals = e.judgements.map((j) => j.total);
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    participant: toPerson(e.participant),
    externalUrl: e.externalUrl,
    media: e.mediaAsset ? toMediaView(e.mediaAsset) : null,
    rulesVersion: e.rulesVersion,
    status: e.status,
    disqualifiedReason: e.disqualifiedReason,
    submittedAt: e.submittedAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    judgements: visible.map((j) => ({
      judge: organiser || j.judgeId === viewerId ? toPerson(j.judge) : null,
      scores: j.scores as Record<string, number>,
      total: j.total,
      feedback: j.feedback,
    })),
    averageScore: organiser && totals.length ? Math.round((totals.reduce((a, b) => a + b, 0) / totals.length) * 100) / 100 : null,
  };
}

async function entryFor(viewerId: string, entryId: string) {
  const e = await prisma.competitionEntry.findUniqueOrThrow({ where: { id: entryId }, include: entryInclude });
  return toEntryView(e, viewerId);
}

/** Your own entry (participant), with feedback once results are published. */
export async function myEntry(userId: string, slug: string) {
  const c = await requireVisible(slug, userId);
  const e = await prisma.competitionEntry.findUnique({
    where: { competitionId_participantId: { competitionId: c.id, participantId: userId } },
    include: entryInclude,
  });
  if (!e || e.status === 'WITHDRAWN') throw new HttpError(404, 'ENTRY_NOT_FOUND', 'You haven’t entered this competition.');
  return toEntryView(e, userId);
}

async function assertCanJudge(userId: string, c: Competition) {
  if (c.organiserId === userId) return;
  const j = await prisma.competitionJudge.count({ where: { competitionId: c.id, userId } });
  if (!j) throw new HttpError(403, 'NOT_A_JUDGE', 'Only the organiser and assigned judges can see entries.');
}

/** Organiser and judges: every entry (judges see entries only after closing, to judge them). */
export async function listEntries(userId: string, slug: string) {
  const c = await requireCompetition(slug);
  await assertCanJudge(userId, c);
  const now = await dbNow();
  if (c.organiserId !== userId && phaseAt(c, now) === 'OPEN') throw new HttpError(409, 'NOT_YET', 'Judging starts when entries close.');
  const rows = await prisma.competitionEntry.findMany({
    where: { competitionId: c.id, status: { not: 'WITHDRAWN' }, removedAt: null },
    include: entryInclude,
    orderBy: { submittedAt: 'asc' },
  });
  return { phase: phaseAt(c, now), criteria: c.criteria as unknown as Criterion[], items: rows.map((e) => toEntryView(e, userId)) };
}

/** Score an entry against the published criteria; editable until results are published. */
export async function scoreEntry(userId: string, entryId: string, scores: Record<string, number>, feedback?: string) {
  const e = await prisma.competitionEntry.findFirst({ where: { id: entryId, removedAt: null }, include: { competition: true } });
  if (!e) throw new HttpError(404, 'ENTRY_NOT_FOUND', 'Entry not found');
  const c = e.competition;
  await assertCanJudge(userId, c);
  const now = await dbNow();
  if (phaseAt(c, now) !== 'JUDGING')
    throw new HttpError(
      409,
      c.status === 'RESULTS_PUBLISHED' ? 'RESULTS_FINAL' : 'NOT_YET',
      c.status === 'RESULTS_PUBLISHED' ? 'Results are published; scores are final.' : 'Scoring opens when entries close.',
    );
  if (e.status !== 'SUBMITTED') throw new HttpError(409, 'NOT_SCORABLE', 'This entry isn’t in the running.');
  if (e.participantId === userId) throw new HttpError(409, 'CONFLICT_OF_INTEREST', 'You can’t score your own entry.');
  const criteria = c.criteria as unknown as Criterion[];
  const unknown = Object.keys(scores).filter((k) => !criteria.some((cr) => cr.name === k));
  if (unknown.length || criteria.some((cr) => scores[cr.name] === undefined)) {
    throw new HttpError(400, 'VALIDATION_ERROR', `Score every criterion: ${criteria.map((cr) => cr.name).join(', ')}.`);
  }
  const total = weightedTotal(criteria, scores);
  await prisma.judgement.upsert({
    where: { entryId_judgeId: { entryId, judgeId: userId } },
    create: { entryId, judgeId: userId, scores, total, feedback: feedback || null },
    update: { scores, total, feedback: feedback || null },
  });
  return entryFor(userId, entryId);
}

export async function disqualifyEntry(userId: string, entryId: string, reason: string) {
  const e = await prisma.competitionEntry.findFirst({ where: { id: entryId }, include: { competition: true } });
  if (!e || e.competition.organiserId !== userId) throw new HttpError(404, 'ENTRY_NOT_FOUND', 'Entry not found');
  if (e.competition.status !== 'PUBLISHED') throw new HttpError(409, 'RESULTS_FINAL', 'Results are already published.');
  await prisma.$transaction(async (tx) => {
    await tx.competitionEntry.update({ where: { id: entryId }, data: { status: 'DISQUALIFIED', disqualifiedReason: reason } });
    await writeAudit(tx, {
      actor: { id: userId, role: 'organiser' },
      action: 'competition.entry.disqualify',
      target: { type: 'competition_entry', id: entryId },
      reason,
    });
    await notify(tx, e.participantId, {
      type: 'competition.disqualified',
      title: `Your entry to “${e.competition.title}” was disqualified`,
      body: reason,
      link: `/competitions/${e.competition.slug}`,
    });
  });
  return entryFor(userId, entryId);
}

/**
 * Publish results (organiser, after closing): every assigned judge (or the organiser if there are
 * none) must have scored every eligible entry. Placements come from the published ranking rule;
 * scores are frozen from here on. Entrants are notified; the record is audited.
 */
export async function publishResults(userId: string, slug: string) {
  const c = await ownCompetition(userId, slug);
  const now = await dbNow();
  if (phaseAt(c, now) !== 'JUDGING')
    throw new HttpError(
      409,
      'NOT_JUDGING',
      c.status === 'RESULTS_PUBLISHED' ? 'Results are already published.' : 'Results can be published after entries close.',
    );
  const entries = await prisma.competitionEntry.findMany({
    where: { competitionId: c.id, status: 'SUBMITTED', removedAt: null },
    include: { judgements: true },
  });
  const judges = (await prisma.competitionJudge.findMany({ where: { competitionId: c.id } })).map((j) => j.userId);
  const scorers = judges.length ? judges : [userId];
  const missing = entries.filter((e) => scorers.some((s) => !e.judgements.some((j) => j.judgeId === s)));
  if (missing.length)
    throw new HttpError(
      409,
      'JUDGING_INCOMPLETE',
      `${missing.length} ${missing.length === 1 ? 'entry still needs' : 'entries still need'} scores from every judge.`,
    );
  const ranked = rankEntries(
    entries.map((e) => ({
      id: e.id,
      submittedAt: e.submittedAt,
      totals: e.judgements.filter((j) => scorers.includes(j.judgeId)).map((j) => j.total),
    })),
    c.prizePlaces,
  );
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.competition.updateMany({
      where: { id: c.id, status: 'PUBLISHED' },
      data: { status: 'RESULTS_PUBLISHED', resultsPublishedAt: now },
    });
    if (count !== 1) throw new HttpError(409, 'NOT_JUDGING', 'Results are already published.');
    await tx.competitionResult.createMany({
      data: ranked.map((r) => ({ competitionId: c.id, entryId: r.id, placement: r.placement, averageScore: r.average })),
    });
    await writeAudit(tx, {
      actor: { id: userId, role: 'organiser' },
      action: 'competition.results.publish',
      target: { type: 'competition', id: c.id },
      after: { results: ranked },
    });
    const placed = new Map(ranked.map((r) => [r.id, r.placement]));
    for (const e of entries) {
      const p = placed.get(e.id);
      await notify(tx, e.participantId, {
        type: 'competition.results',
        title: p ? `You placed #${p} in “${c.title}”` : `Results are out: “${c.title}”`,
        body: p ? 'Congratulations. See the results and the judges’ feedback.' : 'See the winners and the judges’ feedback on your entry.',
        link: `/competitions/${c.slug}`,
      });
    }
  });
  return competitionDetail(c.slug, userId);
}

// ── Disputes (D9: decided by an ADMIN) ───────────────────────

export async function openDispute(userId: string, slug: string, reason: string) {
  const detail = await competitionDetail(slug, userId);
  if (!detail.viewer.canDispute)
    throw new HttpError(409, 'CANNOT_DISPUTE', 'Disputes are open to entrants for 7 days after results, once per person.');
  const c = await requireCompetition(slug);
  const d = await prisma.competitionDispute.create({ data: { competitionId: c.id, userId, reason } });
  await notify(prisma, c.organiserId, {
    type: 'competition.dispute_opened',
    title: `A result of “${c.title}” is disputed`,
    body: 'MuzikHub staff will review it and record a decision.',
    link: `/competitions/${c.slug}`,
  });
  return { id: d.id, status: d.status };
}

export async function listDisputes(status: 'OPEN' | 'UPHELD' | 'REJECTED' | undefined) {
  const rows = await prisma.competitionDispute.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: 'asc' },
    take: 100,
    include: { user: { select: personSelect }, competition: { select: { slug: true, title: true } } },
  });
  return {
    items: rows.map((d) => ({
      id: d.id,
      status: d.status,
      reason: d.reason,
      resolution: d.resolution,
      createdAt: d.createdAt.toISOString(),
      resolvedAt: d.resolvedAt?.toISOString() ?? null,
      user: toPerson(d.user),
      competition: d.competition,
    })),
  };
}

/** The decision is recorded and audited; it never silently changes published results (§19.3). */
export async function resolveDispute(staff: StaffContext, id: string, outcome: 'UPHELD' | 'REJECTED', resolution: string) {
  return prisma.$transaction(async (tx) => {
    const d = await tx.competitionDispute.findUnique({ where: { id }, include: { competition: true } });
    if (!d) throw new HttpError(404, 'NOT_FOUND', 'Dispute not found');
    if (d.status !== 'OPEN') throw new HttpError(409, 'ALREADY_DECIDED', 'This dispute has already been decided.');
    await tx.competitionDispute.update({
      where: { id },
      data: { status: outcome, resolution, resolvedById: staff.id, resolvedAt: new Date() },
    });
    await writeAudit(tx, {
      actor: { id: staff.id, role: staff.role, ip: staff.ip },
      action: 'competition.dispute.resolve',
      target: { type: 'competition_dispute', id },
      reason: resolution,
      before: { status: 'OPEN' },
      after: { status: outcome },
    });
    for (const uid of [d.userId, d.competition.organiserId]) {
      await notify(tx, uid, {
        type: 'competition.dispute_decided',
        title: `Dispute decided: “${d.competition.title}”`,
        body: `${outcome === 'UPHELD' ? 'Upheld' : 'Not upheld'}. ${resolution}`,
        link: `/competitions/${d.competition.slug}`,
      });
    }
    return { id, status: outcome };
  });
}

export const phaseLabel = (c: Competition, now: Date) => PHASE_LABELS[phaseAt(c, now)];
