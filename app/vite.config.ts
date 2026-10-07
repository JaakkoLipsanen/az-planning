import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import { tripsPlugin } from './vite/trips-plugin.ts';

const appDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: appDir,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1600,
  },
  server: {
    fs: { allow: [path.resolve(appDir, '..')] },
  },
  plugins: [
    react(),
    tripsPlugin(path.resolve(appDir, '../trips')),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,pbf,png,svg,webmanifest}'],
        globIgnores: ['trips/**'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/trips\//],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
    }),
  ],
});
