import { lazy, startTransition, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { meta } from './content';
import { Hero } from './Hero';
import { useReveal, useSessionHint } from './hooks';
import { LandingHeader } from './LandingHeader';

const SITE_URL = import.meta.env.VITE_SITE_URL;
const BelowFoldMain = lazy(() => import('./BelowFold').then((m) => ({ default: m.BelowFoldMain })));
const BelowFoldFooter = lazy(() => import('./BelowFold').then((m) => ({ default: m.BelowFoldFooter })));

/**
 * Public landing page. Signed-in visitors stay here and see "Open app" (they are not redirected).
 * Loads no form, auth-client or schema code (see useSessionHint). The hero renders first; the
 * rest of the page is a separate chunk rendered in a transition, so it never blocks first paint.
 */
export function LandingPage() {
  const { data: session } = useSessionHint();
  const appPath = session?.appPath ?? null;
  const root = useRef<HTMLDivElement>(null);
  const { hash } = useLocation();
  const [showRest, setShowRest] = useState(false);
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);

  useEffect(() => startTransition(() => setShowRest(true)), []);
  useReveal(root, ready);

  // Arriving via "/#section" (from another page or a shared link): scroll once the section exists.
  useEffect(() => {
    if (ready && hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }, [hash, ready]);

  return (
    <div ref={root} className="landing-root min-h-svh bg-surface-base">
      {/* React 19 hoists these into <head>. */}
      <title>{meta.title}</title>
      <meta name="description" content={meta.description} />
      {SITE_URL && <link rel="canonical" href={`${SITE_URL.replace(/\/$/, '')}/`} />}

      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-signal px-5 py-3 font-bold text-on-signal focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <LandingHeader session={session} ready={ready} />
      <main id="main" tabIndex={-1} className="outline-none">
        <Hero appPath={appPath} />
        {showRest && (
          <Suspense fallback={null}>
            <BelowFoldMain appPath={appPath} onReady={onReady} />
          </Suspense>
        )}
      </main>
      {showRest && (
        <Suspense fallback={null}>
          <BelowFoldFooter />
        </Suspense>
      )}
    </div>
  );
}
