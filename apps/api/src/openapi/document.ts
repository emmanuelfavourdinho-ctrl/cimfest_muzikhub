import { z } from 'zod';
import { problemSchema } from '@muzikhub/shared';
import { operations, type Auth, type Operation } from './operations.js';

/** OpenAPI 3.1 document for /api/v1, generated from the operation registry and shared Zod schemas. */
const json = (schema: z.ZodType) => z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input', unrepresentable: 'any' });

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
});

const AUTH_RESPONSES: Record<Auth, Record<string, unknown>> = {
  public: {},
  optional: {},
  member: { '401': problem('Not signed in'), '403': problem('Account restricted, suspended or not allowed') },
  staff: { '401': problem('Not signed in'), '403': problem('Not staff, 2FA not set up, permission missing or fresh sign-in required') },
};

function operationObject(o: Operation) {
  const unsafe = o.method !== 'GET';
  const params = [...o.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
  if (o.idempotent) {
    params.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: false,
      schema: { type: 'string', pattern: '^[A-Za-z0-9_.:-]{8,128}$' },
      description: 'Makes the request safe to retry (ADR 0003).',
    } as never);
  }
  return {
    tags: [o.tag],
    summary: o.summary,
    operationId: `${o.method.toLowerCase()}${o.path
      .replace('/api/v1', '')
      .replace(/\{(\w+)\}/g, 'By-$1')
      .replace(/[^a-zA-Z0-9]+(.)/g, (_, c: string) => c.toUpperCase())}`,
    ...(params.length && { parameters: params }),
    ...(o.auth === 'public'
      ? { security: [] }
      : o.auth === 'optional'
        ? { security: [{}, { session: [] }] }
        : { security: [{ session: [] }] }),
    ...(o.body && { requestBody: { required: true, content: { 'application/json': { schema: json(o.body) } } } }),
    'x-muzikhub-auth': o.auth,
    ...(o.rateLimit && { 'x-muzikhub-rate-limit': o.rateLimit }),
    responses: {
      '2XX': { description: 'Success (response schemas are documented per milestone)' },
      '400': problem(o.body ? 'Validation failed (see `errors`)' : 'Invalid parameters or query (see `errors`)'),
      ...AUTH_RESPONSES[o.auth],
      ...(unsafe && { '403': problem('Forbidden, or cross-origin request rejected (CSRF)') }),
      ...(o.path.includes('{') && { '404': problem('Not found') }),
      ...(o.idempotent && {
        '409': problem('Same Idempotency-Key still in progress'),
        '422': problem('Idempotency-Key reused for a different request'),
      }),
      ...(o.rateLimit && { '429': problem('Rate limited (see Retry-After)') }),
      '500': problem('Unexpected error'),
    },
  };
}

export function openApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const o of operations) (paths[o.path] ??= {})[o.method.toLowerCase()] = operationObject(o);
  return {
    openapi: '3.1.0',
    info: {
      title: 'MuzikHub API',
      version: '1.0.0-m0',
      description:
        'REST API for MuzikHub. Errors are RFC 9457 problem details. Authentication is a Better Auth session cookie (HTTP-only); sign-in endpoints live under /api/auth/* (Better Auth).',
    },
    servers: [{ url: '/' }],
    tags: [...new Set(operations.map((o) => o.tag))].map((name) => ({ name })),
    components: {
      securitySchemes: {
        session: {
          type: 'apiKey',
          in: 'cookie',
          name: 'better-auth.session_token',
          description: 'HTTP-only session cookie set by /api/auth/sign-in/*',
        },
      },
      schemas: { Problem: json(problemSchema) },
    },
    paths,
  };
}
