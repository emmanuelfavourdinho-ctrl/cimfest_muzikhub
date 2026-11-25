/**
 * Typed access to the design tokens for code that needs them in JavaScript (inline SVG,
 * timings). VALUES live in CSS (styles/palette.css and index.css) — this file only names
 * them, so there is still one source of truth.
 */
export const color = {
  surfaceBase: 'var(--p-base)',
  surfaceRaised: 'var(--p-raised)',
  surfaceOverlay: 'var(--p-overlay)',
  signal: 'var(--p-accent)',
  onSignal: 'var(--p-on-accent)',
  text1: 'var(--p-text)',
  text2: 'var(--p-text-2)',
  text3: 'var(--p-text-3)',
  hairline: 'var(--p-line)',
  hairlineStrong: 'var(--p-line-strong)',
} as const;

/** Milliseconds; mirror --motion-* in index.css. */
export const motion = {
  micro: 150,
  standard: 250,
  reveal: 500,
  /** Delay between items revealed together; capped so a list never feels slow. */
  stagger: 60,
  maxStagger: 240,
} as const;

/** Distance scrolled before the landing header turns solid. */
export const HEADER_SOLID_AFTER_PX = 16;

export type ColorToken = keyof typeof color;
