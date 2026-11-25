import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Download, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { Eyebrow, Hint, Panel } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { authClient, unwrap } from '@/lib/auth-client';

type Step = { kind: 'password' } | { kind: 'scan'; totpURI: string; backupCodes: string[] } | { kind: 'done' };

/**
 * Required two-factor enrolment for staff, using Better Auth's two-factor plugin:
 * confirm password → scan QR (or enter key) → save backup codes → confirm with a first code.
 * Two-factor only switches on after that first valid code.
 */
export function TwoFactorSetup() {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (step.kind !== 'scan') return;
    // Rendered locally — the secret never leaves the browser to a QR service.
    void import('qrcode').then((QR) => QR.toDataURL(step.totpURI, { margin: 1, width: 220 })).then(setQr);
  }, [step]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await unwrap(authClient.twoFactor.enable({ password, issuer: 'MuzikHub', method: 'totp' }));
      if (!data || !('totpURI' in data)) throw new Error('Could not start authenticator setup. Please try again.');
      setPassword('');
      setStep({ kind: 'scan', totpURI: data.totpURI, backupCodes: data.backupCodes });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await unwrap(authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, '') }));
      toast.success('Two-step verification is on');
      await qc.invalidateQueries({ queryKey: ['admin'] });
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      setError(errorMessage(err, "That code didn't work. Check the time on your phone and try again."));
      setBusy(false);
    }
  }

  return (
    <Panel className="p-5 sm:p-7">
      <Eyebrow>Staff security</Eyebrow>
      <h1 className="mt-2 text-2xl font-bold">Set up two-step verification</h1>
      <p className="mt-1 mb-5 text-sm text-text-2">
        Staff accounts can change other people's accounts, so the Admin Console requires an authenticator app (Google Authenticator,
        Microsoft Authenticator, 1Password, Authy…).
      </p>
      <FormError message={error} />

      {step.kind === 'password' && (
        <form onSubmit={start} noValidate>
          <Field label="Confirm your password">
            {(a) => (
              <Input
                {...a}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" disabled={busy || !password}>
            <KeyRound /> {busy ? 'Starting…' : 'Continue'}
          </Button>
        </form>
      )}

      {step.kind === 'scan' && (
        <form onSubmit={confirm} noValidate className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-[--spacing(55)_1fr]">
            <div className="flex aspect-square w-55 items-center justify-center rounded-xl bg-white p-2">
              {qr ? (
                <img src={qr} alt="QR code to add MuzikHub to your authenticator app" className="size-full" />
              ) : (
                <span className="text-xs text-black">Generating…</span>
              )}
            </div>
            <div className="text-sm">
              <p className="font-semibold">1. Scan this code with your authenticator app</p>
              <p className="mt-1 text-text-2">Can't scan? Enter this key manually:</p>
              <code className="mt-1 block rounded-md bg-surface-raised px-2 py-1.5 font-mono text-xs break-all">
                {new URL(step.totpURI).searchParams.get('secret')}
              </code>
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold">2. Save your backup codes</p>
            <Hint className="mb-2">
              Each code works once if you lose your phone. Store them somewhere safe (a password manager). They won't be shown again.
            </Hint>
            <ul
              className="grid grid-cols-2 gap-1.5 rounded-xl border border-hairline-strong bg-surface-raised p-3 font-mono text-sm sm:grid-cols-5"
              aria-label="Backup codes"
            >
              {step.backupCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(step.backupCodes.join('\n')).then(() => toast.success('Copied'));
                }}
              >
                <Copy /> Copy
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([`MuzikHub backup codes\n\n${step.backupCodes.join('\n')}\n`], { type: 'text/plain' }),
                  );
                  Object.assign(document.createElement('a'), { href: url, download: 'muzikhub-backup-codes.txt' }).click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download /> Download
              </Button>
            </div>
            <label className="mt-3 flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="size-4 accent-signal" />
              I've saved my backup codes somewhere safe
            </label>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold">3. Enter the 6-digit code from the app</p>
            <Field label="Authentication code">
              {(a) => (
                <Input
                  {...a}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  placeholder="123456"
                />
              )}
            </Field>
            <Button type="submit" disabled={busy || !saved || code.replace(/\s/g, '').length !== 6}>
              {busy ? 'Verifying…' : 'Turn on two-step verification'}
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}
