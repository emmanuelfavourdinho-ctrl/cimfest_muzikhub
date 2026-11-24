import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { CreditCard, Gem, LogOut, Settings, ShieldCheck, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { CREATIVE_ROLES, PRIMARY_USES } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/primitives';
import { authClient } from '@/lib/auth-client';
import { useMe } from '@/lib/queries';
import { AccountStatusBanner } from '@/features/auth/AccountStatusBanner';
import { VerifyEmailBanner } from '@/features/auth/VerifyEmailBanner';
import { BrandMark } from './BrandMark';
import { NotificationBell } from '@/features/billing/NotificationBell';
import { mobileNav, primaryNav, type NavItem } from './navigation';

/**
 * Prototype layout: sticky 66px top bar, 206px sidebar (≥ md), and a bottom
 * navigation bar on small screens. Signed-out visitors (e.g. viewing a public
 * profile) get the top bar only, with sign-in actions.
 */
export function AppShell() {
  const { data: me } = useMe();

  return (
    <div className="min-h-svh">
      <TopBar />
      <div className={cn(me && 'md:grid md:grid-cols-[--spacing(51.5)_minmax(0,1fr)]')}>
        {me && <Sidebar />}
        <main id="main" className="mx-auto w-full max-w-427.5 min-w-0 px-4 pt-5 pb-28 sm:px-6 md:px-8 md:pt-7 md:pb-10">
          <AccountStatusBanner />
          <VerifyEmailBanner />
          <Outlet />
        </main>
      </div>
      {me && <MobileNav username={me.profile.username} />}
    </div>
  );
}

function TopBar() {
  const { data: me } = useMe();
  return (
    <header className="sticky top-0 z-30 flex h-14.75 items-center justify-between border-b border-hairline-strong header-surface px-4 sm:h-16.5 sm:px-8">
      <BrandMark to={me ? '/home' : '/'} />
      {me ? (
        <div className="flex items-center gap-1 sm:gap-2">
          <NotificationBell />
          <AccountMenu />
        </div>
      ) : (
        <div className="flex items-center gap-1 sm:gap-2">
          <Button asChild variant="quiet" size="sm">
            <Link to="/login">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/register">
              Join<span className="hidden sm:inline"> MuzikHub</span>
            </Link>
          </Button>
        </div>
      )}
    </header>
  );
}

function AccountMenu() {
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  if (!me) return null;

  async function signOut() {
    setOpen(false);
    const { error } = await authClient.signOut();
    if (error) {
      toast.error("Couldn't sign out. Check your connection and try again.");
      return;
    }
    // Drop every cached response that belonged to this account.
    queryClient.clear();
    void navigate('/', { replace: true });
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 items-center gap-2 rounded-full p-1 hover:bg-surface-chip"
      >
        <Avatar name={me.profile.name} image={me.profile.image} className="size-8.5 text-xs" />
        <span className="sr-only">Account menu</span>
      </button>
      {open && (
        <>
          <button type="button" aria-label="Close menu" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-xl border border-control-border bg-popover p-1.5 shadow-e3"
          >
            <div className="border-b border-hairline-strong px-3 py-2.5">
              <p className="truncate text-sm font-semibold">{me.profile.name}</p>
              <p className="truncate text-xs text-text-2">@{me.profile.username}</p>
            </div>
            <MenuLink to={`/u/${me.profile.username}`} icon={UserRound} onSelect={() => setOpen(false)}>
              View profile
            </MenuLink>
            <MenuLink to="/pricing" icon={Gem} onSelect={() => setOpen(false)}>
              Plans
            </MenuLink>
            <MenuLink to="/settings/billing" icon={CreditCard} onSelect={() => setOpen(false)}>
              Billing
            </MenuLink>
            <MenuLink to="/settings/profile" icon={Settings} onSelect={() => setOpen(false)}>
              Edit profile
            </MenuLink>
            {me.platformRole !== 'USER' && (
              <MenuLink to="/admin" icon={ShieldCheck} onSelect={() => setOpen(false)}>
                Admin Console
              </MenuLink>
            )}
            <button
              role="menuitem"
              type="button"
              onClick={signOut}
              className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm text-text-1 hover:bg-surface-chip"
            >
              <LogOut className="size-4" /> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function MenuLink({ to, icon: Icon, children, onSelect }: { to: string; icon: NavItem['icon']; children: string; onSelect: () => void }) {
  return (
    <Link
      role="menuitem"
      to={to}
      onClick={onSelect}
      className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-text-1 hover:bg-surface-chip"
    >
      <Icon className="size-4" /> {children}
    </Link>
  );
}

function Sidebar() {
  const { data: me } = useMe();
  if (!me) return null;
  const roles = me.profile.roles.map((r) => CREATIVE_ROLES[r]);
  const identity =
    roles.length > 0 ? roles.slice(0, 2).join(' · ') : me.profile.primaryUse ? PRIMARY_USES[me.profile.primaryUse].label : 'Member';

  return (
    <aside className="sticky top-16.5 hidden h-[calc(100svh_-_--spacing(16.5))] flex-col border-r border-hairline-strong bg-surface-raised px-3 pt-5 pb-4 md:flex">
      <p className="mx-3 mb-3 text-xs font-extrabold tracking-wider text-text-3 uppercase">Creative platform</p>
      <nav aria-label="Main" className="flex flex-col gap-1">
        {primaryNav
          .filter((item) => item.to)
          .map((item) => (
            <SidebarItem key={item.label} item={item} />
          ))}
        {/* Unbuilt areas: visible so the product's shape is clear, but grouped and disabled. */}
        <p className="mx-3 mt-5 mb-2 text-xs font-extrabold tracking-wider text-text-3 uppercase">Coming soon</p>
        {primaryNav
          .filter((item) => !item.to)
          .map((item) => (
            <SidebarItem key={item.label} item={item} />
          ))}
      </nav>
      <div className="mt-auto rounded-m border border-control-border bg-[linear-gradient(140deg,var(--p-chip),var(--p-raised))] p-3">
        <p className="text-xs tracking-wide text-text-2 uppercase">Your profile</p>
        <p className="my-1.5 truncate text-caption font-bold">{identity}</p>
        <Link
          to="/settings/profile"
          className="block rounded-lg border border-control-border bg-surface-chip px-2.5 py-2 text-center text-xs font-bold text-text-1 hover:brightness-110"
        >
          Edit profile
        </Link>
      </div>
    </aside>
  );
}

function SidebarItem({ item }: { item: NavItem }) {
  const Icon = item.icon;
  const base = 'flex min-h-10 items-center gap-3 rounded-lg px-3 text-caption font-semibold transition';
  if (!item.to) {
    return (
      <span aria-disabled="true" title="Not available yet" className={cn(base, 'min-h-9 cursor-not-allowed text-text-3')}>
        <Icon className="size-4.25 shrink-0" />
        <span className="truncate">{item.label}</span>
        <span className="sr-only">(not available yet)</span>
      </span>
    );
  }
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          base,
          isActive
            ? 'bg-surface-chip text-signal shadow-[inset_--spacing(0.5)_0_0_var(--p-accent)]'
            : 'text-text-2 hover:bg-surface-chip hover:text-text-1',
        )
      }
    >
      <Icon className="size-4.25 shrink-0" />
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}

function MobileNav({ username }: { username: string }) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 flex h-16.75 items-center justify-around border-t border-control-border bg-surface-raised/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      {mobileNav(username).map((item) => {
        const Icon = item.icon;
        const icon = (
          <span
            className={cn(
              item.emphasis && '-mt-4 rounded-full bg-signal p-2.5 text-on-signal shadow-glow',
              item.emphasis && !item.to && 'opacity-50',
            )}
          >
            <Icon className="size-5" />
          </span>
        );
        if (!item.to) {
          return (
            <span key={item.label} aria-disabled="true" className="flex min-w-15 flex-col items-center gap-0.5 text-xs text-text-3">
              {icon}
              {item.label}
              <span className="sr-only">(not available yet)</span>
            </span>
          );
        }
        return (
          <NavLink
            key={item.label}
            to={item.to}
            className={({ isActive }) =>
              cn('flex min-h-12 min-w-15 flex-col items-center justify-center gap-0.5 text-xs', isActive ? 'text-signal' : 'text-text-2')
            }
          >
            {icon}
            {item.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
