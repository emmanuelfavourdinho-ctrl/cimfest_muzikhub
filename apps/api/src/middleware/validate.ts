import type { RequestHandler } from 'express';
import type { z } from 'zod';
import { HttpError } from '../lib/http-error.js';

/**
 * Validates req.body against a Zod schema (usually from @muzikhub/shared)
 * and replaces it with the parsed, typed value. Invalid input → 400.
 */
export function validateBody(schema: z.ZodType): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      throw new HttpError(
        400,
        'VALIDATION_ERROR',
        'Request body is invalid',
        result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      );
    }
    req.body = result.data;
    next();
  };
}

/** Parses query-string parameters (Express 5's req.query is read-only, so this returns them). */
export function parseQuery<T extends z.ZodType>(schema: T, query: unknown): z.infer<T> {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Query parameters are invalid',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}
