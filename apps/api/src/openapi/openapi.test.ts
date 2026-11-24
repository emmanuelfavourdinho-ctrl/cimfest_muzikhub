import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { openApiDocument } from './document.js';
import { operations } from './operations.js';
import { scanRoutes } from './route-scan.js';
import { testApp } from '../test/helpers.js';

describe('OpenAPI 3.1 skeleton', () => {
  it('documents exactly the routes that exist (no missing, no invented operations)', () => {
    const key = (r: { method: string; path: string }) => `${r.method} ${r.path}`;
    const real = new Set(scanRoutes().map(key));
    const documented = new Set(operations.map(key));
    expect(
      [...real].filter((r) => !documented.has(r)),
      'routes missing from openapi/operations.ts',
    ).toEqual([]);
    expect(
      [...documented].filter((d) => !real.has(d)),
      'documented operations with no route',
    ).toEqual([]);
    expect(real.size).toBeGreaterThanOrEqual(63);
  });

  it('is a structurally valid 3.1 document with auth, problem responses and request schemas', () => {
    const doc = openApiDocument();
    expect(doc.openapi).toBe('3.1.0');
    const ids = new Set<string>();
    for (const [path, ops] of Object.entries(doc.paths)) {
      expect(path).toMatch(/^\/api\/v1\//);
      for (const [method, raw] of Object.entries(ops)) {
        const o = raw as {
          operationId: string;
          security: unknown[];
          responses: Record<string, unknown>;
          requestBody?: unknown;
          'x-muzikhub-auth': string;
        };
        expect(ids.has(o.operationId), `duplicate operationId ${o.operationId}`).toBe(false);
        ids.add(o.operationId);
        expect(o.security, `${method} ${path} declares auth`).toBeDefined();
        expect(o.responses['500']).toBeDefined();
        if (o['x-muzikhub-auth'] === 'member' || o['x-muzikhub-auth'] === 'staff') expect(o.responses['401']).toBeDefined();
      }
    }
    expect(doc.components.schemas.Problem).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['type', 'title', 'status', 'detail', 'code']),
    });
    const createPost = (
      doc.paths['/api/v1/posts'] as Record<
        string,
        { requestBody: { content: Record<string, { schema: { type: string } }> }; parameters: { name: string }[] }
      >
    ).post!;
    expect(createPost.requestBody.content['application/json']!.schema.type).toBe('object');
    expect(createPost.parameters.map((p) => p.name)).toContain('Idempotency-Key');
  });

  it('is served at GET /api/v1/openapi.json', async () => {
    const res = await request(testApp()).get('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(Object.keys(res.body.paths).length).toBeGreaterThan(40);
  });
});
