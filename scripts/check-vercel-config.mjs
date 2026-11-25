#!/usr/bin/env node
/**
 * Runs first in the Vercel build (vercel.json buildCommand). Stops a deployment that would be
 * broken in a way the build itself can't see:
 *  - the /api route still points at the placeholder instead of the real Render service;
 *  - PROXY_SHARED_SECRET is missing or too short in the Vercel project (Render would refuse
 *    every forwarded request with 403 DIRECT_ACCESS_FORBIDDEN).
 * Never prints the secret. Outside Vercel (VERCEL unset) only the file is checked.
 */
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const problems = [];

const api = config.routes?.find((r) => r.src === '/api/(.*)');
if (!api) problems.push('vercel.json has no /api/(.*) route');
else {
  let url;
  try {
    url = new URL(api.dest.replace('$1', ''));
  } catch {
    problems.push('the /api route destination is not a valid URL');
  }
  if (url && (url.protocol !== 'https:' || !url.hostname.endsWith('.onrender.com') || url.hostname.startsWith('replace-with-'))) {
    problems.push(
      'the /api route in vercel.json must point at your Render service: replace REPLACE-WITH-YOUR-RENDER-SERVICE with its name (https://<name>.onrender.com)',
    );
  }
  if (!api.transforms?.some((t) => t.target?.key === 'x-muzikhub-proxy-secret' && t.op === 'set')) {
    problems.push('the /api route must set the x-muzikhub-proxy-secret request header');
  }
}

if (process.env.VERCEL) {
  const secret = process.env.PROXY_SHARED_SECRET ?? '';
  if (secret.length < 32 || !/^[\x21-\x7e]+$/.test(secret)) {
    problems.push(
      'PROXY_SHARED_SECRET is not set in this Vercel project (or is shorter than 32 characters). Use the same value as on Render.',
    );
  }
  for (const name of Object.keys(process.env)) {
    if (name.startsWith('VITE_') && /SECRET|PRIVATE|PASSWORD|TOKEN|_KEY$/.test(name)) {
      problems.push(`${name} looks like a secret, but VITE_ variables are published in the browser bundle. Remove it.`);
    }
  }
  if (process.env.VITE_API_URL) {
    problems.push('VITE_API_URL must be unset in setup B (the browser calls /api on this site; Vercel forwards it to Render)');
  }
}

if (problems.length) {
  console.error(`\nDeployment configuration problem${problems.length > 1 ? 's' : ''}:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
  process.exit(1);
}
console.log('vercel.json: /api forwarding and proxy secret look right');
