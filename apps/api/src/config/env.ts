import { existsSync } from 'node:fs';
import { z } from 'zod';
import { resolveDatabaseUrl } from './database.js';
import { LIVE_PAYMENTS_APPROVED } from './payments-approval.js';

// Load apps/api/.env when present (Node built-in; no dotenv dependency).
// Real environment variables always win over the file.
if (process.env.NODE_ENV !== 'test' && existsSync('.env')) {
  process.loadEnvFile('.env');
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    /** Connections in the API's pool. Supabase's Free session pooler allows only a few clients. */
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
    BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters (openssl rand -base64 32)'),
    BETTER_AUTH_URL: z.url(),
    /** Public URL of the web app — used to build links in emails (password reset, verification). */
    WEB_APP_URL: z.url().default('http://localhost:5173'),
    /**
     * Email delivery: "capture" (tests: kept in memory), "console" (dev: printed, not sent),
     * "resend" (sent through Resend). Defaults by NODE_ENV — see emailTransportDefault.
     */
    EMAIL_TRANSPORT: z.enum(['capture', 'console', 'resend']).optional(),
    /**
     * When true, publishing (posts, comments, publishing work) — and later messaging and calls —
     * require a verified email. Off until a Resend sending domain is verified (decision C2):
     * without it, verification emails cannot reach real users.
     */
    REQUIRE_EMAIL_VERIFICATION: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    /** Resend API key (server-side only). Required when EMAIL_TRANSPORT is "resend". */
    RESEND_API_KEY: z.string().trim().startsWith('re_', 'RESEND_API_KEY should start with re_').optional(),
    /**
     * Sender, e.g. "MuzikHub <no-reply@mail.your-domain>". Must be on a domain verified in Resend.
     * No default on purpose: a sender address is never invented.
     */
    EMAIL_FROM: z
      .string()
      .trim()
      .regex(/^(?:[^<>]+<)?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/, 'EMAIL_FROM must be an address or "Name <address>"')
      .optional(),
    // Media storage. Optional so the API still starts without it; media endpoints then return 503.
    CLOUDINARY_CLOUD_NAME: z.string().trim().optional(),
    CLOUDINARY_API_KEY: z.string().trim().optional(),
    CLOUDINARY_API_SECRET: z.string().trim().optional(),
    /** Top-level Cloudinary folder; assets go in <folder>/<NODE_ENV>/<userId>/<assetId>. */
    CLOUDINARY_FOLDER: z.string().trim().default('muzikhub'),
    /**
     * Payments (ADR 0004). "off" (default): every checkout is refused. "sandbox": test payments
     * only, every order marked SANDBOX and excluded from revenue forever. "live": real money —
     * refused at startup until the owner approves (LIVE_PAYMENTS_APPROVED) and keys are set.
     */
    PAYMENTS_MODE: z.enum(['off', 'sandbox', 'live']).default('off'),
    /** "fake" = the labelled TEST PROVIDER (never in production); "notchpay" = the real adapter. */
    PAYMENTS_PROVIDER: z.enum(['fake', 'notchpay']).optional(),
    /**
     * Sandbox in production is refused unless this is "true". Reason: in production a sandbox
     * order is fulfilled with REAL benefits for fake money, so it may only run on a deliberately
     * configured staging deployment, never by accident on the public site.
     */
    PAYMENTS_ALLOW_SANDBOX_IN_PRODUCTION: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    // Notch Pay credentials. Server-side only; never logged, never sent to the browser.
    NOTCHPAY_PUBLIC_KEY: z.string().optional(),
    NOTCHPAY_PRIVATE_KEY: z.string().optional(),
    NOTCHPAY_WEBHOOK_SECRET: z.string().optional(),
  })
  .transform((e) => ({
    ...e,
    EMAIL_TRANSPORT: e.EMAIL_TRANSPORT ?? emailTransportDefault(e.NODE_ENV),
    PAYMENTS_PROVIDER: e.PAYMENTS_PROVIDER ?? (e.NODE_ENV === 'production' ? ('notchpay' as const) : ('fake' as const)),
  }))
  .superRefine((e, ctx) => {
    // Remote databases must verify the server certificate (see config/database.ts).
    const db = resolveDatabaseUrl(e.DATABASE_URL);
    if (!db.ok) for (const message of db.problems) ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message });
    for (const message of paymentsConfigProblems(e)) ctx.addIssue({ code: 'custom', path: ['PAYMENTS_MODE'], message });
    if (e.NODE_ENV === 'production' && e.EMAIL_TRANSPORT !== 'resend') {
      ctx.addIssue({ code: 'custom', path: ['EMAIL_TRANSPORT'], message: 'production must send email through "resend"' });
    }
    if (e.EMAIL_TRANSPORT === 'resend') {
      if (!e.RESEND_API_KEY) ctx.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'required to send email with Resend' });
      if (!e.EMAIL_FROM)
        ctx.addIssue({
          code: 'custom',
          path: ['EMAIL_FROM'],
          message: 'required to send email with Resend (an address on a verified domain)',
        });
    }
  })
  // Use the checked URL (absolute sslrootcert) from here on.
  .transform((e) => {
    const db = resolveDatabaseUrl(e.DATABASE_URL);
    return db.ok ? { ...e, DATABASE_URL: db.url } : e;
  });

