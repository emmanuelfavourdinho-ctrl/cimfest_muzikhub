#!/usr/bin/env node
/**
 * JavaScript budget per route (gzip bytes the browser downloads on first load), enforced in CI.
 * Loads each route from a running `vite preview` (default http://localhost:4173) in Chromium,
 * records every same-origin .js response, and gzips the matching files from apps/web/dist.
 *   node scripts/js-budget.mjs [baseUrl] [--report]
 */
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

/** kB gzip. Set from measurements on 2026-11-24 plus ~5% headroom; lower them, don't raise them casually. */
export const BUDGETS = { '/': 160, '/login': 215, '/register': 215, '/discover': 225, '/privacy': 160 };

const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4173';
const report = process.argv.includes('--report');
const dist = new URL('../apps/web/dist', import.meta.url).pathname;
const browser = await chromium.launch();
let failed = 0;
for (const [path, budget] of Object.entries(BUDGETS)) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const scripts = new Set();
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (u.origin === new URL(base).origin && u.pathname.endsWith('.js')) scripts.add(u.pathname);
  });
  await page.goto(base + path, { waitUntil: 'networkidle' });
  await page.close();
  let bytes = 0;
  for (const p of scripts) if (existsSync(dist + p)) bytes += gzipSync(readFileSync(dist + p)).length;
  const kb = bytes / 1024;
  const ok = kb <= budget;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${path.padEnd(10)} ${kb.toFixed(1).padStart(6)} kB gzip  (budget ${budget} kB, ${scripts.size} files)`);
}
await browser.close();
if (failed && !report) {
  console.error(`js-budget: ${failed} route(s) over budget.`);
  process.exit(1);
}
