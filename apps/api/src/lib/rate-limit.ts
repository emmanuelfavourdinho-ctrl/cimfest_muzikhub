import type { RequestHandler } from 'express';
import { HttpError } from './http-error.js';

/**
 * Small fixed-window rate limiter (in memory, per API instance) for authenticated routes such
 * as the Admin Console. Keyed by the signed-in user; Better Auth already limits sign-in itself.
 */
export function rateLimit({ windowMs, max, name }: { windowMs: number; max: number; name: string }): RequestHandler & { reset(): void } {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const handler: RequestHandler = (req, res, next) => {
    const key = `${name}:${res.locals.session?.user.id ?? req.ip ?? 'anon'}`;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      throw new HttpError(429, 'RATE_LIMITED', 'Too many requests. Please slow down.');
    }
    next();
  };
  return Object.assign(handler, { reset: () => hits.clear() });
}
