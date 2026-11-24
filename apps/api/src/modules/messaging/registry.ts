import { prisma } from '../../lib/prisma.js';
import { registerModerationTarget, registerReportDescriber } from '../admin/moderation-registry.js';
import { personSelect, toPerson } from '../profiles/people.js';
import { registerReportTarget } from '../reports/reports.routes.js';

/**
 * Messages are private (MSG-007). Staff see a message's content only when a participant reports
 * it, through the reports queue (the authorised safety workflow); there is no staff inbox view.
 */
let done = false;
export function registerMessagingIntegrations() {
  if (done) return;
  done = true;
  registerReportTarget('MESSAGE', async (id, reporterId) => {
    const m = await prisma.message.findFirst({
      where: { id, removedAt: null, conversation: { participants: { some: { userId: reporterId } } } },
      select: { senderId: true },
    });
    return m?.senderId ?? null;
  });
  registerModerationTarget('message', {
    async load(id) {
      const m = await prisma.message.findUnique({ where: { id } });
      return (
        m && { ownerId: m.senderId, removedAt: m.removedAt, removalReason: m.removalReason, summary: { excerpt: m.body.slice(0, 200) } }
      );
    },
    async apply(tx, id, data) {
      await tx.message.update({ where: { id }, data });
    },
  });
  registerReportDescriber('MESSAGE', async (ids) => {
    const rows = await prisma.message.findMany({
      where: { id: { in: ids } },
      include: { sender: { select: { id: true, ...personSelect } } },
    });
    return new Map(
      rows.map((m) => [
        m.id,
        {
          exists: true,
          removed: Boolean(m.removedAt),
          removalReason: m.removalReason,
          ownerId: m.senderId,
          owner: toPerson(m.sender),
          title: 'Private message (reported by a participant)',
          text: m.body.length > 500 ? `${m.body.slice(0, 500)}…` : m.body,
          media: [],
          moderationType: 'message',
        },
      ]),
    );
  });
}
