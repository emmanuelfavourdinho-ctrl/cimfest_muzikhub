import { registerOutboxHandler } from '../../lib/outbox.js';
import { fulfilOrder, verifyOrder } from './orders.service.js';

let registered = false;
/** Outbox topics for payments. Both handlers are idempotent (the outbox may deliver twice). */
export function registerPaymentJobs() {
  if (registered) return;
  registered = true;
  registerOutboxHandler('payments.verify', async (payload) => {
    await verifyOrder(String((payload as { reference: string }).reference), 'webhook');
  });
  registerOutboxHandler('payments.fulfil', async (payload) => {
    await fulfilOrder(String((payload as { orderId: string }).orderId));
  });
}