/** Startup rules for payments (ADR 0004 §Payment mode). Messages only; never values. */
function paymentsConfigProblems(e: {
  NODE_ENV: string;
  PAYMENTS_MODE: 'off' | 'sandbox' | 'live';
  PAYMENTS_PROVIDER: 'fake' | 'notchpay';
  PAYMENTS_ALLOW_SANDBOX_IN_PRODUCTION: boolean;
  NOTCHPAY_PUBLIC_KEY?: string;
  NOTCHPAY_PRIVATE_KEY?: string;
  NOTCHPAY_WEBHOOK_SECRET?: string;
}): string[] {
  const problems: string[] = [];
  if (e.NODE_ENV === 'production' && e.PAYMENTS_PROVIDER === 'fake') {
    problems.push('PAYMENTS_PROVIDER=fake (the TEST PROVIDER) is refused in production');
  }
  if (e.PAYMENTS_MODE === 'sandbox' && e.NODE_ENV === 'production' && !e.PAYMENTS_ALLOW_SANDBOX_IN_PRODUCTION) {
    problems.push('PAYMENTS_MODE=sandbox is refused in production unless PAYMENTS_ALLOW_SANDBOX_IN_PRODUCTION=true (staging only)');
  }
  if (e.PAYMENTS_MODE === 'live') {
    if (!LIVE_PAYMENTS_APPROVED) problems.push('PAYMENTS_MODE=live is not approved yet (owner sign-off required; see ADR 0004)');
    if (e.PAYMENTS_PROVIDER !== 'notchpay') problems.push('PAYMENTS_MODE=live requires PAYMENTS_PROVIDER=notchpay');
    for (const name of ['NOTCHPAY_PUBLIC_KEY', 'NOTCHPAY_PRIVATE_KEY', 'NOTCHPAY_WEBHOOK_SECRET'] as const) {
      if (!e[name]?.trim()) problems.push(`PAYMENTS_MODE=live requires ${name}`);
    }
  }
  return problems;
}

function emailTransportDefault(nodeEnv: 'development' | 'test' | 'production') {
  return nodeEnv === 'test' ? 'capture' : nodeEnv === 'development' ? 'console' : 'resend';
}

export type Env = z.output<typeof envSchema>;

/** Validates an environment object. Exported so configuration rules can be unit-tested. */
export function parseEnvironment(source: Record<string, string | undefined>) {
  return envSchema.safeParse(source);
}

function loadEnv(): Env {
  const parsed = parseEnvironment(process.env);
  if (!parsed.success) {
    // Fail fast at startup with a readable message instead of crashing later.
    // Only variable names and rule messages are printed — never values.
    const problems = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}\nSee .env.example.`);
  }
  return parsed.data;
}

export const env = loadEnv();
