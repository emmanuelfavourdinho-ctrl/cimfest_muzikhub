import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnvironment } from '../config/env.js';
import { escapeHtml, passwordResetEmail, verificationEmail } from './email-templates.js';
import {
  EmailDeliveryError,
  maskEmail,
  RECIPIENT_LIMIT,
  resendTransport,
  resetRecipientLimits,
  sendEmail,
  setEmailTransport,
  testOutbox,
  type EmailMessage,
  type ResendLike,
} from './mailer.js';

const FAKE_KEY = 're_test_000000000000000000000000000';

/** Stand-in for the official SDK client: records calls, returns { data, error } like the SDK. */
function fakeResend(result: unknown = { data: { id: 'email_123' }, error: null, headers: null }) {
  const send = vi.fn(async () => result);
  return { client: { emails: { send } } as unknown as ResendLike, send };
}

const message = (overrides: Partial<EmailMessage> = {}): EmailMessage => ({
  to: 'ayo@example.test',
  kind: 'password-reset',
  ...passwordResetEmail({ name: 'Ayo', url: 'https://muzikhub.test/reset?token=abc' }),
  ...overrides,
});

beforeEach(() => {
  resetRecipientLimits();
  testOutbox.length = 0;
});
afterEach(() => {
  setEmailTransport(null);
  vi.restoreAllMocks();
});

describe('resendTransport', () => {
  it('sends through the SDK with sender, both parts, a tag and the idempotency key', async () => {
    const { client, send } = fakeResend();
    const result = await resendTransport(client, 'MuzikHub <no-reply@mail.muzikhub.test>').send(
      message({ idempotencyKey: 'password-reset/abc' }),
    );
    expect(result).toEqual({ id: 'email_123' });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'MuzikHub <no-reply@mail.muzikhub.test>',
        to: ['ayo@example.test'],
        subject: 'Reset your MuzikHub password',
        html: expect.stringContaining('Reset your password'),
        text: expect.stringContaining('https://muzikhub.test/reset?token=abc'),
        tags: [{ name: 'kind', value: 'password-reset' }],
      }),
      { idempotencyKey: 'password-reset/abc' },
    );
  });

  it('turns a Resend error into EmailDeliveryError and logs only the code and a masked address', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { client } = fakeResend({
      data: null,
      error: { name: 'invalid_from_address', message: 'You can only send to owner@private.example', statusCode: 403 },
      headers: null,
    });
    const send = resendTransport(client, 'x@y.test').send(message());
    await expect(send).rejects.toBeInstanceOf(EmailDeliveryError);
    await expect(send).rejects.toThrow('Email delivery failed (invalid_from_address)');

    const logged = errorLog.mock.calls.flat().join(' ');
    expect(logged).toContain('invalid_from_address');
    expect(logged).toContain('ay***@example.test');
    expect(logged).not.toContain('ayo@example.test');
    expect(logged).not.toContain('owner@private.example'); // provider message not logged
    expect(logged).not.toContain('token=abc'); // no link / token
  });

  it('maps network failures to EmailDeliveryError without leaking details', async () => {
    const client = {
      emails: {
        send: vi.fn(async () => {
          throw new Error(`fetch failed with key ${FAKE_KEY}`);
        }),
      },
    } as unknown as ResendLike;
    const error = await resendTransport(client, 'x@y.test')
      .send(message())
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect((error as Error).message).toBe('Email delivery failed (network_error)');
  });
});

describe('sendEmail — per-recipient limit', () => {
  it(`allows ${RECIPIENT_LIMIT.max} emails per recipient per hour, then skips without sending`, async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { client, send } = fakeResend();
    setEmailTransport(resendTransport(client, 'x@y.test'));

    for (let i = 0; i < RECIPIENT_LIMIT.max; i++) expect(await sendEmail(message())).toBe(true);
    expect(await sendEmail(message())).toBe(false);
    expect(await sendEmail(message({ to: 'AYO@example.test ' }))).toBe(false); // same inbox, different spelling
    expect(send).toHaveBeenCalledTimes(RECIPIENT_LIMIT.max);

    // Other recipients and other email kinds are unaffected.
    expect(await sendEmail(message({ to: 'zuri@example.test' }))).toBe(true);
    expect(await sendEmail(message({ kind: 'email-verification' }))).toBe(true);
  });
});

describe('templates', () => {
  it('escape user-provided names in HTML (but keep them readable in text)', () => {
    const evil = '<img src=x onerror=alert(1)>"Ayo"';
    for (const email of [
      passwordResetEmail({ name: evil, url: 'https://a.test/r' }),
      verificationEmail({ name: evil, url: 'https://a.test/v' }),
    ]) {
      expect(email.html).not.toContain('<img src=x');
      expect(email.html).toContain(escapeHtml(evil));
      expect(email.text).toContain(evil);
    }
  });

  it('never puts a non-http link in an href', () => {
    const email = passwordResetEmail({ name: 'A', url: 'javascript:alert(1)' });
    expect(email.html).not.toContain('javascript:');
  });

  it('masks addresses for logs', () => {
    expect(maskEmail('kora.beats@example.com')).toBe('ko***@example.com');
  });
});

describe('email configuration rules', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    BETTER_AUTH_SECRET: 'x'.repeat(40),
    BETTER_AUTH_URL: 'https://api.muzikhub.test',
  };
  const problems = (source: Record<string, string>) => {
    const r = parseEnvironment(source);
    return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
  };

  it('defaults: test → capture, development → console', () => {
    const test = parseEnvironment({ ...base, NODE_ENV: 'test' });
    const dev = parseEnvironment({ ...base, NODE_ENV: 'development' });
    expect(test.success && test.data.EMAIL_TRANSPORT).toBe('capture');
    expect(dev.success && dev.data.EMAIL_TRANSPORT).toBe('console');
  });

  it('production refuses to start without RESEND_API_KEY and EMAIL_FROM', () => {
    expect(problems({ ...base, NODE_ENV: 'production' })).toEqual(expect.arrayContaining(['RESEND_API_KEY', 'EMAIL_FROM']));
    expect(
      problems({ ...base, NODE_ENV: 'production', EMAIL_TRANSPORT: 'console', RESEND_API_KEY: FAKE_KEY, EMAIL_FROM: 'a@b.test' }),
    ).toContain('EMAIL_TRANSPORT');
    expect(
      problems({ ...base, NODE_ENV: 'production', RESEND_API_KEY: FAKE_KEY, EMAIL_FROM: 'MuzikHub <no-reply@mail.muzikhub.test>' }),
    ).toEqual([]);
  });

  it('validates the key prefix and sender format, without echoing values', () => {
    const r = parseEnvironment({
      ...base,
      NODE_ENV: 'development',
      EMAIL_TRANSPORT: 'resend',
      RESEND_API_KEY: 'sk_wrong_secret_value',
      EMAIL_FROM: 'not an address',
    });
    expect(r.success).toBe(false);
    const text = JSON.stringify(r.error?.issues);
    expect(text).not.toContain('sk_wrong_secret_value');
    expect(r.error?.issues.map((i) => i.path.join('.'))).toEqual(expect.arrayContaining(['RESEND_API_KEY', 'EMAIL_FROM']));
  });
});
