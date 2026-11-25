import { createHash } from 'node:crypto';
import { Resend } from 'resend';
import { env } from '../config/env.js';
import type { RenderedEmail } from './email-templates.js';

export interface EmailMessage extends RenderedEmail {
  to: string;
  /** Short machine label for logs and Resend tags, e.g. "password-reset". */
  kind: 'password-reset' | 'email-verification';
  /** Same key → Resend sends at most once (24 h). Use for safe retries of one logical email. */
  idempotencyKey?: string;
}

/** Where emails go. Exactly one is active, chosen by EMAIL_TRANSPORT (see config/env.ts). */
export interface EmailTransport {
  readonly name: 'capture' | 'console' | 'resend' | 'disabled';
  send(message: EmailMessage): Promise<{ id: string | null }>;
}

/** The subset of the official Resend SDK we use — lets tests inject a fake client. */
export interface ResendLike {
  emails: { send: Resend['emails']['send'] };
}

export class EmailDeliveryError extends Error {
  constructor(readonly code: string) {
    // The code comes from Resend's fixed error vocabulary; no recipient, content or key.
    super(`Email delivery failed (${code})`);
    this.name = 'EmailDeliveryError';
  }
}

/**
 * Thrown when something tries to send while email is unavailable (restricted-email mode).
 * Callers must not treat the message as sent; flows that need email are refused before this.
 */
export class EmailUnavailableError extends Error {
  readonly code = 'EMAIL_UNAVAILABLE';
  constructor(readonly kind: EmailMessage['kind']) {
    super(`Email is unavailable: a ${kind} email cannot be sent`);
    this.name = 'EmailUnavailableError';
  }
}

/** Never log full addresses: "ad***@example.com". */
export function maskEmail(address: string): string {
  const [local = '', domain = ''] = address.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

// ── Transports ───────────────────────────────────────────────

/** Tests: kept in memory so tests can read links. Never sent. */
export const testOutbox: EmailMessage[] = [];
export const captureTransport: EmailTransport = {
  name: 'capture',
  async send(message) {
    testOutbox.push(message);
    return { id: null };
  },
};

/** Development: printed to the API console (so you can click the link). Never sent. */
export const consoleTransport: EmailTransport = {
  name: 'console',
  async send(message) {
    // Printing the email IS this transport's job (development only, never sent).
    // oxlint-disable-next-line no-console
    console.log(
      `\n──── EMAIL (dev console transport — not sent) ────\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n──────────────────────────────────────────────────\n`,
    );
    return { id: null };
  },
};

/**
 * Restricted-email mode: there is no sender. Every send fails loudly with a typed error rather
 * than being dropped, so nothing can ever be reported as sent.
 */
export const disabledTransport: EmailTransport = {
  name: 'disabled',
  async send(message) {
    throw new EmailUnavailableError(message.kind);
  },
};

/** Real delivery through Resend. The SDK returns { data, error } instead of throwing. */
export function resendTransport(client: ResendLike, from: string): EmailTransport {
  return {
    name: 'resend',
    async send(message) {
      let result: Awaited<ReturnType<ResendLike['emails']['send']>>;
      try {
        result = await client.emails.send(
          {
            from,
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
            tags: [{ name: 'kind', value: message.kind }],
          },
          message.idempotencyKey ? { idempotencyKey: message.idempotencyKey } : undefined,
        );
      } catch {
        // Network-level failure (DNS, TLS, timeout).
        throw new EmailDeliveryError('network_error');
      }
      if (result.error) {
        // Log only the error code — Resend messages can contain addresses.
        console.error(`[email] Resend rejected ${message.kind} to ${maskEmail(message.to)}: ${result.error.name}`);
        throw new EmailDeliveryError(result.error.name);
      }
      return { id: result.data?.id ?? null };
    },
  };
}

function defaultTransport(): EmailTransport {
  switch (env.EMAIL_TRANSPORT) {
    case 'capture':
      return captureTransport;
    case 'console':
      return consoleTransport;
    case 'resend':
      // env.ts guarantees both are present when EMAIL_TRANSPORT is "resend".
      return resendTransport(new Resend(env.RESEND_API_KEY), env.EMAIL_FROM!);
    case 'disabled':
      return disabledTransport;
  }
}

let transport: EmailTransport | null = null;
export function emailTransport(): EmailTransport {
  transport ??= defaultTransport();
  return transport;
}
/** False in restricted-email mode: password reset and email confirmation are then unavailable. */
export function emailAvailable(): boolean {
  return emailTransport().name !== 'disabled';
}
/** For tests: swap in a transport (e.g. resendTransport with a fake client). */
export function setEmailTransport(next: EmailTransport | null) {
  transport = next;
}

// ── Per-recipient limit ──────────────────────────────────────
/**
 * Better Auth already rate-limits these endpoints per IP. This second limit is per
 * recipient, so someone rotating IPs still can't flood one inbox. In memory — enough
 * for a single API instance; move to the database/Redis when running several.
 */
export const RECIPIENT_LIMIT = { max: 3, windowMs: 60 * 60 * 1000 };
const recentSends = new Map<string, number[]>();

function recipientKey(address: string, kind: string) {
  // Hashed so the map never holds raw addresses.
  return createHash('sha256').update(`${kind}:${address.trim().toLowerCase()}`).digest('hex');
}

function allowRecipient(address: string, kind: string, now = Date.now()): boolean {
  const key = recipientKey(address, kind);
  const recent = (recentSends.get(key) ?? []).filter((t) => now - t < RECIPIENT_LIMIT.windowMs);
  if (recent.length >= RECIPIENT_LIMIT.max) {
    recentSends.set(key, recent);
    return false;
  }
  recent.push(now);
  recentSends.set(key, recent);
  return true;
}

export function resetRecipientLimits() {
  recentSends.clear();
}

/**
 * Sends one transactional email. Returns false (without sending) when the recipient
 * limit is reached — the caller's response stays the same, so this can't be used to
 * probe accounts. Delivery failures throw EmailDeliveryError.
 */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  if (!emailAvailable()) throw new EmailUnavailableError(message.kind);
  if (!allowRecipient(message.to, message.kind)) {
    console.warn(`[email] ${message.kind} to ${maskEmail(message.to)} skipped: per-recipient limit reached`);
    return false;
  }
  await emailTransport().send(message);
  return true;
}
