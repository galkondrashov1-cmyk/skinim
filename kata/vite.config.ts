/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import geometry from './src/brand/geometry.json';
import { WORDMARK } from './src/brand/wordmark-paths';

/** Inline the brand mark, wordmark and iOS launch images into index.html. */
function brandHtml() {
  const g = geometry;
  const pts = (a: number[][]) => a.map(([x, y]) => `${x},${y}`).join(' ');
  const mark = `<svg class="sp-mark" viewBox="0 0 48 48" aria-hidden="true"><line class="sp-wick" x1="${g.wick.x}" y1="${g.wick.y1}" x2="${g.wick.x}" y2="${g.wick.y2}"/><rect x="${g.body.x}" y="${g.body.y}" width="${g.body.w}" height="${g.body.h}"/><polyline class="sp-tp" points="${pts(g.target)}"/><polyline class="sp-sl" points="${pts(g.stop)}"/></svg>`;
  const b = WORDMARK.box;
  const word = `<svg class="sp-word" viewBox="${b.x1} ${b.y1} ${b.x2 - b.x1} ${b.y2 - b.y1}" aria-label="Kata"><path d="${WORDMARK.d}"/></svg>`;
  const sizes: [number, number][] = JSON.parse(readFileSync(new URL('./public/splash/manifest.json', import.meta.url), 'utf8'));
  const launch = sizes
    .flatMap(([w, h]) => {
      const dpr = w >= 1400 || w <= 828 ? 2 : 3; // iPads and older iPhones are 2×
      const media = (o: string) =>
        `(device-width: ${w / dpr}px) and (device-height: ${h / dpr}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: ${o})`;
      return [
        `<link rel="apple-touch-startup-image" media="${media('portrait')}" href="/splash/launch-${w}x${h}.png" />`,
        `<link rel="apple-touch-startup-image" media="${media('landscape')}" href="/splash/launch-${h}x${w}.png" />`,
      ];
    })
    .join('\n    ');
  return {
    name: 'kata-brand-html',
    transformIndexHtml(html: string) {
      return html
        .replace('<!--KATA_SPLASH_MARK-->', mark)
        .replace('<!--KATA_SPLASH_WORD-->', word)
        .replace('<!--KATA_LAUNCH_IMAGES-->', launch);
    },
  };
}

const BRAND = {
  name: 'Kata — Paper Trading',
  short: 'Kata',
  description:
    'Rehearse every trade. Professional paper trading on real-time market data — leverage, stops, journal and analytics, with zero capital at risk.',
  ink: '#0C0E11',
};

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    brandHtml(),
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'mask-icon.svg', 'apple-touch-icon.png', 'icons/*.png'],
      manifest: {
        id: '/',
        name: BRAND.name,
        short_name: BRAND.short,
        description: BRAND.description,
        start_url: '/?source=pwa',
        scope: '/',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'any',
        background_color: BRAND.ink,
        theme_color: BRAND.ink,
        categories: ['finance', 'education', 'productivity'],
        lang: 'en',
        dir: 'ltr',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/monochrome-512.png', sizes: '512x512', type: 'image/png', purpose: 'monochrome' },
        ],
        screenshots: [
          { src: '/screens/wide-trade.png', sizes: '1600x1000', type: 'image/png', form_factor: 'wide', label: 'Trade on live charts with stops and targets on the chart' },
          { src: '/screens/narrow-trade.png', sizes: '780x1688', type: 'image/png', form_factor: 'narrow', label: 'Full trading terminal in your pocket' },
        ],
        shortcuts: [
          { name: 'Trade', url: '/#/trade', icons: [{ src: '/icons/shortcut-trade.png', sizes: '96x96' }] },
          { name: 'Journal', url: '/#/journal', icons: [{ src: '/icons/shortcut-journal.png', sizes: '96x96' }] },
          { name: 'Performance', url: '/#/performance', icons: [{ src: '/icons/shortcut-performance.png', sizes: '96x96' }] },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        // iOS fetches launch images itself at install time; no need to precache them.
        globIgnores: ['splash/**', 'og.png', 'screens/**'],
        navigateFallback: '/index.html',
        // Market data is never cached by the service worker: stale prices must not masquerade as live.
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Stable vendor chunks: an app release does not invalidate cached libraries.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/](react|react-dom|scheduler|zustand|use-sync-external-store)[\\/]/.test(id)) return 'react';
          if (/[\\/](lightweight-charts|fancy-canvas)[\\/]/.test(id)) return 'charts';
          if (/[\\/](dexie|dexie-react-hooks)[\\/]/.test(id)) return 'storage';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
