import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Static scan of the Express route table: reads the v1 mount table in app.ts and the
 * `router.<method>('path'` calls inside each router factory. Used by the OpenAPI drift test,
 * so the spec can never silently miss (or invent) an operation.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

export type ScannedRoute = { method: string; path: string };

function factoriesIn(file: string): Map<string, string> {
  const src = readFileSync(file, 'utf8');
  const out = new Map<string, string>();
  const starts = [...src.matchAll(/export function (\w+)\(/g)];
  starts.forEach((m, i) => out.set(m[1]!, src.slice(m.index, starts[i + 1]?.index ?? src.length)));
  return out;
}

export function scanRoutes(prefix = '/api/v1'): ScannedRoute[] {
  const app = readFileSync(join(SRC, 'app.ts'), 'utf8');
  const importOf = new Map<string, string>();
  for (const m of app.matchAll(/import \{([^}]+)\} from '\.\/(modules\/[^']+)\.js';/g)) {
    for (const name of m[1]!
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean))
      importOf.set(name, join(SRC, `${m[2]}.ts`));
  }
  const routes: ScannedRoute[] = [];
  // v1.use('/x', factory()) — and the few routers mounted on the app itself under /api/v1
  // (e.g. raw-body webhooks, which must run before express.json()).
  const mounts = [
    ...[...app.matchAll(/v1\.use\('([^']+)',\s*(\w+)\(/g)].map((m) => [m[1]!, m[2]!] as const),
    ...[...app.matchAll(/app\.use\('\/api\/v1(\/[^']+)',\s*(\w+)\(/g)].map((m) => [m[1]!, m[2]!] as const),
  ];
  for (const [mount, factory] of mounts) {
    const file = importOf.get(factory);
    if (!file) continue;
    const body = factoriesIn(file).get(factory);
    if (!body) throw new Error(`router factory ${factory} not found in ${file}`);
    for (const r of body.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)) {
      const sub = r[2] === '/' ? '' : r[2]!;
      const full = `${prefix}${mount}${sub}`.replace(/:(\w+)/g, '{$1}');
      routes.push({ method: r[1]!.toUpperCase(), path: full });
    }
  }
  // Routes defined directly on the v1 router in app.ts.
  for (const m of app.matchAll(/v1\.(get|post|put|patch|delete)\('([^']+)'/g))
    routes.push({ method: m[1]!.toUpperCase(), path: `${prefix}${m[2]}` });
  return routes;
}
