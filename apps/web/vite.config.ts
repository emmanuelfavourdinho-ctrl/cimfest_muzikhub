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
      const robots = ['User-agent: *', 'Allow: /', 'Disallow: /admin', 'Disallow: /settings', 'Disallow: /studio', 'Disallow: /onboarding', 'Disallow: /home', 'Disallow: /network'];
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
        '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:4000', changeOrigin: false },
      },
    },
  };
});
