/**
 * Media housekeeping — run on a schedule (e.g. a Render cron job, daily):
 *   npm run media:cleanup
 * Retries failed Cloudinary deletions and removes uploads older than 24 h that were
 * never confirmed or never attached to a profile, portfolio item or post.
 */
import { prisma } from '../lib/prisma.js';
import { cleanupMedia } from '../modules/media/media.service.js';

const result = await cleanupMedia();
console.log(`Media cleanup: ${result.removed} removed, ${result.failed} will be retried (of ${result.attempted}).`);
await prisma.$disconnect();
process.exit(result.failed > 0 ? 1 : 0);
