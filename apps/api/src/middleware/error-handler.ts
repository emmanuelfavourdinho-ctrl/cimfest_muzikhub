import type { ErrorRequestHandler, RequestHandler } from 'express';
import { HttpError } from '../lib/http-error.js';
import { sendProblem } from '../lib/problem.js';

/** Every error from /api/v1 is an RFC 9457 problem document (see lib/problem.ts). */
export const notFound: RequestHandler = (req, res) => {
  sendProblem(res, 404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`, { instance: req.originalUrl });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const instance = req.originalUrl;
  if (err instanceof HttpError) {
    sendProblem(res, err.status, err.code, err.message, { instance, errors: err.details });
    return;
  }

  // Malformed JSON body from express.json()
  if (err instanceof SyntaxError && 'body' in err) {
    sendProblem(res, 400, 'INVALID_JSON', 'Request body is not valid JSON', { instance });
    return;
  }

  // A database unique constraint was hit (e.g. the same media attached twice, a race on a
  // relationship). The constraint is the safety net; report it as a conflict, not a crash.
  if ((err as { code?: unknown })?.code === 'P2002') {
    sendProblem(res, 409, 'CONFLICT', 'That conflicts with something that already exists', { instance });
    return;
  }

  // Serializable transaction lost a race (e.g. two admins changing roles at once): safe to retry.
  const writeConflict =
    (err as { code?: unknown })?.code === 'P2034' ||
    // With @prisma/adapter-pg the same condition arrives as a DriverAdapterError.
    ((err as { name?: string })?.name === 'DriverAdapterError' &&
      ((err as { cause?: { kind?: string } }).cause?.kind === 'TransactionWriteConflict' ||
        /TransactionWriteConflict/.test(String((err as Error).message))));
  if (writeConflict) {
    sendProblem(res, 409, 'CONFLICT_RETRY', 'Someone else changed this at the same time. Refresh and try again.', { instance });
    return;
  }

  // Unknown errors: log server-side, never leak internals to the client.
  console.error(err);
  sendProblem(res, 500, 'INTERNAL_ERROR', 'Something went wrong', { instance });
};
