import { z } from 'zod';

export const serviceStatusSchema = z.enum(['up', 'down']);

/** Response body of GET /api/v1/health. */
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  timestamp: z.iso.datetime(),
  uptimeSeconds: z.number().nonnegative(),
  services: z.object({
    database: serviceStatusSchema,
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
