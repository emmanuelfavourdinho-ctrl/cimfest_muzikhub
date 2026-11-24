import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
});
