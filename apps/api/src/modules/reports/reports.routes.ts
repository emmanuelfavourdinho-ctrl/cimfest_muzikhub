import { Router } from 'express';
import { createReportSchema, type CreateReportInput } from '@muzikhub/shared';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import { currentUserId, requireAuth } from '../../middleware/require-auth.js';
import { validateBody } from '../../middleware/validate.js';
import { limits } from '../../lib/rate-limit.js';
import { idempotent } from '../../middleware/idempotency.js';

/** Who owns the reported thing, or null if it doesn't exist. */
async function targetOwner(input: CreateReportInput): Promise<string | null> {
  switch (input.targetType) {
    case 'POST':
      return (await prisma.post.findUnique({ where: { id: input.targetId }, select: { authorId: true } }))?.authorId ?? null;
    case 'COMMENT':
      return (await prisma.comment.findUnique({ where: { id: input.targetId }, select: { authorId: true } }))?.authorId ?? null;
    case 'PORTFOLIO_ITEM':
      return (await prisma.portfolioItem.findUnique({ where: { id: input.targetId }, select: { ownerId: true } }))?.ownerId ?? null;
    case 'PROFILE':
      return (await prisma.user.findUnique({ where: { username: input.targetId.toLowerCase() }, select: { id: true } }))?.id ?? null;
  }
}

/**
 * POST /api/v1/reports — stores a report for the moderation queue (Milestone 5).
 * Reporting the same thing twice is a no-op, so the button is safe to retry.
 */
export function reportsRouter(): Router {
  const router = Router();
  router.post('/', requireAuth, limits.report, validateBody(createReportSchema), idempotent(), async (req, res) => {
    const reporterId = currentUserId(res.locals);
    const input = req.body as CreateReportInput;
    const owner = await targetOwner(input);
    if (!owner) throw new HttpError(404, 'REPORT_TARGET_NOT_FOUND', 'That content no longer exists');
    if (owner === reporterId) throw new HttpError(400, 'CANNOT_REPORT_SELF', "You can't report your own content");
    const targetId = input.targetType === 'PROFILE' ? owner : input.targetId;
    await prisma.report.createMany({
      data: [{ reporterId, targetType: input.targetType, targetId, reason: input.reason, details: input.details ?? null }],
      skipDuplicates: true,
    });
    res.status(201).json({ reported: true });
  });
  return router;
}
