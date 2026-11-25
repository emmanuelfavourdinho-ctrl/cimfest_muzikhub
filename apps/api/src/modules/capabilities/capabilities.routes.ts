import { Router } from 'express';
import { EMAIL_FEATURES, type Capabilities } from '@muzikhub/shared';
import { emailAvailable } from '../../lib/mailer.js';

/** The deployment's current capabilities. Derived from the running configuration, never stored. */
export function currentCapabilities(): Capabilities {
  const email = emailAvailable();
  return { email: { available: email, unavailableFeatures: email ? [] : [...EMAIL_FEATURES] } };
}

/** GET /api/v1/capabilities — public, read-only, no secrets (see packages/shared/src/capabilities.ts). */
export function capabilitiesRouter(): Router {
  const router = Router();
  router.get('/', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.json(currentCapabilities());
  });
  return router;
}
