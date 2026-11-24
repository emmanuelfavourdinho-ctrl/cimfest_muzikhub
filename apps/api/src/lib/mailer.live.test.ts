import { describe, expect, it } from 'vitest';
import { Resend } from 'resend';
import { passwordResetEmail } from './email-templates.js';
import { resendTransport } from './mailer.js';

/**
 * Talks to the REAL Resend API: `RESEND_LIVE=1 npx vitest run mailer.live`.
 * Uses Resend's documented test sender and the delivered@resend.dev sink, so no real
 * person receives anything. Counts 1 email against the daily quota (100/day on Free).
 */
const live = process.env.RESEND_LIVE === '1';

describe.skipIf(!live)('Resend (live)', () => {
  it('accepts a send through our transport and reports it delivered to the test sink', async () => {
    const key = process.env.RESEND_API_KEY;
    expect(key, 'RESEND_API_KEY missing').toBeTruthy();
    const client = new Resend(key);
    const { id } = await resendTransport(client, 'MuzikHub <onboarding@resend.dev>').send({
      to: 'delivered+muzikhub-live-test@resend.dev',
      kind: 'password-reset',
      ...passwordResetEmail({ name: 'Live Test', url: 'https://example.com/reset?token=not-real' }),
    });
    expect(id).toBeTruthy();

    // Ask Resend what happened to that email (accepted ≠ delivered).
    let last = '';
    for (let i = 0; i < 10 && last !== 'delivered'; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const got = await client.emails.get(id!);
      last = got.data?.last_event ?? '';
    }
    expect(last).toBe('delivered');
  }, 30_000);
});
