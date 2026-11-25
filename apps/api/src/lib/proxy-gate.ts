import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import type { RequestHandler } from 'express';
import { HttpError } from './http-error.js';

/**
 * Setup B (docs/deployment-readiness.md §1): the browser talks only to the Vercel origin, and
 * Vercel forwards /api/* to Render. Vercel adds PROXY_SECRET_HEADER to every forwarded request
 * (a `routes` transform with op "set", so a visitor can't supply their own value), and it
 * overwrites X-Forwarded-For / X-Real-IP with the visitor's address (it doesn't forward
 * client-supplied IPs). So, when the secret matches, X-Real-IP is the visitor.
 *
 * Without the secret check, anyone could call Render directly with a forged X-Real-IP and get a
 * fresh rate-limit bucket for every request. With PROXY_SHARED_SECRET set, direct requests are
 * refused (403), except the health check Render itself calls.
 *
 * Both rate limiters read one resolved address: Express's req.ip (our limiter, audit IPs) and
 * CLIENT_IP_HEADER, which Better Auth is configured to read (advanced.ipAddress). Any incoming
 * CLIENT_IP_HEADER is discarded first, so it can only ever carry the value set here.
 */
export const PROXY_SECRET_HEADER = 'x-muzikhub-proxy-secret';
export const CLIENT_IP_HEADER = 'x-muzikhub-client-ip';
const VISITOR_IP_HEADER = 'x-real-ip';
/** Render's health check calls the service directly, without the secret. */
const UNGATED_PATHS = new Set(['/api/v1/health']);

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Constant-time check of the proxy secret on a raw Node request (also used by Socket.IO). */
export function hasProxySecret(req: IncomingMessage, secret: string): boolean {
  const got = req.headers[PROXY_SECRET_HEADER];
  return typeof got === 'string' && timingSafeEqual(digest(got), digest(secret));
}

let missingVisitorIpWarned = false;

export function proxyGate(secret: string | undefined): RequestHandler {
  return (req, _res, next) => {
    delete req.headers[CLIENT_IP_HEADER];
    if (secret) {
      const viaProxy = hasProxySecret(req, secret);
      delete req.headers[PROXY_SECRET_HEADER]; // never passed further (logs, Better Auth)
      if (!viaProxy) {
        if (UNGATED_PATHS.has(req.path)) return next();
        return next(new HttpError(403, 'DIRECT_ACCESS_FORBIDDEN', 'This API is only reachable through the MuzikHub website.'));
      }
      const visitor = req.headers[VISITOR_IP_HEADER];
      if (typeof visitor === 'string' && isIP(visitor.trim())) {
        // Shadows Express's req.ip getter for this request only.
        Object.defineProperty(req, 'ip', { value: visitor.trim(), configurable: true, enumerable: true });
      } else if (!missingVisitorIpWarned) {
        missingVisitorIpWarned = true;
        console.warn('[proxy] a forwarded request had no valid X-Real-IP; falling back to the connection address');
      }
    }
    if (req.ip) req.headers[CLIENT_IP_HEADER] = req.ip;
    next();
  };
}
