import { z } from 'zod';

/**
 * Every API error response uses this shape, so the web app can handle
 * failures in one place instead of guessing per endpoint.
 */
/**
 * Error responses from /api/v1 are RFC 9457 problem details (application/problem+json).
 * `code` is our stable machine-readable code; `detail` is safe to show to users.
 */
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string(),
  code: z.string(),
  instance: z.string().optional(),
  /** Field-level validation issues, present on VALIDATION_ERROR. */
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

export type Problem = z.infer<typeof problemSchema>;
