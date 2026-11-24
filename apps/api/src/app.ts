import cors from 'cors';
import express, { type Express, Router } from 'express';
import helmet from 'helmet';
import { toNodeHandler } from 'better-auth/node';
import { API_V1_PREFIX } from '@muzikhub/shared';
import { env } from './config/env.js';
import { auth } from './lib/auth.js';
import { prisma } from './lib/prisma.js';
import { errorHandler, notFound } from './middleware/error-handler.js';
import type { DatabaseCheck } from './modules/health/health.service.js';
import { healthRouter } from './modules/health/health.routes.js';
import { meRouter, profilesRouter } from './modules/profiles/profiles.routes.js';
import { mediaRouter } from './modules/media/media.routes.js';
import { ownPortfolioRoute, portfolioRouter, profilePortfolioRoute } from './modules/portfolio/portfolio.routes.js';
import { setMediaStorage } from './lib/media.js';
import { commentsRouter, feedRouter, postsRouter, profilePostsRoute } from './modules/feed/feed.routes.js';
import { connectionsRouter, usersRouter } from './modules/network/network.routes.js';
import { discoverRouter } from './modules/discover/discover.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import type { MediaStorage } from './lib/media-storage.js';
import { originCheck } from './middleware/origin-check.js';
import { openApiDocument } from './openapi/document.js';
import { applicationsRouter, opportunitiesRouter } from './modules/opportunities/opportunities.routes.js';
import { billingRouter, catalogueRouter } from './modules/billing/billing.routes.js';
import { checkoutRouter, devPaymentsRouter } from './modules/payments/payments.routes.js';
import { paymentWebhookRouter } from './modules/payments/webhook.js';
import { registerPaymentJobs } from './modules/payments/jobs.js';
import { devSandboxEnabled } from './modules/payments/runtime.js';
import { registerDevSandboxFulfiller } from './modules/payments/dev-fulfiller.js';
import { registerSubscriptionFulfillers } from './modules/billing/fulfillers.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { analyticsRouter } from './modules/analytics/analytics.routes.js';
import { blocksRouter } from './modules/safety/blocks.routes.js';
import { communitiesRouter, communityCommentsRouter, discussionsRouter } from './modules/communities/communities.routes.js';
import { registerCommunityIntegrations } from './modules/communities/registry.js';
import { conversationsRouter } from './modules/messaging/messaging.routes.js';
import { registerMessagingIntegrations } from './modules/messaging/registry.js';
import { promotedRouter } from './modules/promotions/promotions.routes.js';
import { registerPromotionFulfillers } from './modules/promotions/fulfillers.js';

export interface AppDependencies {
  /** Returns true when the database answers. Injected so tests need no real DB. */
  checkDatabase: DatabaseCheck;
  /** Media provider. Defaults to Cloudinary; tests pass an in-memory fake. */
  media?: MediaStorage;
}

const defaultDependencies: AppDependencies = {
  checkDatabase: async () => {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  },
};

export function createApp(overrides: Partial<AppDependencies> = {}): Express {
  const deps = { ...defaultDependencies, ...overrides };
  if (deps.media) setMediaStorage(deps.media);
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // correct client IPs/secure cookies behind one reverse proxy
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));

  // Better Auth must be mounted BEFORE express.json(): it parses its own bodies.
  app.all('/api/auth/{*any}', toNodeHandler(auth));

  // Payment provider webhooks: raw bytes (signatures are over them), so BEFORE express.json(), and
  // outside the v1 router's browser origin check (server-to-server, authenticated by signature).
  app.use('/api/v1/payments/webhooks', paymentWebhookRouter());
  registerPaymentJobs();
  registerSubscriptionFulfillers();
  registerPromotionFulfillers();
  registerCommunityIntegrations();
  registerMessagingIntegrations();

  app.use(express.json({ limit: '1mb' }));

  // Versioned REST API. Each feature module contributes one router.
  const v1 = Router();
  // CSRF: state-changing requests must come from an allowed web origin (see origin-check.ts).
  v1.use(originCheck(env.CORS_ORIGINS));
  v1.use('/health', healthRouter(deps.checkDatabase));
  // OpenAPI 3.1 description of this API (generated from openapi/operations.ts).
  v1.get('/openapi.json', (_req, res) => {
    res.json(openApiDocument());
  });
  // More specific routes first: /me/portfolio and /profiles/:username/portfolio.
  v1.use('/me/portfolio', ownPortfolioRoute());
  v1.use('/me', meRouter());
  v1.use('/profiles/:username/portfolio', profilePortfolioRoute());
  v1.use('/profiles/:username/posts', profilePostsRoute());
  v1.use('/profiles', profilesRouter());
  v1.use('/portfolio', portfolioRouter());
  v1.use('/media', mediaRouter());
  v1.use('/feed', feedRouter());
  v1.use('/posts', postsRouter());
  v1.use('/comments', commentsRouter());
  v1.use('/users', usersRouter());
  v1.use('/connections', connectionsRouter());
  v1.use('/discover', discoverRouter());
  v1.use('/reports', reportsRouter());
  v1.use('/opportunities', opportunitiesRouter());
  v1.use('/applications', applicationsRouter());
  v1.use('/catalogue', catalogueRouter());
  v1.use('/billing', billingRouter());
  v1.use('/checkout', checkoutRouter());
  v1.use('/notifications', notificationsRouter());
  v1.use('/analytics', analyticsRouter());
  v1.use('/blocks', blocksRouter());
  v1.use('/communities', communitiesRouter());
  v1.use('/discussions', discussionsRouter());
  v1.use('/community-comments', communityCommentsRouter());
  v1.use('/conversations', conversationsRouter());
  v1.use('/promoted', promotedRouter());
  // Development-only sandbox helpers (never mounted in production; see runtime.ts).
  if (devSandboxEnabled()) {
    v1.use('/dev/payments', devPaymentsRouter());
    registerDevSandboxFulfiller();
  }
  v1.use('/admin', adminRouter());
  app.use(API_V1_PREFIX, v1);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
