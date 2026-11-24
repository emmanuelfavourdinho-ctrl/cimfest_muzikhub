import type { RequestHandler } from 'express';
import { HttpError } from '../lib/http-error.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for /api/v1 (OWASP CSRF cheat sheet: Origin verification + Fetch Metadata).
 * Session cookies are SameSite=Lax, which already blocks most cross-site POSTs; this is the
 * explicit second layer. For state-changing requests:
 *   1. If the browser sent `Origin`, it must be one of the allowed web origins (CORS_ORIGINS).
 *   2. Otherwise, if it sent `Sec-Fetch-Site`, it must be `same-origin` or `none`.
 *   3. Requests with neither header are not from a modern browser, so they cannot carry a
 *      victim's cookies cross-site; they are allowed (CLI tools, server-to-server, tests).
 * Better Auth (/api/auth/*) applies its own trusted-origin check.
 */
export function originCheck(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    if (origin !== undefined) {
      if (allowed.has(origin)) return next();
      throw new HttpError(403, 'CROSS_ORIGIN_REJECTED', 'This request came from a site that is not allowed to change data on MuzikHub.');
    }
    const site = req.get('sec-fetch-site');
    if (site !== undefined && site !== 'same-origin' && site !== 'none') {
      throw new HttpError(403, 'CROSS_ORIGIN_REJECTED', 'This request came from a site that is not allowed to change data on MuzikHub.');
    }
    next();
  };
}
