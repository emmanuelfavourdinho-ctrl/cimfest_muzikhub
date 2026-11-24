import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './health.js';

describe('healthResponseSchema', () => {
  it('accepts a valid health payload', () => {
    const result = healthResponseSchema.safeParse({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: 12.5,
      services: { database: 'up' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown status and a non-ISO timestamp', () => {
    const result = healthResponseSchema.safeParse({
      status: 'great',
      timestamp: 'yesterday',
      uptimeSeconds: 1,
      services: { database: 'up' },
    });
    expect(result.success).toBe(false);
  });
});
