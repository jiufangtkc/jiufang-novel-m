// @ts-nocheck
/**
 * WO-104 返工 3：真實 EditorPane（正文）與 CardEditor（卡片內容）的鍵盤流程整合測試。
 *
 * 做法：用 Vite 把 qa/wo104-keyboard-real 的測試頁（真實 React 元件，資料只用 demoFixtureState）打包到暫存目錄，
 * 以本機 http 伺服器（埠由系統配置）提供，再用 Playwright 驅動本機既有 Chromium。
 * 全部走真的鍵盤（Shift＋方向鍵選字、Tab、Shift＋Tab、Enter、空白鍵）與真的 React useEffect 監聽綁定；
 * 不自製假元件、不直接指定 relatedTarget、不直接呼叫 onPress。window.open 只換成計數用 stub。
 * 不使用 skipIf：找不到 Playwright 或 Chromium 就讓測試失敗。不安裝任何東西。
 */
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repoRoot = new URL('../..', import.meta.url).pathname;
const CHROMIUM =
  process.env.CHROMIUM_PATH ||
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/home/box/.cache/ms-playwright/chromium-1148/chrome-linux/chrome';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

let outDir = '';
let server;
let baseUrl = '';
let browser;

const BODY_BTN = '[data-dict-button="body"]';
const CARD_BTN = '[data-dict-button="card"]';
const BODY_TA = '#body-host textarea.editor-input';
const CARD_TA = '#card-editor-content-textarea';

beforeAll(async () => {
  expect(existsSync(CHROMIUM), `找不到本機 Chromium：${CHROMIUM}`).toBe(true);
  const { build } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  outDir = mkdtempSync(path.join(os.tmpdir(), 'wo104-r3-'));
  await build({
    configFile: false,
    root: path.join(repoRoot, 'qa/wo104-keyboard-real'),
    base: './',
    plugins: [react()],
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true, minify: false, chunkSizeWarningLimit: 100000 },
  });
  server = createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0]);
    let file = path.join(outDir, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(outDir) || !existsSync(file) || statSync(file).isDirectory()) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
  const { chromium } = createRequire(import.meta.url)('playwright');
  browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
}, 180000);

afterAll(async () => {
  await browser?.close();
  await new Promise((r) => (server ? server.close(r) : r()));
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__opens = [];
    window.__focusLog = [];
    window.open = (url, target, features) => {
      window.__opens.push({ url, target, features, activeGesture: navigator.userActivation.isActive });
      return null;
    };
    document.addEventListener('focusin', (e) => {
      const t = e.target;
      window.__focusLog.push(t.getAttribute('data-dict-button') ? 'dict:' + t.getAttribute('data-dict-button') : t.tagName.toLowerCase() + (t.id ? '#' + t.id : ''));
    });
  });
  await page.goto(baseUrl);
  await page.waitForSelector(BODY_TA);
  await page.waitForSelector(CARD_TA);
  return { page, errors };
}

/** 真的點進輸入框、打字「他買了車票」，再用 Shift＋左方向鍵選取「車票」。 */
async function typeAndSelect(page, textareaSel) {
  await page.click(textareaSel);
  await page.keyboard.type('他買了車票');
  await page.keyboard.press('End');
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.up('Shift');
}

const activeIs = (page, sel) => page.evaluate((s) => document.activeElement?.matches(s) ?? false, sel);
const count = (page, sel) => page.locator(sel).count();
const opens = (page) => page.evaluate(() => window.__opens);
const clearFocusLog = (page) => page.evaluate(() => { window.__focusLog = []; });
const focusLog = (page) => page.evaluate(() => window.__focusLog);

const SOURCES = [
  { name: '正文（EditorPane）', ta: BODY_TA, btn: BODY_BTN, otherBtn: CARD_BTN },
  { name: '卡片內容（CardEditor）', ta: CARD_TA, btn: CARD_BTN, otherBtn: BODY_BTN },
];

