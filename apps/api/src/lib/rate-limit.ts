import type { RequestHandler } from 'express';
import { HttpError } from './http-error.js';

/**
 * Fixed-window rate limiter (in memory, per API instance), keyed by the signed-in user
 * (falling back to the IP). One limiter may enforce several windows at once — e.g. a
 * per-minute burst limit and an hourly ceiling. Exceeding any window → 429 RATE_LIMITED
 * with Retry-After (seconds). Better Auth limits its own credential endpoints separately.
 *
 * Limitation (documented): counters live in this process, so they reset on restart and are
 * not shared between instances. Release one runs a single API instance.
 */
type Window = { ms: number; max: number };
export type Limiter = RequestHandler & { readonly label: string; readonly windows: readonly Window[]; reset(): void };

const registry = new Set<Limiter>();

export function rateLimit(opts: { name: string; windowMs: number; max: number } | { name: string; windows: Window[] }): Limiter {
  const windows = 'windows' in opts ? opts.windows : [{ ms: opts.windowMs, max: opts.max }];
  const hits = windows.map(() => new Map<string, { count: number; resetAt: number }>());

  const handler: RequestHandler = (req, res, next) => {
    const key = `${res.locals.session?.user.id ?? req.ip ?? 'anon'}`;
    const now = Date.now();
    let retryAfterMs = 0;
    windows.forEach((w, i) => {
      const map = hits[i]!;
      const entry = map.get(key);
      if (!entry || entry.resetAt <= now) {
        map.set(key, { count: 1, resetAt: now + w.ms });
        return;
      }
      entry.count += 1;
      if (entry.count > w.max) retryAfterMs = Math.max(retryAfterMs, entry.resetAt - now);
    });
    if (retryAfterMs > 0) {
      res.setHeader('Retry-After', Math.ceil(retryAfterMs / 1000));
      throw new HttpError(429, 'RATE_LIMITED', 'Too many requests. Please slow down and try again shortly.');
    }
    next();
  };
  const limiter = Object.assign(handler, { label: opts.name, windows, reset: () => hits.forEach((m) => m.clear()) });
  registry.add(limiter);
  return limiter;
}

/** Every limiter created so far (tests reset them between cases; docs list them). */
export function allRateLimiters(): readonly Limiter[] {
  return [...registry];
}

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * Per-endpoint-class limits for member write routes (M0 security baseline). Generous for real
 * use, low enough to stop scripted abuse. Listed in docs/ARCHITECTURE.md.
 */
export const limits = {
  contentWrite: rateLimit({
    name: 'content-write',
    windows: [
      { ms: MIN, max: 20 },
      { ms: HOUR, max: 200 },
    ],
  }),
  reaction: rateLimit({ name: 'reaction', windows: [{ ms: MIN, max: 60 }] }),
  connectionRequest: rateLimit({ name: 'connection-request', windows: [{ ms: HOUR, max: 30 }] }),
  report: rateLimit({ name: 'report', windows: [{ ms: HOUR, max: 20 }] }),
  upload: rateLimit({ name: 'upload', windows: [{ ms: HOUR, max: 60 }] }),
  /** Applications, entries, interest — one per target, so a low ceiling only stops scripts. */
  apply: rateLimit({ name: 'apply', windows: [{ ms: HOUR, max: 30 }] }),
};
