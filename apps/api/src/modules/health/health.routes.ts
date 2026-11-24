import { Router } from 'express';
import { getHealth, type DatabaseCheck } from './health.service.js';

export function healthRouter(checkDatabase: DatabaseCheck): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const health = await getHealth(checkDatabase);
    // 503 lets load balancers / uptime monitors detect a broken database.
    res.status(health.status === 'ok' ? 200 : 503).json(health);
  });

  return router;
}
