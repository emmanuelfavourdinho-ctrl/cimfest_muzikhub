#!/usr/bin/env node
/**
 * Design-token guard (CLAUDE.md §20.2): web components must use tokens, never raw colours or
 * one-off pixel sizes. Fails on:
 *   - 6/8-digit hex colours anywhere, 3/4-digit hex inside Tailwind arbitrary values `[...]`
 *   - rgb()/rgba()/hsl()/hsla()/oklch() literals
 *   - arbitrary pixel utilities such as `text-[13px]`, `rounded-[23px]`, `w-[min(480px,…)]`
 * Allowed: src/styles/** and src/design/** (where tokens are defined), and any line carrying
 * `tokens-allow: <reason>` on it or on the line above (documented exceptions only).
 *
 *   node scripts/check-tokens.mjs            # fail on findings
 *   node scripts/check-tokens.mjs --report   # list findings per file, exit 0
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'apps/web/src');
// styles/ and design/ define the tokens. features/landing/ is frozen by the owner; audited
// 2026-11-24: no colours, only stripe widths inside its abstract-artwork gradient.
const EXEMPT_DIRS = ['styles', 'design', 'features/landing'].map((d) => join(SRC, d));
const RULES = [
  { name: 'hex colour', re: /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|\[[^\]\s]*#[0-9a-fA-F]{3,4}\b[^\]]*\]/g },
  { name: 'rgb/hsl colour', re: /\b(?:rgba?|hsla?|oklch)\(/g },
  { name: 'pixel size', re: /\[[^\]\s]*\d+(?:\.\d+)?px[^\]]*\]/g },
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (EXEMPT_DIRS.some((d) => p.startsWith(d))) continue;
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name)) yield p;
  }
}

const findings = [];
for (const file of files(SRC)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/tokens-allow:\s*\S/.test(line) || /tokens-allow:\s*\S/.test(lines[i - 1] ?? '')) return;
    for (const rule of RULES)
      for (const m of line.matchAll(rule.re)) findings.push({ file: relative(ROOT, file), line: i + 1, rule: rule.name, text: m[0] });
  });
}

const report = process.argv.includes('--report');
if (report) {
  const byFile = {};
  for (const f of findings) (byFile[f.file] ??= []).push(f);
  for (const [file, list] of Object.entries(byFile).sort((a, b) => b[1].length - a[1].length))
    console.log(`${String(list.length).padStart(4)}  ${file}`);
}
if (findings.length === 0) {
  console.log('check-tokens: no raw colours or pixel sizes in web components.');
} else {
  if (!report) for (const f of findings.slice(0, 50)) console.error(`${f.file}:${f.line}  ${f.rule}  ${f.text}`);
  console.error(
    `check-tokens: ${findings.length} finding(s). Use a design token (apps/web/src/index.css), or mark a documented exception with "tokens-allow: <reason>".`,
  );
  process.exit(report ? 0 : 1);
}
