import {
  CATALOGUE_OPTIONS,
  CATALOGUE_SEED,
  FREE_LIMITS,
  SELLABLE_PRODUCTS,
  type AdminCatalogueRow,
  type BillingProduct,
  type CatalogueOption,
  type PublicCatalogue,
} from '@muzikhub/shared';
import type { ServiceCatalogue } from '../../generated/prisma/client.js';
import { writeAudit } from '../../lib/audit.js';
import { HttpError } from '../../lib/http-error.js';
import { prisma } from '../../lib/prisma.js';
import type { StaffContext } from '../../middleware/require-staff.js';

/**
 * Versioned catalogue (ADR 0004): rows are only ever INSERTED. The row in force for a
 * (product, option) is the latest with effectiveFrom <= now. Orders (Phase 3) snapshot the
 * price at creation, so a change applies to new orders only and never alters a past one.
 */
const key = (r: { product: string; option: string }) => `${r.product}:${r.option}`;

export async function currentRows(now = new Date()): Promise<ServiceCatalogue[]> {
  const rows = await prisma.serviceCatalogue.findMany({
    where: { effectiveFrom: { lte: now } },
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
  });
  const seen = new Map<string, ServiceCatalogue>();
  for (const r of rows) if (!seen.has(key(r))) seen.set(key(r), r);
  const order = CATALOGUE_SEED.map(key);
  return [...seen.values()].sort((a, b) => order.indexOf(key(a)) - order.indexOf(key(b)));
}

const sellable = (p: BillingProduct) => SELLABLE_PRODUCTS.includes(p);

export async function publicCatalogue(now = new Date()): Promise<PublicCatalogue> {
  const rows = await currentRows(now);
  return {
    currency: 'XAF',
    free: { limits: FREE_LIMITS },
    items: rows.map((r) => {
      const onSale = r.active && sellable(r.product);
      return { product: r.product, option: r.option, durationDays: r.durationDays, onSale, priceXaf: onSale ? r.priceXaf : null };
    }),
  };
}

export async function adminCatalogue(): Promise<AdminCatalogueRow[]> {
  const rows = await currentRows();
  const users = await prisma.user.findMany({
    where: { id: { in: rows.map((r) => r.updatedById).filter((x): x is string => Boolean(x)) } },
    select: { id: true, name: true },
  });
  const name = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id,
    product: r.product,
    option: r.option,
    durationDays: r.durationDays,
    priceXaf: r.priceXaf,
    active: r.active,
    sellable: sellable(r.product),
    effectiveFrom: r.effectiveFrom.toISOString(),
    updatedBy: r.updatedById ? (name.get(r.updatedById) ?? 'Former staff') : null,
    reason: r.reason,
  }));
}

async function newVersion(
  staff: StaffContext,
  product: BillingProduct,
  option: CatalogueOption,
  change: { priceXaf?: number; active?: boolean },
  reason: string,
  action: string,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalogue:${product}:${option}`}))`;
    const current = await tx.serviceCatalogue.findFirst({
      where: { product, option, effectiveFrom: { lte: new Date() } },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    if (!current) throw new HttpError(404, 'CATALOGUE_ITEM_NOT_FOUND', 'That product option is not in the catalogue');
    const next = await tx.serviceCatalogue.create({
      data: {
        product,
        option,
        durationDays: current.durationDays,
        priceXaf: change.priceXaf ?? current.priceXaf,
        active: change.active ?? current.active,
        updatedById: staff.id,
        reason,
      },
    });
    await writeAudit(tx, {
      actor: { id: staff.id, role: staff.role, ip: staff.ip },
      action,
      target: { type: 'catalogue', id: `${product}:${option}` },
      reason,
      before: { priceXaf: current.priceXaf, active: current.active },
      after: { priceXaf: next.priceXaf, active: next.active },
    });
    return next;
  });
}

export async function changePrice(staff: StaffContext, product: BillingProduct, option: CatalogueOption, priceXaf: number, reason: string) {
  await newVersion(staff, product, option, { priceXaf }, reason, 'catalogue.price.change');
  return adminCatalogue();
}

export async function setAvailability(
  staff: StaffContext,
  product: BillingProduct,
  option: CatalogueOption,
  active: boolean,
  reason: string,
) {
  if (active && !sellable(product)) {
    throw new HttpError(409, 'PRODUCT_NOT_SELLABLE', `${product} can't go on sale until its benefits are built and tested.`);
  }
  await newVersion(staff, product, option, { active }, reason, 'catalogue.availability.change');
  return adminCatalogue();
}

/** Idempotent seed of the owner-confirmed catalogue: adds only (product, option) pairs that have no row yet. All inactive. */
export async function seedCatalogue() {
  let added = 0;
  for (const s of CATALOGUE_SEED) {
    const exists = await prisma.serviceCatalogue.count({ where: { product: s.product, option: s.option } });
    if (exists) continue;
    await prisma.serviceCatalogue.create({
      data: {
        ...s,
        durationDays: CATALOGUE_OPTIONS[s.option].days,
        active: false,
        reason: 'Initial catalogue (owner-confirmed table)',
        effectiveFrom: new Date(0),
      },
    });
    added += 1;
  }
  return added;
}
