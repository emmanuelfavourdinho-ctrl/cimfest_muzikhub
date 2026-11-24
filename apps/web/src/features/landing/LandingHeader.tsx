import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/cn';
import { ArrowRight, Menu, X } from 'lucide-react';
import { BrandMark } from '@/components/layout/BrandMark';
import { Button } from '@/components/ui/button';
import { hero, nav } from './content';
import { useScrolledPast, useScrollSpy } from './hooks';

const sectionIds = nav.map((n) => n.id);

type Session = { appPath: string } | null | undefined;

/** Fixed header: transparent over the hero, solid after a few pixels of scroll. */
export function LandingHeader({ session, ready }: { session: Session; ready: boolean }) {
  const solid = useScrolledPast();
  const active = useScrollSpy(sectionIds, ready);

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-40 h-(--header-h) border-b transition-colors duration-(--motion-standard)',
        solid ? 'header-surface border-hairline' : 'border-transparent bg-transparent',
      )}
    >
      <div className="mx-auto flex h-full max-w-wide items-center gap-3 px-gutter">
        <BrandMark />
        <nav aria-label="Main" className="mx-auto hidden lg:block">
          <ul className="flex items-center gap-1 rounded-full border border-hairline bg-surface-raised/70 p-1">
            {nav.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  aria-current={active === item.id ? 'true' : undefined}
                  className={cn(
                    'inline-flex h-9 items-center rounded-full px-4 text-small font-semibold transition-colors duration-(--motion-micro)',
                    active === item.id ? 'bg-surface-chip text-text-1' : 'text-text-2 hover:text-text-1',
                  )}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <SessionActions session={session} />
          <MobileMenu session={session} active={active} />
        </div>
      </div>
    </header>
  );
}

function SessionActions({ session }: { session: Session }) {
  if (session) {
    return (
      <Button asChild size="sm" shape="pill" className="h-11 px-5 text-small">
        <Link to={session.appPath}>
          Open app <ArrowRight />
        </Link>
      </Button>
    );
  }
  return (
    <>
      <Button asChild variant="quiet" size="sm" shape="pill" className="hidden h-11 px-4 text-small sm:inline-flex">
        <Link to="/login">Sign in</Link>
      </Button>
      <Button asChild size="sm" shape="pill" className="h-11 px-5 text-small">
        <Link to="/register">
          <span className="sm:hidden">Join</span>
          <span className="hidden sm:inline">{hero.primary}</span>
        </Link>
      </Button>
    </>
  );
}

/**
 * Full-height menu sheet (below lg) on the native <dialog>: showModal() traps focus and makes the
 * page inert, Escape closes it. We add scroll lock, focus return and close-on-navigate.
 */
function MobileMenu({ session, active }: { session: Session; active: string | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    const onClose = () => {
      document.documentElement.style.overflow = '';
      trigger.current?.focus();
    };
    d.addEventListener('close', onClose);
    return () => {
      d.removeEventListener('close', onClose);
      document.documentElement.style.overflow = '';
    };
  }, []);

  const open = () => {
    document.documentElement.style.overflow = 'hidden';
    dialog.current?.showModal();
  };
  const close = () => dialog.current?.close();

  // showModal() keeps focus off the page, but Chromium lets Tab leave for the browser UI after the
  // last item. Wrap it, so keyboard focus stays in the sheet until it is closed.
  const trapTab = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== 'Tab') return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        aria-controls="landing-menu"
        className="inline-flex size-11 items-center justify-center rounded-full border border-hairline-strong text-text-1 hover:bg-surface-chip lg:hidden"
      >
        <Menu className="size-5" />
        <span className="sr-only">Open menu</span>
      </button>
      <dialog
        ref={dialog}
        id="landing-menu"
        aria-label="Menu"
        onKeyDown={trapTab}
        className="m-0 h-dvh max-h-none w-full max-w-none bg-surface-base p-0 text-text-1 backdrop:bg-surface-footer/80"
      >
        <div className="flex h-full flex-col px-gutter pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <div className="flex h-(--header-h) items-center justify-between">
            <span className="text-h3">Menu</span>
            <button
              type="button"
              autoFocus
              onClick={close}
              className="inline-flex size-11 items-center justify-center rounded-full border border-hairline-strong hover:bg-surface-chip"
            >
              <X className="size-5" />
              <span className="sr-only">Close menu</span>
            </button>
          </div>
          <nav aria-label="Menu" className="mt-4">
            <ul className="divide-y divide-hairline border-y border-hairline">
              {nav.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    onClick={close}
                    aria-current={active === item.id ? 'true' : undefined}
                    className="flex min-h-14 items-center text-h3 aria-[current=true]:text-signal"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="mt-auto grid gap-3">
            {session ? (
              <Button asChild size="lg" shape="pill" onClick={close}>
                <Link to={session.appPath}>Open app</Link>
              </Button>
            ) : (
              <>
                <Button asChild size="lg" shape="pill" onClick={close}>
                  <Link to="/register">{hero.primary}</Link>
                </Button>
                <Button asChild variant="outline" size="lg" shape="pill" onClick={close}>
                  <Link to="/login">Sign in</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
