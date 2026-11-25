// @ts-nocheck
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadPlaywright, resolveChromiumExecutable } from '../../qa/playwright-env.mjs';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

function hasBrowserRuntime(): boolean {
  try {
    const pw = loadPlaywright();
    return Boolean(resolveChromiumExecutable(pw));
  } catch {
    return false;
  }
}

function stubPwaRegisterPlugin() {
  const virtualId = 'virtual:pwa-register';
  const resolvedId = '\0virtual:pwa-register';
  return {
    name: 'stub-pwa-register-for-test',
    resolveId(id) {
      if (id === virtualId) return resolvedId;
      return null;
    },
    load(id) {
      if (id === resolvedId) {
        return 'export function registerSW() { return () => Promise.resolve(); }';
      }
      return null;
    },
  };
}

const canRunBrowser = hasBrowserRuntime();

describe.skipIf(!canRunBrowser)('WO-92 瀏覽器量測：資料集挑色「完成」在視窗內', () => {
  let outDir = '';
  let server = null;
  let baseUrl = '';

  beforeAll(async () => {
    const appVersion = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
    const { build } = await import('vite');
    const react = (await import('@vitejs/plugin-react')).default;
    outDir = mkdtempSync(path.join(os.tmpdir(), 'wo92-picker-'));
    await build({
      configFile: false,
      root: repoRoot,
      base: '/',
      define: {
        __APP_VERSION__: JSON.stringify(appVersion),
      },
      plugins: [react(), stubPwaRegisterPlugin()],
      logLevel: 'silent',
      build: {
        outDir,
        emptyOutDir: true,
        copyPublicDir: false,
        minify: false,
        chunkSizeWarningLimit: 100000,
      },
    });

    const publicDir = path.join(repoRoot, 'public');
    const resolveStaticFile = (urlPath) => {
      const rel = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
      if (rel) {
        for (const baseDir of [outDir, publicDir]) {
          const candidate = path.resolve(baseDir, rel);
          if (
            (candidate === baseDir || candidate.startsWith(baseDir + path.sep)) &&
            existsSync(candidate) &&
            statSync(candidate).isFile()
          ) {
            return candidate;
          }
        }
      }
      return path.join(outDir, 'index.html');
    };

    server = createServer((req, res) => {
      const file = resolveStaticFile(req.url || '/');
      res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      if (req.method === 'HEAD') {
        res.statusCode = 200;
        res.end();
        return;
      }
      res.end(readFileSync(file));
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  }, 120000);

  afterAll(async () => {
    await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it('390×844、844×390、900×900、1280×900、1920×900「完成」完整可點', async () => {
    const { runViewportChecks } = await import('../../qa/wo92-color-picker-done-viewport/run.mjs');
    const failures = await runViewportChecks({ baseUrl });
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
  }, 120000);
});
