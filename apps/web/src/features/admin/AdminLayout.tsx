import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import {
  ArrowLeft,
  Flag,
  Gauge,
  Layers,
  LogOut,
  Megaphone,
  ScrollText,
  ShieldCheck,
  Tags,
  Trophy,
  Users,
  UsersRound,
  Wallet,
} from 'lucide-react';
import { BrandMark } from '@/components/layout/BrandMark';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/Dialog';
import { PageLoading, Panel } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { errorMessage } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { adminApi, type AdminMe } from './admin-api';
import { TwoFactorSetup } from './TwoFactorSetup';
import { AdminContext, canDo, Tag } from './ui';

const NAV = [
  { to: '/admin', label: 'Overview', icon: Gauge, end: true, permission: 'overview.view' },
  { to: '/admin/reports', label: 'Reports', icon: Flag, permission: 'reports.manage' },
  { to: '/admin/users', label: 'Users', icon: Users, permission: 'users.view' },
  { to: '/admin/content', label: 'Content', icon: Layers, permission: 'content.moderate' },
  { to: '/admin/pricing', label: 'Pricing', icon: Tags, permission: 'pricing.manage' },
  { to: '/admin/audit', label: 'Audit log', icon: ScrollText, permission: 'audit.view' },
] as const;

/** Areas that need product pillars that don't exist yet — visible, disabled, labelled. */
const PENDING = [
  { label: 'Communities', icon: UsersRound },
  { label: 'Competitions & opportunities', icon: Trophy },
  { label: 'Finance', icon: Wallet },
  { label: 'Announcements', icon: Megaphone },
];

export function AdminLayout() {
  const { data: me, isPending, isError, error, refetch } = useQuery({ queryKey: ['admin', 'me'], queryFn: adminApi.me });
  const [reauthOpen, setReauthOpen] = useState(false);

  if (isPending) return <PageLoading />;
  if (isError) return <LoadFailed message={errorMessage(error)} onRetry={() => void refetch()} />;
  if (!me.isStaff) return <NoAccess />;
  if (!me.accountActive) return <Gate title="Your account is restricted">Staff accounts must be active to use the Admin Console.</Gate>;
  if (!me.twoFactorEnabled)
    return (
      <AdminShell me={me} bare>
        <TwoFactorSetup />
      </AdminShell>
    );

  return (
    <AdminContext.Provider value={{ me, requestReauth: () => setReauthOpen(true) }}>
      <AdminShell me={me}>
        <Outlet />
      </AdminShell>
      <ReauthDialog open={reauthOpen} onClose={() => setReauthOpen(false)} />
    </AdminContext.Provider>
  );
}

function AdminShell({ me, children, bare = false }: { me: AdminMe; children: React.ReactNode; bare?: boolean }) {
  return (
    <div className="min-h-svh bg-surface-base">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-hairline-strong bg-surface-raised/95 px-4 backdrop-blur sm:px-6">
        <div className="flex items-center gap-3">
          <BrandMark to="/admin" />
          <Tag color={me.role === 'ADMIN' ? 'violet' : 'blue'}>{me.role === 'ADMIN' ? 'Admin' : 'Moderator'} console</Tag>
        </div>
        <Button asChild variant="quiet" size="sm">
          <Link to="/home" aria-label="Back to MuzikHub">
            <ArrowLeft /> <span className="hidden sm:inline">Back to MuzikHub</span>
          </Link>
        </Button>
      </header>
      {bare ? (
        <main className="mx-auto max-w-2xl px-4 py-8">{children}</main>
      ) : (
        <div className="md:grid md:grid-cols-[--spacing(55)_minmax(0,1fr)]">
          <AdminNav me={me} />
          <main className="min-w-0 px-4 py-5 sm:px-6 md:px-8 md:py-7">{children}</main>
        </div>
      )}
    </div>
  );
}

function AdminNav({ me }: { me: AdminMe }) {
  const items = NAV.filter((n) => canDo(me, n.permission));
  const link = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex min-h-10 shrink-0 items-center gap-2.5 rounded-lg px-3 text-caption font-medium',
      isActive ? 'bg-surface-chip text-signal' : 'text-text-2 hover:bg-surface-overlay hover:text-foreground',
    );
  return (
    <nav
      aria-label="Admin"
      className="border-b border-hairline-strong bg-surface-raised md:sticky md:top-14 md:h-[calc(100svh_-_--spacing(14))] md:border-r md:border-b-0"
    >
      {/* Phones: horizontal strip. Desktop: sidebar. */}
      <div className="flex gap-1 overflow-x-auto px-3 py-2 md:flex-col md:px-3 md:py-4">
        {items.map((n) => (
          <NavLink key={n.to} to={n.to} end={'end' in n && n.end} className={link}>
            <n.icon className="size-4 shrink-0" /> {n.label}
          </NavLink>
        ))}
      </div>
      <div className="hidden px-3 md:block">
        <p className="mx-3 mt-4 mb-2 text-xs font-bold tracking-wider text-text-3 uppercase">Pending</p>
        {PENDING.map((p) => (
          <span
            key={p.label}
            aria-disabled="true"
            title="Available when this part of MuzikHub is built"
            className="flex min-h-9 cursor-not-allowed items-center gap-2.5 px-3 text-caption text-text-3"
          >
            <p.icon className="size-4 shrink-0" /> <span className="truncate">{p.label}</span>
            <span className="sr-only">(pending)</span>
          </span>
        ))}
      </div>
    </nav>
  );
}

function NoAccess() {
  return (
    <Gate title="No access">The Admin Console is only for MuzikHub staff. If you think you should have access, ask an administrator.</Gate>
  );
}

function Gate({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      <ShieldCheck className="mx-auto mb-3 size-10 text-text-2" aria-hidden />
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 mb-6 text-sm text-text-2">{children}</p>
      <Button asChild variant="outline">
        <Link to="/home">Back to MuzikHub</Link>
      </Button>
    </div>
  );
}

/** Sensitive actions need a recent sign-in (password + second factor). */
function ReauthDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const location = useLocation();
  const qc = useQueryClient();
  return (
    <Dialog open={open} onClose={onClose} title="Confirm it's you">
      <p className="mb-5 text-sm text-text-2">
        This is a sensitive action. For your security, sign in again with your password and authenticator code — then repeat the action.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Not now
        </Button>
        <Button
          onClick={async () => {
            await authClient.signOut();
            qc.clear();
            window.location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
          }}
        >
          <LogOut /> Sign in again
        </Button>
      </div>
    </Dialog>
  );
}

export function AdminPanel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <Panel className={cn('p-4', className)}>{children}</Panel>;
}