describe('WO-104 返工 3：真實元件鍵盤流程（Chromium）', () => {
  for (const s of SOURCES) {
    describe(s.name, () => {
      it('選「車票」後按 Tab：焦點直接落在查字典按鈕、暫存仍在、Enter 同步開窗恰 1 次', async () => {
        const { page, errors } = await openPage();
        try {
          await typeAndSelect(page, s.ta);
          expect(await count(page, s.btn)).toBe(1);
          expect(await page.locator(s.btn).getAttribute('aria-label')).toContain('車票');
          await clearFocusLog(page);
          await page.keyboard.press('Tab');
          expect(await activeIs(page, s.btn)).toBe(true);
          // 沒有先經過其他控制項
          expect(await focusLog(page)).toEqual([`dict:${s.btn.includes('card') ? 'card' : 'body'}`]);
          expect(await count(page, s.btn)).toBe(1);
          expect(await opens(page)).toHaveLength(0);
          await page.keyboard.press('Enter');
          const o = await opens(page);
          expect(o).toHaveLength(1);
          expect(decodeURIComponent(o[0].url)).toContain('車票');
          expect(o[0].target).toBe('_blank');
          expect(o[0].activeGesture).toBe(true);
          expect(errors).toEqual([]);
        } finally {
          await page.close();
        }
      });

      it('選「車票」後按 Shift＋Tab：焦點落在查字典按鈕、空白鍵同步開窗恰 1 次', async () => {
        const { page } = await openPage();
        try {
          await typeAndSelect(page, s.ta);
          await clearFocusLog(page);
          await page.keyboard.press('Shift+Tab');
          expect(await activeIs(page, s.btn)).toBe(true);
          expect((await focusLog(page)).length).toBe(1);
          expect(await count(page, s.btn)).toBe(1);
          await page.keyboard.press('Space');
          const o = await opens(page);
          expect(o).toHaveLength(1);
          expect(decodeURIComponent(o[0].url)).toContain('車票');
          expect(o[0].activeGesture).toBe(true);
        } finally {
          await page.close();
        }
      });

      it('在按鈕上再按 Tab 移往其他欄位：暫存與按鈕清除', async () => {
        const { page } = await openPage();
        try {
          await typeAndSelect(page, s.ta);
          await page.keyboard.press('Tab');
          expect(await activeIs(page, s.btn)).toBe(true);
          await page.keyboard.press('Tab');
          expect(await activeIs(page, s.btn)).toBe(false);
          expect(await count(page, s.btn)).toBe(0);
          expect(await count(page, s.otherBtn)).toBe(0);
          expect(await opens(page)).toHaveLength(0);
        } finally {
          await page.close();
        }
      });

      it('沒有選取時 Tab 不被攔截（不會落到查字典按鈕）', async () => {
        const { page } = await openPage();
        try {
          await page.click(s.ta);
          await page.keyboard.type('他買了車票');
          expect(await count(page, s.btn)).toBe(0);
          await page.keyboard.press('Tab');
          expect(await page.evaluate(() => !!document.activeElement?.closest('[data-dict-button]'))).toBe(false);
        } finally {
          await page.close();
        }
      });
    });
  }

  it('卡片與正文來源互斥：同時只出現一顆，換來源選字時上一顆消失', async () => {
    const { page } = await openPage();
    try {
      await typeAndSelect(page, BODY_TA);
      expect(await count(page, BODY_BTN)).toBe(1);
      expect(await count(page, CARD_BTN)).toBe(0);
      await typeAndSelect(page, CARD_TA);
      expect(await count(page, CARD_BTN)).toBe(1);
      expect(await count(page, BODY_BTN)).toBe(0);
      // 卡片選字時，在正文輸入框按 Tab 不會被攔截（不落到卡片按鈕）
      await page.click(BODY_TA);
      expect(await count(page, CARD_BTN)).toBe(0);
      expect(await count(page, BODY_BTN)).toBe(0);
    } finally {
      await page.close();
    }
  });
});
