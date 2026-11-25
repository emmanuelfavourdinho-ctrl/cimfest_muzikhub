import { z } from 'zod';

/**
 * GET /api/v1/capabilities — what this deployment can do right now, so the web app never guesses.
 * Public and cacheable; contains no configuration values, provider names or secrets.
 *
 * email.available is false in restricted-email mode (no verified sender): password reset and
 * email confirmation are then unavailable, and so is anything that needs a confirmed email
 * (organiser access, staff roles) through the normal flows.
 */
export const EMAIL_FEATURES = ['password-reset', 'email-verification'] as const;
export type EmailFeature = (typeof EMAIL_FEATURES)[number];

export const capabilitiesSchema = z.object({
  email: z.object({
    available: z.boolean(),
    /** Features that depend on email and are unavailable right now (empty when email works). */
    unavailableFeatures: z.array(z.enum(EMAIL_FEATURES)),
  }),
});
export type Capabilities = z.infer<typeof capabilitiesSchema>;

/** Stable error code for email-dependent auth endpoints in restricted-email mode (HTTP 503). */
export const EMAIL_UNAVAILABLE_CODE = 'EMAIL_UNAVAILABLE';
