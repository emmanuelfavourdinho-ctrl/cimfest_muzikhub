import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/** Public, indexable routes. Draft legal pages are noindex and app pages need sign-in. */
const SITEMAP_PATHS = ['/', '/discover'];

/**
 * robots.txt always; sitemap.xml only when VITE_SITE_URL (the production origin) is set,
 * because a sitemap needs absolute URLs and the domain is not decided yet.
 */
function seoFiles(siteUrl: string | undefined): Plugin {
  const site = siteUrl?.replace(/\/$/, '');
  return {
    name: 'muzikhub-seo-files',
    apply: 'build',
    generateBundle() {
      const robots = [
        'User-agent: *',
        'Allow: /',
        'Disallow: /admin',
        'Disallow: /settings',
        'Disallow: /studio',
        'Disallow: /onboarding',
        'Disallow: /home',
        'Disallow: /network',
      ];
      if (site) robots.push(`Sitemap: ${site}/sitemap.xml`);
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `${robots.join('\n')}\n` });
      if (!site) {
        this.warn('VITE_SITE_URL is not set: sitemap.xml was not generated (set it to the production origin).');
        return;
      }
      const urls = SITEMAP_PATHS.map((p) => `  <url><loc>${site}${p}</loc></url>`).join('\n');
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      });
    },
  };
}

/**
 * The security headers Vercel sends for the web app (vercel.json, first route). `vite preview`
 * sends the same ones, so the end-to-end tests run under the production Content-Security-Policy.
 */
function productionHeaders(): Record<string, string> {
  const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as {
    routes: { src?: string; headers?: Record<string, string> }[];
  };
  const route = vercel.routes.find((r) => r.headers?.['Content-Security-Policy']);
  if (!route?.headers) throw new Error('vercel.json: no route with the security headers');
  return route.headers;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), tailwindcss(), seoFiles(env.VITE_SITE_URL)],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      // In development the browser talks only to Vite; Vite forwards /api to the API.
      // Same-origin requests mean auth cookies work without cross-site cookie settings.
      proxy: {
        // API_PROXY_TARGET lets the end-to-end tests point at their own API instance.
        // ws: the real-time channel (/api/realtime) is a WebSocket upgrade.
        '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:4000', changeOrigin: false, ws: true },
      },
    },
    preview: { headers: productionHeaders() },
  };
});
