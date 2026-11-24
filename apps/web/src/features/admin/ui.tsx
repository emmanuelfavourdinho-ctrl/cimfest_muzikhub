import { createContext, useContext, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, FormError, Textarea } from '@/components/ui/form';
import { ApiRequestError, errorMessage } from '@/lib/api';
import type { AdminMe } from './admin-api';

// ── Context ──────────────────────────────────────────────────
export const AdminContext = createContext<{ me: AdminMe; requestReauth: () => void } | null>(null);
export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdmin outside AdminLayout');
  return ctx;
}
export const canDo = (me: AdminMe, p: AdminMe['permissions'][number]) => me.permissions.includes(p);

/**
 * Runs an admin action, refreshes admin data afterwards, and turns REAUTH_REQUIRED into the
 * "sign in again" prompt. The server is the authority: the UI only reflects its answer.
 */
export function useAdminAction() {
  const qc = useQueryClient();
  const { requestReauth } = useAdmin();
  return async (fn: () => Promise<unknown>, success: string): Promise<boolean> => {
    try {
      await fn();
      toast.success(success);
      await qc.invalidateQueries({ queryKey: ['admin'] });
      return true;
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'REAUTH_REQUIRED') requestReauth();
      else toast.error(errorMessage(e));
      return false;
    }
  };
}

// ── Pills ────────────────────────────────────────────────────
const tone = {
  green: 'border-control-border bg-surface-chip text-signal',
  gray: 'border-control-border bg-surface-chip text-text-2',
  gold: 'border-warning/40 bg-warning/15 text-warning',
  red: 'border-destructive/40 bg-destructive/10 text-danger',
  blue: 'border-info/40 bg-info/15 text-info',
  violet: 'border-violet/40 bg-violet/15 text-violet',
} as const;

export function Tag({ children, color = 'gray', className }: { children: ReactNode; color?: keyof typeof tone; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        tone[color],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusTag({ status }: { status: string }) {
  const map: Record<string, keyof typeof tone> = {
    ACTIVE: 'green',
    RESTRICTED: 'gold',
    SUSPENDED: 'red',
    BANNED: 'red',
    DEACTIVATED: 'gray',
  };
  return <Tag color={map[status] ?? 'gray'}>{status.charAt(0) + status.slice(1).toLowerCase()}</Tag>;
}
export function RoleTag({ role }: { role: string }) {
  if (role === 'USER') return null;
  return <Tag color={role === 'ADMIN' ? 'violet' : 'blue'}>{role === 'ADMIN' ? 'Admin' : 'Moderator'}</Tag>;
}
export function ReportStatusTag({ status, escalated }: { status: string; escalated?: boolean }) {
  const map: Record<string, keyof typeof tone> = { PENDING: 'gold', UNDER_REVIEW: 'blue', RESOLVED: 'green', DISMISSED: 'gray' };
  return (
    <span className="inline-flex gap-1">
      <Tag color={map[status] ?? 'gray'}>
        {status === 'UNDER_REVIEW' ? 'Under review' : status.charAt(0) + status.slice(1).toLowerCase()}
      </Tag>
      {escalated && <Tag color="red">Escalated</Tag>}
    </span>
  );
}

// ── Time ─────────────────────────────────────────────────────
export function Ago({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-text-3">—</span>;
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  const text =
    s < 60
      ? 'just now'
      : s < 3600
        ? `${Math.floor(s / 60)}m ago`
        : s < 86400
          ? `${Math.floor(s / 3600)}h ago`
          : s < 30 * 86400
            ? `${Math.floor(s / 86400)}d ago`
            : d.toLocaleDateString();
  return (
    <time dateTime={iso} title={d.toLocaleString()}>
      {text}
    </time>
  );
}

// ── Layout pieces ────────────────────────────────────────────
export function AdminHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 border-b border-hairline-strong pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-text-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Data-dense table that scrolls inside its own box on small screens (never the page). */
export function DataTable({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-hairline-strong bg-surface-raised">
      <table className="w-full min-w-160 text-left text-caption [&_td]:border-t [&_td]:border-hairline-strong [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-top [&_th]:px-3 [&_th]:py-2 [&_th]:text-xs [&_th]:font-semibold [&_th]:tracking-wide [&_th]:text-text-2 [&_th]:uppercase [&_tbody_tr:hover]:bg-surface-overlay">
        {children}
      </table>
    </div>
  );
}

export function EmptyRow({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={cols} className="!py-10 text-center text-sm text-text-2">
        {children}
      </td>
    </tr>
  );
}

export function FilterTabs<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="mb-4 flex gap-1 overflow-x-auto">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'min-h-9 shrink-0 rounded-lg px-3 text-xs font-semibold',
            value === o.value ? 'bg-surface-chip text-signal' : 'text-text-2 hover:bg-surface-overlay',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Every consequential action asks for a reason (stored in the audit log). */
export function ReasonDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  destructive,
  onConfirm,
  children,
  reasonLabel = 'Reason (recorded in the audit log)',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: (reason: string) => Promise<boolean>;
  children?: ReactNode;
  reasonLabel?: string;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooShort = reason.trim().length < 5;
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      {description && <div className="mb-4 text-sm text-text-2">{description}</div>}
      {children}
      <FormError message={error} />
      <Field label={reasonLabel} hint="At least 5 characters.">
        {(a) => <Textarea {...a} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant={destructive ? 'destructive' : 'primary'}
          disabled={busy || tooShort}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const ok = await onConfirm(reason.trim());
            setBusy(false);
            if (ok) {
              setReason('');
              onClose();
            }
          }}
        >
          {busy ? 'Working…' : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: ReactNode; href?: string }) {
  const body = (
    <>
      <dt className="text-xs text-text-2">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-text-3">{hint}</dd>}
    </>
  );
  return href ? (
    <a href={href} className="block rounded-lg px-3 py-2.5 hover:bg-surface-overlay">
      {body}
    </a>
  ) : (
    <div className="px-3 py-2.5">{body}</div>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-xl border border-hairline-strong bg-surface-raised">
      <div className="flex items-center justify-between border-b border-hairline-strong px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <div className="p-2">{children}</div>
    </section>
  );
}
