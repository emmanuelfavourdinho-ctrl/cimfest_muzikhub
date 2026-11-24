import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiError } from '@muzikhub/shared';
import { HttpError } from '../lib/http-error.js';

export const notFound: RequestHandler = (req, res) => {
  const body: ApiError = {
    error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` },
  };
  res.status(404).json(body);
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    const body: ApiError = {
      error: { code: err.code, message: err.message, details: err.details },
    };
    res.status(err.status).json(body);
    return;
  }

  // Malformed JSON body from express.json()
  if (err instanceof SyntaxError && 'body' in err) {
    const body: ApiError = { error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } };
    res.status(400).json(body);
    return;
  }

  // A database unique constraint was hit (e.g. the same media attached twice, a race on a
  // relationship). The constraint is the safety net; report it as a conflict, not a crash.
  if ((err as { code?: unknown })?.code === 'P2002') {
    const body: ApiError = { error: { code: 'CONFLICT', message: 'That conflicts with something that already exists' } };
    res.status(409).json(body);
    return;
  }

  // Serializable transaction lost a race (e.g. two admins changing roles at once): safe to retry.
  const writeConflict =
    (err as { code?: unknown })?.code === 'P2034' ||
    // With @prisma/adapter-pg the same condition arrives as a DriverAdapterError.
    ((err as { name?: string })?.name === 'DriverAdapterError' &&
      ((err as { cause?: { kind?: string } }).cause?.kind === 'TransactionWriteConflict' || /TransactionWriteConflict/.test(String((err as Error).message))));
  if (writeConflict) {
    const body: ApiError = { error: { code: 'CONFLICT_RETRY', message: 'Someone else changed this at the same time. Refresh and try again.' } };
    res.status(409).json(body);
    return;
  }

  // Unknown errors: log server-side, never leak internals to the client.
  console.error(err);
  const body: ApiError = { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } };
  res.status(500).json(body);
};
