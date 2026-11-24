import { z } from 'zod';

/**
 * Every API error response uses this shape, so the web app can handle
 * failures in one place instead of guessing per endpoint.
 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** Field-level validation issues, present on VALIDATION_ERROR. */
    details: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
