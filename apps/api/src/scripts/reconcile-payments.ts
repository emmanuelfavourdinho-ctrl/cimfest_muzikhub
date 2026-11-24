/**
 * One reconciliation pass (the API also runs it every minute when PAYMENTS_MODE isn't off).
 * Safe to run alongside the API: every change is row-locked and compare-and-set.
 *   npm run payments:reconcile -w @muzikhub/api
 */
import { reconcilePayments } from '../modules/payments/orders.service.js';
import { registerPaymentJobs } from '../modules/payments/jobs.js';
import { prisma } from '../lib/prisma.js';

registerPaymentJobs();
try {
  console.log('Reconciliation:', await reconcilePayments());
} finally {
  await prisma.$disconnect();
}
