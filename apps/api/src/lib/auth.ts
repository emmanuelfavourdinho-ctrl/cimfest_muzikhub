import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { twoFactor, username } from 'better-auth/plugins';
import { PASSWORD_MAX, PASSWORD_MIN, PRIMARY_USE_KEYS, USERNAME_MAX, USERNAME_MIN, usernameSchema } from '@muzikhub/shared';
import { env } from '../config/env.js';
import { createHash } from 'node:crypto';
import { passwordResetEmail, verificationEmail } from './email-templates.js';
import { emailAvailable, EmailUnavailableError, sendEmail } from './mailer.js';
import { prisma } from './prisma.js';
import { isVisibleStatus, reinstateExpiredSuspensions } from './account-status.js';
import { betterAuthPassword } from './password.js';

/** Idempotency key derived from the one-time token: a retried send of the same link is sent once. */
const idempotencyKeyFor = (kind: string, token: string) => `${kind}/${createHash('sha256').update(token).digest('hex').slice(0, 40)}`;

/**
 * Verification links always return to the web app (not the API's JSON response).
 * Better Auth appends ?error=... to this URL when a link is invalid or expired.
 */
export const VERIFIED_RETURN_PATH = '/email-verified';
function withWebReturn(url: string): string {
  const link = new URL(url);
  link.searchParams.set('callbackURL', new URL(VERIFIED_RETURN_PATH, env.WEB_APP_URL).toString());
  return link.toString();
}

/**
 * Better Auth endpoints that only work by sending an email. In restricted-email mode they are
 * refused with 503 EMAIL_UNAVAILABLE in a before-hook — i.e. before Better Auth looks the
 * address up — so the answer is identical for every address and reveals nothing about accounts.
 */
export const EMAIL_DEPENDENT_AUTH_PATHS = ['/request-password-reset', '/send-verification-email'] as const;
export const EMAIL_UNAVAILABLE_MESSAGE =
  'Email isn’t available on MuzikHub yet, so password reset and email confirmation can’t be used right now.';

/**
 * Better Auth handles registration, sign-in, sessions (HTTP-only cookies),
 * password hashing (scrypt) and password reset. Mounted at /api/auth/* in app.ts.
 */
export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: env.CORS_ORIGINS,
  database: prismaAdapter(prisma, { provider: 'postgresql' }),

  user: {
    additionalFields: {
      // FR-03: chosen on the first registration step.
      primaryUse: { type: 'string', required: true, input: true },
      // Server-controlled. input:false means sign-up/update requests cannot set them.
      platformRole: { type: 'string', required: false, input: false, defaultValue: 'USER' },
      status: { type: 'string', required: false, input: false, defaultValue: 'ACTIVE' },
    },
  },

  emailAndPassword: {
    enabled: true,
    // scrypt at the OWASP minimum with rehash-on-login of older hashes (ADR 0001, lib/password.ts).
    password: betterAuthPassword((oldHash, newHash) =>
      prisma.account.updateMany({ where: { providerId: 'credential', password: oldHash }, data: { password: newHash } }),
    ),
    minPasswordLength: PASSWORD_MIN,
    maxPasswordLength: PASSWORD_MAX,
    // Someone resetting a password may be locking out an attacker: end every other session.
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    // Better Auth catches errors thrown here and logs them; the HTTP response is identical
    // either way, so a failed or rate-limited send never reveals whether an account exists.
    sendResetPassword: async ({ user, url, token }) => {
      // Unreachable in restricted-email mode (the before-hook refuses the request); guarded anyway.
      if (!emailAvailable()) throw new EmailUnavailableError('password-reset');
      await sendEmail({
        to: user.email,
        kind: 'password-reset',
        idempotencyKey: idempotencyKeyFor('password-reset', token),
        ...passwordResetEmail({ name: user.name, url }),
      });
    },
  },

  emailVerification: {
    // Approved 2026-11-24: verification is OPTIONAL for the hackathon stage
    // (requireEmailVerification stays false). Users see a banner and can resend.
    // Restricted-email mode: sign-up sends nothing (and the UI never claims it did).
    sendOnSignUp: env.EMAIL_TRANSPORT !== 'disabled',
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60,
    sendVerificationEmail: async ({ user, url, token }) => {
      // No email can be delivered: skip on sign-up; the resend endpoint is refused by the before-hook.
      if (!emailAvailable()) return;
      await sendEmail({
        to: user.email,
        kind: 'email-verification',
        idempotencyKey: idempotencyKeyFor('email-verification', token),
        ...verificationEmail({ name: user.name, url: withWebReturn(url) }),
      });
    },
  },

  plugins: [
    username({
      minUsernameLength: USERNAME_MIN,
      maxUsernameLength: USERNAME_MAX,
      usernameValidator: (value) => usernameSchema.safeParse(value).success,
    }),
    // Official TOTP two-factor (Better Auth 1.7). Secrets and backup codes are encrypted at
    // rest; enabling requires the password and a first valid code; 10 failed codes lock
    // verification for 15 minutes. Required for staff (enforced in middleware/require-staff).
    twoFactor({ issuer: 'MuzikHub' }),
  ],

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (!emailAvailable() && (EMAIL_DEPENDENT_AUTH_PATHS as readonly string[]).includes(ctx.path ?? '')) {
        throw new APIError('SERVICE_UNAVAILABLE', { code: 'EMAIL_UNAVAILABLE', message: EMAIL_UNAVAILABLE_MESSAGE });
      }
      // "Trust this device" would let a second factor be skipped for 30 days. MuzikHub
      // doesn't offer it: every sign-in of a 2FA account asks for a code.
      if (ctx.path?.startsWith('/two-factor/verify') && (ctx.body as { trustDevice?: unknown } | undefined)?.trustDevice) {
        throw new APIError('BAD_REQUEST', { message: 'Trusted devices are not supported' });
      }
    }),
  },

  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const record = user as typeof user & { primaryUse?: unknown; username?: unknown };
          if (!PRIMARY_USE_KEYS.includes(record.primaryUse as never)) {
            throw new APIError('BAD_REQUEST', { message: 'Choose how you want to use MuzikHub' });
          }
          if (typeof record.username !== 'string' || record.username.length === 0) {
            throw new APIError('BAD_REQUEST', { message: 'Choose a username' });
          }
          return { data: user };
        },
        // Every account gets exactly one profile row, so profile endpoints never need to create one.
        after: async (user) => {
          await prisma.profile.create({ data: { userId: user.id } });
        },
      },
    },
    session: {
      create: {
        // ACTIVE and RESTRICTED accounts may start a session. A suspension whose expiry has
        // passed is reinstated (and audited) first; SUSPENDED, BANNED and DEACTIVATED are refused.
        before: async (session) => {
          await reinstateExpiredSuspensions(session.userId);
          const owner = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { status: true },
          });
          if (!owner || !isVisibleStatus(owner.status)) {
            throw new APIError('FORBIDDEN', { message: 'This account is not active' });
          }
          return { data: session };
        },
      },
    },
  },

  rateLimit: {
    // Brute-force protection on credential endpoints. Disabled in automated tests.
    enabled: env.NODE_ENV !== 'test',
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 10 },
      '/sign-in/username': { window: 60, max: 10 },
      '/sign-up/email': { window: 60, max: 5 },
      '/request-password-reset': { window: 300, max: 3 },
      '/send-verification-email': { window: 300, max: 3 },
    },
  },
});

export type AuthSession = typeof auth.$Infer.Session;
