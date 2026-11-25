import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Lets feature modules (communities, competitions, messaging) plug their content into the ONE
 * platform moderation flow: the reports queue shows it, and staff remove/restore it with a reason,
 * audited, exactly like posts and comments. No feature has its own staff moderation path.
 */
export interface Removable {
  ownerId: string;
  removedAt: Date | null;
  removalReason: string | null;
  summary: Record<string, unknown>;
}
export interface ModerationTargetHandler {
  load(id: string): Promise<Removable | null>;
  apply(
    tx: Prisma.TransactionClient,
    id: string,
    data: { removedAt: Date | null; removedById: string | null; removalReason: string | null },
  ): Promise<void>;
}
/** How a report target looks in the queue (same shape as the built-in describers). */
export type ReportDescriber = (ids: string[]) => Promise<Map<string, Record<string, unknown>>>;

const handlers = new Map<string, ModerationTargetHandler>();
const describers = new Map<string, ReportDescriber>();

export function registerModerationTarget(type: string, handler: ModerationTargetHandler) {
  handlers.set(type, handler);
}
export function registerReportDescriber(reportTargetType: string, describe: ReportDescriber) {
  describers.set(reportTargetType, describe);
}
export const moderationHandler = (type: string) => handlers.get(type);
export const reportDescribers = () => describers;
