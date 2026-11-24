/**
 * Transactional email templates (password reset, email verification).
 * Rules: every user-supplied value is HTML-escaped; every email has a plain-text part;
 * no remote images or tracking; inline styles only (email clients ignore <style> blocks).
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes text for HTML element content and attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

/** Only http(s) links go into an href — anything else is replaced, never rendered. */
function safeHref(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? escapeHtml(parsed.toString()) : '#';
  } catch {
    return '#';
  }
}

/** Deep Forest / Emerald / Off White, as in the product. */
function layout({ preheader, heading, body, cta, url, footer }: { preheader: string; heading: string; body: string; cta: string; url: string; footer: string }) {
  const href = safeHref(url);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:#061612;font-family:Inter,Arial,Helvetica,sans-serif;color:#f1f9f5">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#061612;padding:32px 16px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0d2720;border:1px solid #21463a;border-radius:18px">
<tr><td style="padding:28px 28px 8px;font-size:20px;font-weight:800;letter-spacing:-0.5px">Muzik<span style="color:#17d995">Hub</span></td></tr>
<tr><td style="padding:8px 28px 0"><h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#f1f9f5">${escapeHtml(heading)}</h1>
<div style="font-size:15px;line-height:1.6;color:#c4dfd1">${body}</div></td></tr>
<tr><td style="padding:24px 28px">
<a href="${href}" style="display:inline-block;background:#17d995;color:#032216;text-decoration:none;font-weight:800;font-size:14px;padding:12px 22px;border-radius:10px">${escapeHtml(cta)}</a>
</td></tr>
<tr><td style="padding:0 28px 24px;font-size:12px;line-height:1.6;color:#9bb8aa">If the button doesn't work, copy this link into your browser:<br><a href="${href}" style="color:#73e1b8;word-break:break-all">${href}</a></td></tr>
<tr><td style="padding:16px 28px 28px;border-top:1px solid #21463a;font-size:12px;line-height:1.6;color:#638579">${escapeHtml(footer)}</td></tr>
</table></td></tr></table></body></html>`;
}

export function passwordResetEmail({ name, url }: { name: string; url: string }): RenderedEmail {
  const footer = "If you didn't ask to reset your password, you can ignore this email — your password won't change.";
  return {
    subject: 'Reset your MuzikHub password',
    html: layout({
      preheader: 'Use this link to choose a new password. It expires in 1 hour.',
      heading: 'Reset your password',
      body: `<p style="margin:0 0 12px">Hi ${escapeHtml(name)},</p><p style="margin:0">Use the button below to choose a new password. The link expires in <strong>1 hour</strong> and can be used once. For your security, you'll be signed out on your other devices.</p>`,
      cta: 'Choose a new password',
      url,
      footer,
    }),
    text: `Hi ${name},\n\nUse this link to choose a new password. It expires in 1 hour and can be used once:\n\n${url}\n\n${footer}\n\n— MuzikHub`,
  };
}

export function verificationEmail({ name, url }: { name: string; url: string }): RenderedEmail {
  const footer = "If you didn't create a MuzikHub account, you can ignore this email.";
  return {
    subject: 'Confirm your MuzikHub email',
    html: layout({
      preheader: 'Confirm your email address to finish setting up your account.',
      heading: 'Confirm your email',
      body: `<p style="margin:0 0 12px">Welcome to MuzikHub, ${escapeHtml(name)}!</p><p style="margin:0">Please confirm this is your email address. The link expires in <strong>1 hour</strong>.</p>`,
      cta: 'Confirm my email',
      url,
      footer,
    }),
    text: `Welcome to MuzikHub, ${name}!\n\nConfirm your email address (the link expires in 1 hour):\n\n${url}\n\n${footer}\n\n— MuzikHub`,
  };
}
