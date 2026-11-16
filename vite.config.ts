import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/** COEP 需要子資源帶 CORP，否則 sqlite wasm 在 WebKit 會被擋。 */
function crossOriginResourcePolicyForWasm() {
  const middleware = (
    _req: { url?: string },
    res: { setHeader: (name: string, value: string) => void },
    next: () => void,
  ) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
  };
  return {
    name: 'cross-origin-resource-policy-wasm',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

/**
 * WO-102：PWA manifest。預設（無選擇）＝森林綠；各主題的色碼見 src/layout/deviceTheme.ts。
 * 靜態 manifest 只能放一組，所以另外輸出青瓷、經典深藍兩份（只差兩個色碼），
 * 由頁面依目前主題切換 <link rel="manifest">。
 */
const baseManifest = {
        name: '九方小說編輯器M',
        short_name: '九方編輯器M',
        description: '可加到主畫面、可離線寫作的小說編輯器',
        lang: 'zh-Hant',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        // 靜態 manifest 只能放一組，無選擇的預設＝森林綠（WO-102）；各主題的色碼見 deviceTheme.ts
        background_color: '#121A16',
        theme_color: '#121A16',
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
      };

const THEME_MANIFEST_FILES = [
  { file: 'manifest-celadon.webmanifest', color: '#101D23' },
  { file: 'manifest-classic.webmanifest', color: '#252526' },
];

function themeManifests() {
  return {
    name: 'theme-manifests',
    generateBundle() {
      for (const { file, color } of THEME_MANIFEST_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: file,
          source: JSON.stringify({ ...baseManifest, theme_color: color, background_color: color }),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [
    crossOriginResourcePolicyForWasm(),
    react(),
    themeManifests(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png', 'fonts/OFL.txt', 'fonts/來源說明.txt'],
      manifest: baseManifest,
      workbox: {
        // 字型小塊也放進預先快取。否則第一次打開時，字型往往在服務程式接手之前就下載完，
        // 斷網後重新載入寫作畫面會退回系統字型。
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,txt,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
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
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
