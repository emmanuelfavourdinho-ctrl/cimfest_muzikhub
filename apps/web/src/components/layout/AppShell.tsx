import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { LogOut, Settings, ShieldCheck, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { CREATIVE_ROLES, PRIMARY_USES } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/primitives';
import { authClient } from '@/lib/auth-client';
import { useMe } from '@/lib/queries';
import { AccountStatusBanner } from '@/features/auth/AccountStatusBanner';
import { VerifyEmailBanner } from '@/features/auth/VerifyEmailBanner';
import { BrandMark } from './BrandMark';
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
      <div className={cn(me && 'md:grid md:grid-cols-[206px_minmax(0,1fr)]')}>
        {me && <Sidebar />}
        <main id="main" className="mx-auto w-full max-w-[1710px] min-w-0 px-4 pt-5 pb-28 sm:px-6 md:px-8 md:pt-7 md:pb-10">
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
    <header className="sticky top-0 z-30 flex h-[59px] items-center justify-between border-b border-[#214639] bg-[rgba(5,20,16,.94)] px-4 backdrop-blur-lg sm:h-[66px] sm:px-8">
      <BrandMark to={me ? '/home' : '/'} />
      {me ? (
        <AccountMenu />
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
        className="flex min-h-11 items-center gap-2 rounded-full p-1 hover:bg-forest-700"
      >
        <Avatar name={me.profile.name} image={me.profile.image} className="size-[34px] text-xs" />
        <span className="sr-only">Account menu</span>
      </button>
      {open && (
        <>
          <button type="button" aria-label="Close menu" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-xl border border-[#448969] bg-popover p-1.5 shadow-[0_20px_60px_#000a]">
            <div className="border-b border-line px-3 py-2.5">
              <p className="truncate text-sm font-semibold">{me.profile.name}</p>
              <p className="truncate text-xs text-sage">@{me.profile.username}</p>
            </div>
            <MenuLink to={`/u/${me.profile.username}`} icon={UserRound} onSelect={() => setOpen(false)}>
              View profile
            </MenuLink>
            <MenuLink to="/settings/profile" icon={Settings} onSelect={() => setOpen(false)}>
              Edit profile
            </MenuLink>
            {me.platformRole !== 'USER' && (
              <MenuLink to="/admin" icon={ShieldCheck} onSelect={() => setOpen(false)}>
                Admin Console
              </MenuLink>
            )}
            <button role="menuitem" type="button" onClick={signOut} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm text-[#d9f1e6] hover:bg-forest-700">
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
    <Link role="menuitem" to={to} onClick={onSelect} className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-[#d9f1e6] hover:bg-forest-700">
      <Icon className="size-4" /> {children}
    </Link>
  );
}

function Sidebar() {
  const { data: me } = useMe();
  if (!me) return null;
  const roles = me.profile.roles.map((r) => CREATIVE_ROLES[r]);
  const identity = roles.length > 0 ? roles.slice(0, 2).join(' · ') : me.profile.primaryUse ? PRIMARY_USES[me.profile.primaryUse].label : 'Member';

  return (
    <aside className="sticky top-[66px] hidden h-[calc(100svh-66px)] flex-col border-r border-[#214638] bg-forest-925 px-3 pt-5 pb-4 md:flex">
      <p className="mx-3 mb-3 text-[10px] font-extrabold tracking-[0.16em] text-[#71998a] uppercase">Creative platform</p>
      <nav aria-label="Main" className="flex flex-col gap-1">
        {primaryNav.filter((item) => item.to).map((item) => (
          <SidebarItem key={item.label} item={item} />
        ))}
        {/* Unbuilt areas: visible so the product's shape is clear, but grouped and disabled. */}
        <p className="mx-3 mt-5 mb-2 text-[10px] font-extrabold tracking-[0.16em] text-[#55776a] uppercase">Coming soon</p>
        {primaryNav.filter((item) => !item.to).map((item) => (
          <SidebarItem key={item.label} item={item} />
        ))}
      </nav>
      <div className="mt-auto rounded-[14px] border border-[#255846] bg-[linear-gradient(140deg,#123f2e,#0d291f)] p-3">
        <p className="text-[10px] tracking-wide text-[#8cb4a3] uppercase">Your profile</p>
        <p className="my-1.5 truncate text-[13px] font-bold">{identity}</p>
        <Link to="/settings/profile" className="block rounded-lg border border-[#327d5d] bg-[#10412d] px-2.5 py-2 text-center text-[11px] font-bold text-[#b9f9d9] hover:brightness-110">
          Edit profile
        </Link>
      </div>
    </aside>
  );
}

function SidebarItem({ item }: { item: NavItem }) {
  const Icon = item.icon;
  const base = 'flex min-h-10 items-center gap-3 rounded-[11px] px-3 text-[13px] font-semibold transition';
  if (!item.to) {
    return (
      <span aria-disabled="true" title="Not available yet" className={cn(base, 'min-h-9 cursor-not-allowed text-[#5d7f70]')}>
        <Icon className="size-[17px] shrink-0" />
        <span className="truncate">{item.label}</span>
        <span className="sr-only">(not available yet)</span>
      </span>
    );
  }
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(base, isActive ? 'bg-[#143a2c] text-[#68e9ae] shadow-[inset_2px_0_0_#19da94]' : 'text-[#adccbc] hover:bg-[#143a2c] hover:text-[#edf9f1]')
      }
    >
      <Icon className="size-[17px] shrink-0" />
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}

function MobileNav({ username }: { username: string }) {
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 flex h-[67px] items-center justify-around border-t border-[#285640] bg-[#071d16f5] pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
      {mobileNav(username).map((item) => {
        const Icon = item.icon;
        const icon = (
          <span className={cn(item.emphasis && '-mt-4 rounded-full bg-[#23e7a2] p-2.5 text-[#053022] shadow-[0_6px_28px_#12dba16e]', item.emphasis && !item.to && 'opacity-50')}>
            <Icon className="size-5" />
          </span>
        );
        if (!item.to) {
          return (
            <span key={item.label} aria-disabled="true" className="flex min-w-[60px] flex-col items-center gap-0.5 text-[10px] text-[#55776a]">
              {icon}
              {item.label}
              <span className="sr-only">(not available yet)</span>
            </span>
          );
        }
        return (
          <NavLink key={item.label} to={item.to} className={({ isActive }) => cn('flex min-h-12 min-w-[60px] flex-col items-center justify-center gap-0.5 text-[10px]', isActive ? 'text-[#37e99f]' : 'text-[#98bbab]')}>
            {icon}
            {item.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
