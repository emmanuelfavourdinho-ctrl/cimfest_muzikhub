import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { Prisma } from '../generated/prisma/client.js';
import { HttpError } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';

/**
 * Idempotency-Key support for unsafe-to-retry writes (ADR 0003; IETF draft
 * "The Idempotency-Key HTTP Header Field"). Mount after requireAuth (keys are per user).
 *
 *  - No header: the request runs normally (unless `required`).
 *  - First use of a key: the request runs; a 2xx response is stored for 24 h.
 *  - Same key + same request again: the stored response is replayed with
 *    `Idempotent-Replayed: true` — no second post, comment, request or report.
 *  - Same key + different request: 422 IDEMPOTENCY_KEY_REUSED.
 *  - Same key while the first request is still running: 409 IDEMPOTENCY_IN_PROGRESS.
 *  - A failed request (non-2xx) releases its key, so the client may retry with it.
 */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const KEY_FORMAT = /^[A-Za-z0-9_.:-]{8,128}$/;

export function idempotent({ required = false }: { required?: boolean } = {}): RequestHandler {
  return async (req, res, next) => {
    const key = req.get('idempotency-key');
    const userId: string | undefined = res.locals.session?.user.id;
    if (!key) {
      if (required) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'This request needs an Idempotency-Key header.');
      return next();
    }
    if (!KEY_FORMAT.test(key))
      throw new HttpError(400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key must be 8–128 letters, digits or _ . : -');
    if (!userId) throw new HttpError(401, 'UNAUTHENTICATED', 'You must be signed in');

    const path = req.baseUrl + req.path;
    const requestHash = createHash('sha256')
      .update(`${req.method} ${path}\n${JSON.stringify(req.body ?? null)}`)
      .digest('hex');

    try {
      await prisma.idempotencyKey.create({
        data: { userId, key, method: req.method, path, requestHash, expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS) },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      const existing = await prisma.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
      if (!existing || existing.expiresAt <= new Date()) {
        // Expired between the insert and the read: treat as a reuse and let the client pick a new key.
        throw new HttpError(409, 'IDEMPOTENCY_IN_PROGRESS', 'Please retry with a new Idempotency-Key.');
      }
      if (existing.requestHash !== requestHash) {
        throw new HttpError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request.');
      }
      if (existing.status === 'IN_PROGRESS') {
        res.setHeader('Retry-After', 1);
        throw new HttpError(409, 'IDEMPOTENCY_IN_PROGRESS', 'The same request is still being processed. Try again in a moment.');
      }
      res.setHeader('Idempotent-Replayed', 'true');
      res.status(existing.responseStatus ?? 200).json(existing.responseBody);
      return;
    }

    // Capture the JSON response, then complete (2xx) or release (anything else) the key.
    const json = res.json.bind(res);
    let body: unknown;
    res.json = (b: unknown) => {
      body = b;
      return json(b);
    };
    res.on('finish', () => {
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      const done = ok
        ? prisma.idempotencyKey.update({
            where: { userId_key: { userId, key } },
            data: { status: 'COMPLETED', responseStatus: res.statusCode, responseBody: (body ?? null) as Prisma.InputJsonValue },
          })
        : prisma.idempotencyKey.delete({ where: { userId_key: { userId, key } } });
      done.catch((e: unknown) => console.error('idempotency bookkeeping failed', e));
    });
    next();
  };
}

/** Deletes expired keys. Runs on a timer in server.ts. */
export async function sweepIdempotencyKeys(now = new Date()) {
  const { count } = await prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lte: now } } });
  return count;
}
