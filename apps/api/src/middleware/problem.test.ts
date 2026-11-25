import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { problemSchema } from '@muzikhub/shared';
import { createApp } from '../app.js';

// Every /api/v1 error is an RFC 9457 problem document (application/problem+json).
describe('RFC 9457 problem details', () => {
  const app = createApp({ checkDatabase: async () => true });

  it('unknown routes → 404 problem with stable type, status title and instance', async () => {
    const res = await request(app).get('/api/v1/definitely-not-a-route?x=1');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(problemSchema.parse(res.body)).toEqual({
      type: 'urn:problem-type:muzikhub:not-found',
      title: 'Not Found',
      status: 404,
      detail: 'No route for GET /api/v1/definitely-not-a-route',
      code: 'NOT_FOUND',
      instance: '/api/v1/definitely-not-a-route?x=1',
    });
  });

  it('validation errors carry field-level `errors`', async () => {
    const res = await request(app).get('/api/v1/discover/people').query({ limit: 'many' });
    expect(res.status).toBe(400);
    const p = problemSchema.parse(res.body);
    expect(p).toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
      title: 'Bad Request',
      type: 'urn:problem-type:muzikhub:validation-error',
    });
    expect(p.errors?.[0]).toMatchObject({ path: 'limit' });
  });

  it('malformed JSON → 400 INVALID_JSON problem', async () => {
    const res = await request(app).post('/api/v1/reports').set('Content-Type', 'application/json').send('{"not json');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toMatchObject({ code: 'INVALID_JSON', status: 400 });
  });

  it('never exposes the old { error: {...} } envelope', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.body).not.toHaveProperty('error');
  });
});
