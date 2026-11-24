import { prisma } from '../../lib/prisma.js';
import { registerModerationTarget, registerReportDescriber } from '../admin/moderation-registry.js';
import { personSelect, toPerson } from '../profiles/people.js';
import { registerReportTarget } from '../reports/reports.routes.js';

let done = false;
/** Competitions and entries join the one platform moderation flow (reports queue + remove/restore). */
export function registerCompetitionIntegrations() {
  if (done) return;
  done = true;
  registerReportTarget('COMPETITION', async (id) => {
    const c = await prisma.competition.findFirst({
      where: { id, removedAt: null, status: { not: 'DRAFT' } },
      select: { organiserId: true },
    });
    return c?.organiserId ?? null;
  });
  registerReportTarget('COMPETITION_ENTRY', async (id, reporterId) => {
    const e = await prisma.competitionEntry.findFirst({
      where: { id, removedAt: null },
      include: { competition: { include: { judges: true } } },
    });
    if (!e) return null;
    // Entries are visible to the organiser and judges, and to everyone once they are placed.
    const placed = await prisma.competitionResult.count({ where: { entryId: id } });
    const canSee = placed > 0 || e.competition.organiserId === reporterId || e.competition.judges.some((j) => j.userId === reporterId);
    return canSee ? e.participantId : null;
  });
  registerModerationTarget('competition', {
    async load(id) {
      const c = await prisma.competition.findUnique({ where: { id } });
      return (
        c && { ownerId: c.organiserId, removedAt: c.removedAt, removalReason: c.removalReason, summary: { title: c.title, slug: c.slug } }
      );
    },
    async apply(tx, id, data) {
      await tx.competition.update({ where: { id }, data });
    },
  });
  registerModerationTarget('competition-entry', {
    async load(id) {
      const e = await prisma.competitionEntry.findUnique({ where: { id } });
      return e && { ownerId: e.participantId, removedAt: e.removedAt, removalReason: e.removalReason, summary: { title: e.title } };
    },
    async apply(tx, id, data) {
      await tx.competitionEntry.update({ where: { id }, data });
    },
  });
  registerReportDescriber('COMPETITION', async (ids) => {
    const rows = await prisma.competition.findMany({
      where: { id: { in: ids } },
      include: { organiser: { select: { id: true, ...personSelect } } },
    });
    return new Map(
      rows.map((c) => [
        c.id,
        {
          exists: true,
          removed: Boolean(c.removedAt),
          removalReason: c.removalReason,
          ownerId: c.organiserId,
          owner: toPerson(c.organiser),
          title: `Competition: ${c.title}`,
          text: c.description.slice(0, 300),
          media: [],
          link: `/competitions/${c.slug}`,
          moderationType: 'competition',
        },
      ]),
    );
  });
  registerReportDescriber('COMPETITION_ENTRY', async (ids) => {
    const rows = await prisma.competitionEntry.findMany({
      where: { id: { in: ids } },
      include: { participant: { select: { id: true, ...personSelect } }, competition: { select: { slug: true, title: true } } },
    });
    return new Map(
      rows.map((e) => [
        e.id,
        {
          exists: true,
          removed: Boolean(e.removedAt),
          removalReason: e.removalReason,
          ownerId: e.participantId,
          owner: toPerson(e.participant),
          title: `Entry “${e.title}” in ${e.competition.title}`,
          text: e.description,
          media: [],
          link: `/competitions/${e.competition.slug}`,
          moderationType: 'competition-entry',
        },
      ]),
    );
  });
}
