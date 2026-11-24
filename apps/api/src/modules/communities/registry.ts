import { prisma } from '../../lib/prisma.js';
import { registerModerationTarget, registerReportDescriber } from '../admin/moderation-registry.js';
import { personSelect, toPerson } from '../profiles/people.js';
import { registerReportTarget } from '../reports/reports.routes.js';
import { canRead } from './permissions.js';
import { membershipOf } from './communities.service.js';

/** Reports on community content: the reporter must be able to see it (else it's "not found"). */
let done = false;
export function registerCommunityIntegrations() {
  if (done) return;
  done = true;
  registerCommunityModeration();
  registerReportTarget('COMMUNITY', async (id) => {
    const c = await prisma.community.findFirst({ where: { id, removedAt: null }, select: { createdById: true } });
    return c?.createdById ?? null;
  });
  registerReportTarget('DISCUSSION', async (id, reporterId) => {
    const d = await prisma.discussion.findFirst({ where: { id, removedAt: null }, include: { community: true } });
    if (!d || !canRead(d.community.policy, await membershipOf(d.communityId, reporterId))) return null;
    return d.authorId;
  });
  registerReportTarget('DISCUSSION_COMMENT', async (id, reporterId) => {
    const c = await prisma.discussionComment.findFirst({
      where: { id, removedAt: null },
      include: { discussion: { include: { community: true } } },
    });
    if (!c || !canRead(c.discussion.community.policy, await membershipOf(c.discussion.communityId, reporterId))) return null;
    return c.authorId;
  });
}

/** Platform moderation (staff) for communities, discussions and replies. */
export function registerCommunityModeration() {
  const excerpt = (t: string, n = 200) => (t.length > n ? `${t.slice(0, n)}…` : t);
  registerModerationTarget('community', {
    async load(id) {
      const c = await prisma.community.findUnique({ where: { id } });
      return (
        c && { ownerId: c.createdById, removedAt: c.removedAt, removalReason: c.removalReason, summary: { name: c.name, slug: c.slug } }
      );
    },
    async apply(tx, id, data) {
      await tx.community.update({ where: { id }, data });
    },
  });
  registerModerationTarget('discussion', {
    async load(id) {
      const d = await prisma.discussion.findUnique({ where: { id } });
      return (
        d && {
          ownerId: d.authorId,
          removedAt: d.removedAt,
          removalReason: d.removalReason,
          summary: { title: d.title, excerpt: excerpt(d.body) },
        }
      );
    },
    async apply(tx, id, data) {
      await tx.discussion.update({ where: { id }, data });
    },
  });
  registerModerationTarget('discussion-comment', {
    async load(id) {
      const c = await prisma.discussionComment.findUnique({ where: { id } });
      return c && { ownerId: c.authorId, removedAt: c.removedAt, removalReason: c.removalReason, summary: { excerpt: excerpt(c.body) } };
    },
    async apply(tx, id, data) {
      await tx.discussionComment.update({ where: { id }, data });
    },
  });
  const person = { id: true, ...personSelect };
  registerReportDescriber('COMMUNITY', async (ids) => {
    const rows = await prisma.community.findMany({ where: { id: { in: ids } }, include: { createdBy: { select: person } } });
    return new Map(
      rows.map((c) => [
        c.id,
        {
          exists: true,
          removed: Boolean(c.removedAt),
          removalReason: c.removalReason,
          ownerId: c.createdById,
          owner: toPerson(c.createdBy),
          title: `Community: ${c.name}`,
          text: excerpt(c.description),
          media: [],
          link: `/communities/${c.slug}`,
          moderationType: 'community',
        },
      ]),
    );
  });
  registerReportDescriber('DISCUSSION', async (ids) => {
    const rows = await prisma.discussion.findMany({
      where: { id: { in: ids } },
      include: { author: { select: person }, community: { select: { slug: true, name: true } } },
    });
    return new Map(
      rows.map((d) => [
        d.id,
        {
          exists: true,
          removed: Boolean(d.removedAt),
          removalReason: d.removalReason,
          ownerId: d.authorId,
          owner: toPerson(d.author),
          title: `${d.title} (in ${d.community.name})`,
          text: excerpt(d.body),
          media: [],
          link: `/communities/${d.community.slug}/d/${d.id}`,
          moderationType: 'discussion',
        },
      ]),
    );
  });
  registerReportDescriber('DISCUSSION_COMMENT', async (ids) => {
    const rows = await prisma.discussionComment.findMany({
      where: { id: { in: ids } },
      include: { author: { select: person }, discussion: { select: { id: true, title: true, community: { select: { slug: true } } } } },
    });
    return new Map(
      rows.map((c) => [
        c.id,
        {
          exists: true,
          removed: Boolean(c.removedAt),
          removalReason: c.removalReason,
          ownerId: c.authorId,
          owner: toPerson(c.author),
          title: `Reply in “${c.discussion.title}”`,
          text: excerpt(c.body),
          media: [],
          link: `/communities/${c.discussion.community.slug}/d/${c.discussion.id}`,
          moderationType: 'discussion-comment',
        },
      ]),
    );
  });
}
