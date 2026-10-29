import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png', 'fonts/OFL.txt', 'fonts/來源說明.txt'],
      manifest: {
        name: '九方小說編輯器M',
        short_name: '九方小說 M',
        description: '可加到主畫面、可離線寫作的小說編輯器',
        lang: 'zh-Hant',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#1E1E1E',
        theme_color: '#1E1E1E',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // 字型小塊也放進預先快取。否則第一次打開時，字型往往在服務程式接手之前就下載完，
        // 斷網後重新載入寫作畫面會退回系統字型。
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,txt,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/fonts\//],
        runtimeCaching: [
          {
            urlPattern: /\/fonts\/iansui\/.*\.woff2$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'iansui-woff2',
              expiration: {
                maxEntries: 400,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
