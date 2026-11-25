import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HEADER_SOLID_AFTER_PX, motion } from '@/design/tokens';

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Signed-in check for the landing page only. Deliberately a plain fetch, not `useMe()`:
 * useMe pulls in the validated API client (Zod and every schema), which the landing route
 * must not download. It answers only "signed in?" and "onboarded?", in its own cache key.
 * Better Auth's get-session answers 200 + null when signed out, so signed-out visitors (most
 * landing traffic) make one request and see no 401 in the console; /me is asked only when signed in.
 */
export function useSessionHint() {
  return useQuery({
    queryKey: ['landing', 'session-hint'],
    queryFn: async ({ signal }) => {
      const base = import.meta.env.VITE_API_URL ?? '';
      const session = await fetch(`${base}/api/auth/get-session`, { credentials: 'include', signal });
      if (!session.ok || !(await session.json())) return null;
      const res = await fetch(`${base}/api/v1/me`, { credentials: 'include', signal });
      if (!res.ok) return null; // e.g. account suspended since: show the signed-out header
      const body = (await res.json()) as { profile?: { onboardingCompletedAt?: string | null } };
      return { appPath: body.profile?.onboardingCompletedAt ? '/home' : '/onboarding' };
    },
    staleTime: 60_000,
    retry: false,
  });
}

/** True once the page has scrolled past a few pixels (header turns solid). */
export function useScrolledPast(px = HEADER_SOLID_AFTER_PX) {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const update = () => setPast(window.scrollY > px);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [px]);
  return past;
}

/** The id of the section currently in the middle of the viewport, for the nav's active pill. */
export function useScrollSpy(ids: readonly string[], ready = true) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!ready || !('IntersectionObserver' in window)) return;
    const els = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => Boolean(el));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [ids, ready]);
  return active;
}

/**
 * Reveals [data-reveal] children of `root` once, as they enter the viewport.
 * Content is visible by default; hiding only starts after this runs (before first paint),
 * and never with reduced motion or without IntersectionObserver.
 */
export function useReveal(root: RefObject<HTMLElement | null>, ready: boolean) {
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !ready || reducedMotion() || !('IntersectionObserver' in window)) return;
    const items = [...el.querySelectorAll<HTMLElement>('[data-reveal]')];
    // Anything already on screen is shown immediately, so nothing above the fold ever fades in.
    // Measure everything first, then write: interleaving would force a layout per element.
    const vh = window.innerHeight;
    const onScreen = items.map((item) => item.getBoundingClientRect().top < vh);
    items.forEach((item, i) => {
      if (onScreen[i]) item.dataset.shown = '';
    });
    el.classList.add('js-reveal');
    const io = new IntersectionObserver(
      (entries) => {
        const entering = entries.filter((e) => e.isIntersecting);
        entering.forEach((e, i) => {
          const target = e.target as HTMLElement;
          target.style.setProperty('--reveal-delay', `${Math.min(i * motion.stagger, motion.maxStagger)}ms`);
          target.dataset.shown = '';
          io.unobserve(target);
        });
      },
      { threshold: 0.15 },
    );
    items.filter((i) => !('shown' in i.dataset)).forEach((i) => io.observe(i));
    return () => {
      io.disconnect();
      el.classList.remove('js-reveal');
    };
  }, [root, ready]);
}

/** Whether an element is on screen — used to pause the preview's looping progress sweep. */
export function useOnScreen<T extends Element>() {
  const ref = useRef<T>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([e]) => setOn(Boolean(e?.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, on] as const;
}
