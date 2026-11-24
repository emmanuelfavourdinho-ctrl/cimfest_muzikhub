import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@muzikhub/shared';
import { createApp } from '../../app.js';

describe('GET /api/v1/health', () => {
  it('returns 200 and "ok" when the database is reachable', async () => {
    const app = createApp({ checkDatabase: async () => true });
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(res.body)).toMatchObject({
      status: 'ok',
      services: { database: 'up' },
    });
  });

  it('returns 503 and "degraded" when the database check fails', async () => {
    const app = createApp({
      checkDatabase: async () => {
        throw new Error('connection refused');
      },
    });
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'degraded', services: { database: 'down' } });
  });
});

describe('unknown routes', () => {
  it('return a structured 404', async () => {
    const app = createApp({ checkDatabase: async () => true });
    const res = await request(app).get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
