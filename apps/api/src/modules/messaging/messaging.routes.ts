import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  messagePolicySchema,
  messageReceiptSchema,
  messagesQuerySchema,
  sendMessageSchema,
  startConversationSchema,
} from '@muzikhub/shared';
import { limits } from '../../lib/rate-limit.js';
import { currentUserId, requireAuth, requireFullAccess } from '../../middleware/require-auth.js';
import { parseQuery, validateBody } from '../../middleware/validate.js';
import * as messaging from './messaging.service.js';

const p = (req: Request, name: string) => String((req.params as Record<string, string>)[name]);
const cursorQuery = z.object({ cursor: z.string().max(64).optional() });

/** /api/v1/conversations — your direct messages. Participants only; everything else is 404. */
export function conversationsRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.get('/', async (req, res) => {
    res.json(await messaging.listConversations(currentUserId(res.locals), parseQuery(cursorQuery, req.query).cursor));
  });
  router.post('/', requireFullAccess, limits.conversationStart, validateBody(startConversationSchema), async (req, res) => {
    res.json(await messaging.openConversation(currentUserId(res.locals), req.body.username));
  });
  router.get('/unread-count', async (_req, res) => {
    res.json({ count: await messaging.unreadConversations(currentUserId(res.locals)) });
  });
  router.get('/settings/policy', async (_req, res) => {
    res.json(await messaging.getMessagePolicy(currentUserId(res.locals)));
  });
  router.put('/settings/policy', validateBody(messagePolicySchema), async (req, res) => {
    res.json(await messaging.setMessagePolicy(currentUserId(res.locals), req.body.policy));
  });
  router.get('/:id', async (req, res) => {
    res.json(await messaging.getConversation(p(req, 'id'), currentUserId(res.locals)));
  });
  router.get('/:id/messages', async (req, res) => {
    res.json(await messaging.listMessages(currentUserId(res.locals), p(req, 'id'), parseQuery(messagesQuerySchema, req.query)));
  });
  router.post('/:id/messages', requireFullAccess, limits.messageSend, validateBody(sendMessageSchema), async (req, res) => {
    const result = await messaging.sendMessage(currentUserId(res.locals), p(req, 'id'), req.body);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    res.status(result.replayed ? 200 : 201).json(result.message);
  });
  router.post('/:id/read', validateBody(messageReceiptSchema), async (req, res) => {
    res.json(await messaging.markRead(currentUserId(res.locals), p(req, 'id'), req.body.upTo));
  });
  router.post('/:id/delivered', validateBody(messageReceiptSchema), async (req, res) => {
    res.json(await messaging.markDelivered(currentUserId(res.locals), p(req, 'id'), req.body.upTo));
  });
  return router;
}
