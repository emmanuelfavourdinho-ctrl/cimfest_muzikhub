import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';

/**
 * Test-only catalogue row (TEST_ITEM, testOnly = true, CHECK-enforced). Created only by test code
 * and the development sandbox — never by the admin API (its schema can't name TEST_ITEM), never
 * by the seed, and refused when NODE_ENV=production. It lets the lifecycle be tested end to end
 * without putting any real product on sale.
 */
export const TEST_ITEM_PRICE_XAF = 1000;

const DAYS = { DAYS_3: 3, DAYS_7: 7, DAYS_14: 14, MONTHLY: 30, ANNUAL: 365 } as const;

export async function ensureTestCatalogueItem(
  { option = 'DAYS_3', priceXaf = TEST_ITEM_PRICE_XAF }: { option?: keyof typeof DAYS; priceXaf?: number } = {},
  nodeEnv: string = env.NODE_ENV,
) {
  if (nodeEnv === 'production') throw new Error('Test-only catalogue rows are refused in production');
  const existing = await prisma.serviceCatalogue.findFirst({ where: { testOnly: true, product: 'TEST_ITEM', option } });
  return (
    existing ??
    prisma.serviceCatalogue.create({
      data: {
        product: 'TEST_ITEM',
        option,
        durationDays: DAYS[option],
        priceXaf,
        active: true,
        testOnly: true,
        effectiveFrom: new Date(0),
        reason: 'Automated tests only',
      },
    })
  );
}
