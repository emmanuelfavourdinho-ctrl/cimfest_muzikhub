import { STATUS_CODES } from 'node:http';
import type { Response } from 'express';
import type { Problem } from '@muzikhub/shared';

/**
 * RFC 9457 problem details for every error from /api/v1.
 *  - `type`: a stable URN per error code (identifies the kind of problem; not a web page).
 *  - `title`: the HTTP status phrase, the same for every occurrence (RFC 9457 §3.1.3).
 *  - `detail`: the human-readable explanation of this occurrence (safe to show to users).
 *  - `code`: our stable machine code (extension member); `errors`: field-level issues.
 */
export function problemType(code: string) {
  return `urn:problem-type:muzikhub:${code.toLowerCase().replace(/_/g, '-')}`;
}

export function sendProblem(
  res: Response,
  status: number,
  code: string,
  detail: string,
  extra: { instance?: string; errors?: { path: string; message: string }[] } = {},
) {
  const body: Problem = {
    type: problemType(code),
    title: STATUS_CODES[status] ?? 'Error',
    status,
    detail,
    code,
    ...(extra.instance && { instance: extra.instance }),
    ...(extra.errors?.length && { errors: extra.errors }),
  };
  res.status(status).type('application/problem+json').json(body);
}
