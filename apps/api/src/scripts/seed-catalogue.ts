/**
 * Seeds the owner-confirmed catalogue (packages/shared/src/billing.ts CATALOGUE_SEED), all rows
 * INACTIVE. Idempotent: only adds (product, option) pairs with no row yet; never changes prices.
 *   npm run catalogue:seed -w @muzikhub/api
 */
import { seedCatalogue } from '../modules/billing/catalogue.service.js';
import { prisma } from '../lib/prisma.js';

try {
  const added = await seedCatalogue();
  console.log(`Catalogue seed: ${added} row(s) added; existing rows left unchanged.`);
} finally {
  await prisma.$disconnect();
}
