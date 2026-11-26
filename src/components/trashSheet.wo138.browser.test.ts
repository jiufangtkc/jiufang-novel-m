// @ts-nocheck
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadPlaywright, resolveChromiumExecutable } from '../../qa/playwright-env.mjs';
import {
  TRASH_CORNER_BLOCKED_EXCEEDS_MAX_WORDS,
  TRASH_PUT_BACK_END_TOAST,
  TRASH_REASON_SAVED_TOAST,
  TRASH_RESTORED_TOAST,
  trashPutBackPickedToast,
} from '../copy/trashCopy';

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

const BOOK_ID = 'wo138-browser-book';

function makeSeedProjects() {
  return [
    {
      id: BOOK_ID,
      title: '【範例】刪稿暫存區瀏覽器驗證',
      updatedLabel: '剛剛',
      bookGoal: 50000,
      shape: 'novel',
      nodes: [
        {
          id: 'ch-1',
          type: 'file',
          title: '第一章　霧港',
          progress: 'Draft',
          content: '【範例】第一章已經大幅改寫，原本前後句都不在了。',
          expanded: true,
        },
        {
          id: 'ch-2',
          type: 'file',
          title: '第二章　車站',
          progress: 'Draft',
          content: '【範例】這是一段很短的對白，只有十幾個字。後面的正文還在。',
          expanded: true,
        },
        {
          id: 'ch-long',
          type: 'file',
          title: '第三章　長稿',
          progress: 'Draft',
          content: '字'.repeat(50_005),
          expanded: true,
        },
        {
          id: 'ch-today',
          type: 'file',
          title: '第四章　今日字數',
          progress: 'Draft',
          content: '【範例】' + '霧'.repeat(120),
          expanded: true,
        },
        {
          id: 'ch-select',
          type: 'file',
          title: '第五章　選取字數',
          progress: 'Draft',
          content: '甲 乙\n\n丙丁  戊己庚辛壬癸' + '海'.repeat(100),
          expanded: true,
        },
      ],
      cards: [],
      trashItems: [
        {
          itemId: 'trash-cross-1',
          chapterId: 'ch-1',
          chapterTitleSnapshot: '第一章　霧港',
          content: '【範例】以前從第一章刪掉的舊描寫。',
          wordCount: 16,
          beforeAnchor: '已經不存在的前文錨點字串，對不上',
          afterAnchor: '已經不存在的後文錨點字串，也對不上',
          charOffset: 10,
          reason: '',
          deletedAtMs: 1_700_000_200_000,
          sortOrder: 0,
        },
        {
          itemId: 'trash-gone-1',
          chapterId: 'missing-ch',
          chapterTitleSnapshot: '被刪掉的序章',
          content: '【範例】原章已經被刪掉的段落。',
          wordCount: 14,
          beforeAnchor: '',
          afterAnchor: '',
          charOffset: 0,
          reason: '',
          deletedAtMs: 1_700_000_100_000,
          sortOrder: 0,
        },
      ],
    },
  ];
}

async function seedBrowserStorage(context, projects = makeSeedProjects()) {
  await context.addInitScript(
    ({ projectsJson, onboardingJson }) => {
      try {
        window.localStorage.setItem('jiufang-novel-m.outline.v1', projectsJson);
        window.localStorage.setItem('jiufang-novel-m.onboarding.v1', onboardingJson);
        window.localStorage.setItem('jiufang-novel-m.whats-new-seen.v1', '999.0.0');
      } catch {
        // ignore
      }
    },
    {
      projectsJson: JSON.stringify(projects),
      onboardingJson: JSON.stringify({ status: 'done', at: '2026-11-25T00:00:00+08:00' }),
    },
  );
}

describe('WO-138 修正輪 1：真實瀏覽器互動驗收（三大必修＋超限提示）', () => {
  let outDir = '';
  let server = null;
  let baseUrl = '';
  let browser = null;

  beforeAll(async () => {
    const pw = loadPlaywright();
    const executablePath = resolveChromiumExecutable(pw);
    expect(executablePath, '找不到本機 Chromium 執行檔').toBeTruthy();

    const appVersion = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
    const { build } = await import('vite');
    const react = (await import('@vitejs/plugin-react')).default;
    outDir = mkdtempSync(path.join(os.tmpdir(), 'wo138-browser-'));
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
    browser = await pw.chromium.launch({ executablePath, args: ['--no-sandbox'] });
  }, 180000);

  afterAll(async () => {
    await browser?.close();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it('必修 1：跨章放回時（含對不上放章末與原章不在選章），說明提示跳轉後仍保留可見不被 Workspace 清掉', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await seedBrowserStorage(context);
    const page = await context.newPage();
    try {
      await page.goto(`${baseUrl}/p/${BOOK_ID}/write/ch-2`, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-testid="writing-input"]').waitFor({ state: 'visible' });

      // 從第二章打開刪稿暫存區，對原屬第一章但對不上原處的項目按「放回原章」
      await page.locator('[data-testid="format-more-topbar"]').tap();
      await page.locator('[data-testid="format-menu-trash-open"]').tap();
      await page.locator('[data-testid="trash-item-trash-cross-1"]').tap();
      await page.locator('[data-testid="trash-put-back"]').tap();

      await page.waitForURL(new RegExp(`/p/${BOOK_ID}/write/ch-1$`));
      await page.waitForFunction(
        () => document.querySelector('header h1')?.textContent === '第一章　霧港',
      );
      const ch1Value = await page.locator('[data-testid="writing-input"]').inputValue();
      expect(ch1Value).toContain('【範例】以前從第一章刪掉的舊描寫。');

      const toast = page.locator('.toast');
      await toast.waitFor({ state: 'visible' });
      expect(await toast.textContent()).toBe(TRASH_PUT_BACK_END_TOAST);
      // 等待一拍確認不會被 Workspace 的 pathname effect 清掉
      await page.waitForTimeout(250);
      expect(await toast.isVisible()).toBe(true);
      expect(await toast.textContent()).toBe(TRASH_PUT_BACK_END_TOAST);

      // 再測跨章「選一章放回」到第二章
      await page.locator('[data-testid="format-more-topbar"]').tap();
      await page.locator('[data-testid="format-menu-trash-open"]').tap();
      await page.locator('[data-testid="trash-item-trash-gone-1"]').tap();
      await page.locator('[data-testid="trash-pick-chapter"]').tap();
      await page.locator('[data-testid="trash-pick-target-ch-2"]').tap();

      await page.waitForURL(new RegExp(`/p/${BOOK_ID}/write/ch-2$`));
      await page.waitForFunction(
        () => document.querySelector('header h1')?.textContent === '第二章　車站',
      );
      const toast2 = page.locator('.toast');
      await toast2.waitFor({ state: 'visible' });
      expect(await toast2.textContent()).toBe(trashPutBackPickedToast('第二章　車站'));
      await page.waitForTimeout(250);
      expect(await toast2.isVisible()).toBe(true);
    } finally {
      await context.close();
    }
  }, 90000);

  it('必修 2：刪稿暫存區開著時，「已記下原因」與「已放回刪稿暫存區」在清單內提示條可見且不被蓋住', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await seedBrowserStorage(context);
    const page = await context.newPage();
    try {
      await page.goto(`${baseUrl}/p/${BOOK_ID}/write/ch-1`, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-testid="writing-input"]').waitFor({ state: 'visible' });

      await page.locator('[data-testid="format-more-topbar"]').tap();
      await page.locator('[data-testid="format-menu-trash-open"]').tap();

      // 補原因並按「記下原因」
      await page.locator('[data-testid="trash-item-trash-cross-1"]').tap();
      await page.locator('[data-testid="trash-reason-input"]').fill('【範例】這段節奏太慢');
      await page.locator('[data-testid="trash-reason-save"]').tap();

      const statusBar = page.locator('[data-testid="trash-sheet-status"]');
      await statusBar.waitFor({ state: 'visible' });
      expect(await statusBar.getAttribute('role')).toBe('status');
      expect(await statusBar.getAttribute('aria-live')).toBe('polite');
      expect(await statusBar.textContent()).toBe(TRASH_REASON_SAVED_TOAST);

      // 用 elementFromPoint 確認沒有被其他層或清單遮住
      const box1 = await statusBar.boundingBox();
      expect(box1).not.toBeNull();
      const hit1 = await page.evaluate(
        ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('[data-testid="trash-sheet-status"]')),
        { x: box1.x + box1.width / 2, y: box1.y + box1.height / 2 },
      );
      expect(hit1).toBe(true);

      // 丟掉並在 10 秒復原條按「復原」
      await page.locator('[data-testid="trash-discard"]').tap();
      await page.locator('[data-testid="trash-discard-confirm"]').tap();
      await page.locator('[data-testid="trash-undo-btn"]').tap();

      await statusBar.waitFor({ state: 'visible' });
      expect(await statusBar.textContent()).toBe(TRASH_RESTORED_TOAST);
      const box2 = await statusBar.boundingBox();
      expect(box2).not.toBeNull();
      const hit2 = await page.evaluate(
        ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('[data-testid="trash-sheet-status"]')),
        { x: box2.x + box2.width / 2, y: box2.y + box2.height / 2 },
      );
      expect(hit2).toBe(true);
    } finally {
      await context.close();
    }
  }, 90000);

  it('必修 3：手機觸控選取不到 100 字短段後點「⋯」，保留選取快照並顯示「移到刪稿暫存區」且可送入', async () => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    await seedBrowserStorage(context);
    const page = await context.newPage();
    try {
      await page.goto(`${baseUrl}/p/${BOOK_ID}/write/ch-2`, { waitUntil: 'domcontentloaded' });
      const textarea = page.locator('[data-testid="writing-input"]');
      await textarea.waitFor({ state: 'visible' });

      // 用真實點擊聚焦與鍵盤 Shift+方向鍵選取不到 100 字的短句（第 4～21 字元；Control+Home 確保回到整篇開頭）
      await textarea.tap();
      await page.keyboard.press('Control+Home');
      for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowRight');
      await page.keyboard.down('Shift');
      for (let i = 0; i < 17; i += 1) await page.keyboard.press('ArrowRight');
      await page.keyboard.up('Shift');

      // 記錄 pointerdown 是否真的 preventDefault 且保留正文焦點（在 document bubble 觀察 React #root 之後的狀態）
      await page.evaluate(() => {
        window.__wo138PointerCheck = { pointerDownDefaultPrevented: false, activeBeforeClick: '' };
        document.addEventListener('pointerdown', (e) => {
          if ((e.target as Element | null)?.closest?.('[data-testid="format-more-topbar"]')) {
            window.__wo138PointerCheck.pointerDownDefaultPrevented = e.defaultPrevented;
          }
        });
        document.addEventListener(
          'click',
          (e) => {
            if ((e.target as Element | null)?.closest?.('[data-testid="format-more-topbar"]')) {
              window.__wo138PointerCheck.activeBeforeClick =
                document.activeElement?.getAttribute('data-testid') || '';
            }
          },
          true,
        );
      });

      // 確認「移到刪稿暫存區」選項沒有被 onClick 重複覆蓋成空選取而消失
      await page.locator('[data-testid="format-more-topbar"]').tap();
      const pointerCheck = await page.evaluate(() => window.__wo138PointerCheck);
      expect(pointerCheck.pointerDownDefaultPrevented).toBe(true);
      expect(pointerCheck.activeBeforeClick).toBe('writing-input');

      const moveItem = page.locator('[data-testid="format-menu-trash-move-selection"]');
      await moveItem.waitFor({ state: 'visible' });
      await moveItem.tap();

      const updatedValue = await textarea.inputValue();
      expect(updatedValue).toBe('【範例】後面的正文還在。');

      // 打開刪稿暫存區確認短段已收進來
      await page.locator('[data-testid="format-more-topbar"]').tap();
      await page.locator('[data-testid="format-menu-trash-open"]').tap();
      const sheetText = await page.locator('[data-testid="trash-list"]').textContent();
      expect(sheetText).toContain('這是一段很短的對白，只有十幾個字。');
    } finally {
      await context.close();
    }
  }, 90000);

  it('鍵盤 Focus + Enter 開啟「⋯」選單仍能補擷取選取並送入暫存區；單筆超過 50,000 字顯示專屬超限提示', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await seedBrowserStorage(context);
    const page = await context.newPage();
    try {
      // 2. 鍵盤 Tab/Focus + Enter 開「⋯」（無 pointerdown，由 onClick 補擷取選取）
      await page.goto(`${baseUrl}/p/${BOOK_ID}/write/ch-2`, { waitUntil: 'domcontentloaded' });
      const textarea = page.locator('[data-testid="writing-input"]');
      await textarea.waitFor({ state: 'visible' });
      await textarea.click();
      await page.keyboard.press('Control+Home');
      for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowRight');
      await page.keyboard.down('Shift');
      for (let i = 0; i < 17; i += 1) await page.keyboard.press('ArrowRight');
      await page.keyboard.up('Shift');

      await page.locator('[data-testid="format-more-topbar"]').focus();
      await page.keyboard.press('Enter');
      const moveItem = page.locator('[data-testid="format-menu-trash-move-selection"]');
      await moveItem.waitFor({ state: 'visible' });
      await moveItem.click();
      expect(await textarea.inputValue()).toBe('【範例】後面的正文還在。');

      // 2. 單筆超過 50,000 字被擋時顯示 exceeds-max-words 專屬提示且不動正文
      await page.goto(`${baseUrl}/p/${BOOK_ID}/write/ch-long`, { waitUntil: 'domcontentloaded' });
      const longTextarea = page.locator('[data-testid="writing-input"]');
      await longTextarea.waitFor({ state: 'visible' });
      await longTextarea.click();
      await page.keyboard.press('Control+a');
      await page.locator('[data-testid="format-more-topbar"]').click();
      await page.locator('[data-testid="format-menu-trash-move-selection"]').click();

      const corner = page.locator('[data-testid="trash-corner-notice"]');
      await corner.waitFor({ state: 'visible' });
      expect(await corner.textContent()).toContain(TRASH_CORNER_BLOCKED_EXCEEDS_MAX_WORDS);
      expect((await longTextarea.inputValue()).length).toBe(50_005);
    } finally {
      await context.close();
    }
  }, 90000);

  it('返工 1 問題 1：今日字數為 0／有進度時，自動收進、放回、手動移入、復原撤回與丟掉復原都不誤計，小刪除仍照扣', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await seedBrowserStorage(context);
    const page = await context.newPage();
    try {
      await page.goto(`${baseUrl}/p/${BOOK_ID}/write/ch-today`, { waitUntil: 'domcontentloaded' });
      const textarea = page.locator('[data-testid="writing-input"]');
      const progress = page.locator('[data-testid="daily-progress"]');
      await textarea.waitFor({ state: 'visible' });
      expect(await progress.getAttribute('aria-valuenow')).toBe('0');

      // 1. 今日字數為 0 時，全選刪掉 >= 100 字（自動收進暫存區）→ 今日字數仍為 0
      await textarea.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Backspace');
      await page.locator('[data-testid="trash-corner-notice"]').waitFor({ state: 'visible' });
      await page.waitForTimeout(1700);
      expect(await progress.getAttribute('aria-valuenow')).toBe('0');

      // 從暫存區「放回原章」→ 今日字數仍為 0
      await page.locator('[data-testid="trash-corner-open"]').click();
      await page.locator('[data-testid="trash-list"] [data-testid^="trash-item-"]').first().click();
      await page.locator('[data-testid="trash-put-back"]').click();
      await page.waitForTimeout(300);
      expect(await textarea.inputValue()).toBe('【範例】' + '霧'.repeat(120));
      expect(await progress.getAttribute('aria-valuenow')).toBe('0');

      // 2. 新打 15 字 → 今日字數為 15
      await textarea.click();
      await page.keyboard.press('Control+End');
      await page.keyboard.type('海'.repeat(15));
      await page.waitForTimeout(1700);
      expect(await progress.getAttribute('aria-valuenow')).toBe('15');

      // 3. 自動收進 >= 100 字後立刻系統復原撤回 → 今日字數維持 15（不扣也不暴增）
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Backspace');
      await page.locator('[data-testid="trash-corner-notice"]').waitFor({ state: 'visible' });
      await page.waitForTimeout(1700);
      expect(await progress.getAttribute('aria-valuenow')).toBe('15');

      await page.keyboard.press('Control+z');
      await page.waitForTimeout(1700);
      expect(await textarea.inputValue()).toBe('【範例】' + '霧'.repeat(120) + '海'.repeat(15));
      expect(await progress.getAttribute('aria-valuenow')).toBe('15');

      // 4. 手動「移到刪稿暫存區」（15 字）不扣 → 丟掉後 10 秒復原不動 → 放回不加
      await page.keyboard.press('Control+End');
      await page.keyboard.down('Shift');
      for (let i = 0; i < 15; i += 1) await page.keyboard.press('ArrowLeft');
      await page.keyboard.up('Shift');
      await page.locator('[data-testid="format-more-topbar"]').click();
      await page.locator('[data-testid="format-menu-trash-move-selection"]').click();
      await page.waitForTimeout(300);
      expect(await progress.getAttribute('aria-valuenow')).toBe('15');

      await page.locator('[data-testid="trash-corner-open"]').click();
      await page.locator('[data-testid="trash-list"] [data-testid^="trash-item-"]').first().click();
      await page.locator('[data-testid="trash-discard"]').click();
      await page.locator('[data-testid="trash-discard-confirm"]').click();
      await page.locator('[data-testid="trash-undo-btn"]').click();
      await page.locator('[data-testid="trash-list"] [data-testid^="trash-item-"]').first().click();
      expect(await progress.getAttribute('aria-valuenow')).toBe('15');

      await page.locator('[data-testid="trash-put-back"]').click();
      await page.waitForTimeout(300);
      expect(await progress.getAttribute('aria-valuenow')).toBe('15');

      // 5. 不到 100 字的小刪除（刪掉 10 字）仍照既有算法扣成 5
      await textarea.click();
      await page.keyboard.press('Control+End');
      await page.keyboard.down('Shift');
      for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowLeft');
      await page.keyboard.up('Shift');
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(1700);
      expect(await progress.getAttribute('aria-valuenow')).toBe('5');
    } finally {
      await context.close();
    }
  }, 90000);

  it('返工 1 問題 2：選取字數在手機與電腦正確顯示、與 countWords 一致、不重疊角落提示與頂部列，失焦／開清單／專注隱藏', async () => {
    // 手機直向（含模擬 --force-safe-top 瀏海高度）
    const mobileCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    await seedBrowserStorage(mobileCtx);
    const mobilePage = await mobileCtx.newPage();
    try {
      await mobilePage.goto(`${baseUrl}/p/${BOOK_ID}/write/ch-select`, { waitUntil: 'domcontentloaded' });
      const textarea = mobilePage.locator('[data-testid="writing-input"]');
      const selNotice = mobilePage.locator('[data-testid="trash-selection-notice"]');
      await textarea.waitFor({ state: 'visible' });

      // 注入模擬瀏海安全區 --force-safe-top: 44px，驗證不被頂部列或瀏海擋住
      await mobilePage.evaluate(() => {
        document.documentElement.style.setProperty('--force-safe-top', '44px');
      });

      // 未選取時不顯示
      expect(await selNotice.count()).toBe(0);

      // 選取含空白與換行的前 15 個字元（實際有效字數為 10 字）→ 顯示「已選 10 字」，不含門檻句
      await textarea.tap();
      await mobilePage.keyboard.press('Control+Home');
      await mobilePage.keyboard.down('Shift');
      for (let i = 0; i < 15; i += 1) await mobilePage.keyboard.press('ArrowRight');
      await mobilePage.keyboard.up('Shift');

      await selNotice.waitFor({ state: 'visible' });
      expect(await selNotice.textContent()).toBe('已選 10 字');
      expect(await selNotice.textContent()).not.toContain('不會收進暫存區');

      const topbarBox = await mobilePage.locator('.editor .topbar').boundingBox();
      const selBox = await selNotice.boundingBox();
      expect(topbarBox).not.toBeNull();
      expect(selBox).not.toBeNull();
      expect(selBox.y).toBeGreaterThanOrEqual(topbarBox.y + topbarBox.height);

      // 選取長度為 0 時不顯示
      await mobilePage.keyboard.press('ArrowRight');
      await selNotice.waitFor({ state: 'hidden' });

      // 全選 110 字（>= 100 字）→ 顯示「已選 110 字，刪掉會收進暫存區」
      await mobilePage.keyboard.press('Control+a');
      await selNotice.waitFor({ state: 'visible' });
      expect(await selNotice.textContent()).toBe('已選 110 字，刪掉會收進暫存區');

      // 刪除後觸發「已放到刪稿暫存區」角落提示，接著選取 10 字：兩者同時可見且不重疊
      await mobilePage.keyboard.press('Backspace');
      const cornerNotice = mobilePage.locator('[data-testid="trash-corner-notice"]');
      await cornerNotice.waitFor({ state: 'visible' });

      await mobilePage.keyboard.type('甲乙丙丁戊己庚辛壬癸');
      await mobilePage.keyboard.down('Shift');
      for (let i = 0; i < 10; i += 1) await mobilePage.keyboard.press('ArrowLeft');
      await mobilePage.keyboard.up('Shift');
      await selNotice.waitFor({ state: 'visible' });
      const cornerBox = await cornerNotice.boundingBox();
      const stackedSelBox = await selNotice.boundingBox();
      expect(cornerBox).not.toBeNull();
      expect(stackedSelBox).not.toBeNull();
      const overlap =
        cornerBox.x < stackedSelBox.x + stackedSelBox.width &&
        cornerBox.x + cornerBox.width > stackedSelBox.x &&
        cornerBox.y < stackedSelBox.y + stackedSelBox.height &&
        cornerBox.y + cornerBox.height > stackedSelBox.y;
      expect(overlap).toBe(false);

      // 打開刪稿暫存區清單時隱藏
      await mobilePage.locator('[data-testid="format-more-topbar"]').tap();
      await mobilePage.locator('[data-testid="format-menu-trash-open"]').tap();
      await mobilePage.locator('[data-testid="trash-sheet"]').waitFor({ state: 'visible' });
      expect(await selNotice.count()).toBe(0);
      await mobilePage.locator('[data-testid="trash-close"]').tap();

      // 專注模式時不顯示
      await textarea.tap();
      await mobilePage.keyboard.press('Control+a');
      await selNotice.waitFor({ state: 'visible' });
      await mobilePage.locator('[data-testid="enter-focus-mode"]').tap();
      expect(await selNotice.count()).toBe(0);
    } finally {
      await mobileCtx.close();
    }

    // 電腦寬螢幕：選取顯示且焦點離開正文後隱藏
    const desktopCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await seedBrowserStorage(desktopCtx);
    const desktopPage = await desktopCtx.newPage();
    try {
      await desktopPage.goto(`${baseUrl}/p/${BOOK_ID}/write/ch-select`, { waitUntil: 'domcontentloaded' });
      const textarea = desktopPage.locator('[data-testid="writing-input"]');
      const selNotice = desktopPage.locator('[data-testid="trash-selection-notice"]');
      await textarea.waitFor({ state: 'visible' });

      await textarea.click();
      await desktopPage.keyboard.press('Control+a');
      await selNotice.waitFor({ state: 'visible' });
      expect(await selNotice.textContent()).toBe('已選 110 字，刪掉會收進暫存區');

      await desktopPage.locator('[data-testid="toggle-cards-topbar"]').focus();
      await selNotice.waitFor({ state: 'hidden' });
    } finally {
      await desktopCtx.close();
    }
  }, 60000);

  it('返工 1 修正輪 2 必修 3：真實非範例書稿於手機橫拿（頁首顯示與隱藏）及寬版下，.trash-corner-stack 位置正確且寬版 top 為 auto', async () => {
    // 1. 手機橫拿：未打字（頁首可見）與打字中（html.landscape-writing 頁首收起）
    const landscapeCtx = await browser.newContext({
      viewport: { width: 667, height: 375 },
      hasTouch: true,
      isMobile: true,
    });
    await seedBrowserStorage(landscapeCtx);
    const landscapePage = await landscapeCtx.newPage();
    try {
      await landscapePage.goto(`${baseUrl}/p/${BOOK_ID}/write/ch-select`, { waitUntil: 'domcontentloaded' });
      const textarea = landscapePage.locator('[data-testid="writing-input"]');
      const topbar = landscapePage.locator('.editor .topbar.has-save-reminder');
      const stack = landscapePage.locator('.trash-corner-stack');
      const selNotice = landscapePage.locator('[data-testid="trash-selection-notice"]');
      await textarea.waitFor({ state: 'visible' });

      // 確認測試對象確為含 .has-save-reminder 的真實非範例書稿
      expect(await landscapePage.evaluate(() => document.documentElement.getAttribute('data-layout'))).toBe(
        'phone-landscape',
      );
      expect(await topbar.count()).toBe(1);
      expect(await topbar.isVisible()).toBe(true);

      // 選取文字讓 .trash-corner-stack 顯示（頁首可見狀態）
      await textarea.tap();
      await landscapePage.keyboard.press('Control+Home');
      await landscapePage.keyboard.down('Shift');
      for (let i = 0; i < 15; i += 1) await landscapePage.keyboard.press('ArrowRight');
      await landscapePage.keyboard.up('Shift');
      await selNotice.waitFor({ state: 'visible' });

      const topbarBox = await topbar.boundingBox();
      const stackVisibleTopbarBox = await stack.boundingBox();
      expect(topbarBox).not.toBeNull();
      expect(stackVisibleTopbarBox).not.toBeNull();
      // 頁首可見時，提示應放在頁首下方（約 60px），不可壓到頂部列，也不可被直拿 92px 規則蓋過
      expect(stackVisibleTopbarBox.y).toBeGreaterThanOrEqual(topbarBox.y + topbarBox.height);
      expect(stackVisibleTopbarBox.y).toBeLessThan(80);

      // 模擬橫拿打字鍵盤開啟（視窗可用高度縮至 220px），由 App 本身進入 html.landscape-writing 並收起頁首
      await landscapePage.setViewportSize({ width: 667, height: 220 });
      await landscapePage.waitForFunction(
        () =>
          document.documentElement.classList.contains('landscape-writing') &&
          document.documentElement.getAttribute('data-layout') === 'phone-landscape',
      );
      await topbar.waitFor({ state: 'hidden' });

      const stackWritingBox = await stack.boundingBox();
      const cardsBtnBox = await landscapePage.locator('[data-testid="toggle-cards-landscape"]').boundingBox();
      const formatBtnBox = await landscapePage.locator('[data-testid="format-more-landscape"]').boundingBox();
      expect(stackWritingBox).not.toBeNull();
      expect(cardsBtnBox).not.toBeNull();
      expect(formatBtnBox).not.toBeNull();
      // 頁首收起時應放回上方角落（約 8px），不可掉進 220px 高螢幕的正文中央（>= 80px）
      expect(stackWritingBox.y).toBeLessThan(24);
      expect(stackWritingBox.y + stackWritingBox.height).toBeLessThan(110);
      // 不可壓到右上「看卡片」或左上「⋯」浮動鈕
      const overlaps = (a, b) =>
        a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
      expect(overlaps(stackWritingBox, cardsBtnBox)).toBe(false);
      expect(overlaps(stackWritingBox, formatBtnBox)).toBe(false);
    } finally {
      await landscapeCtx.close();
    }

    // 2. 寬版（1280×900）：真實非範例書稿有 .has-save-reminder 時，top 仍維持 auto 且貼右下角不拉伸
    const wideCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await seedBrowserStorage(wideCtx);
    const widePage = await wideCtx.newPage();
    try {
      await widePage.goto(`${baseUrl}/p/${BOOK_ID}/write/ch-select`, { waitUntil: 'domcontentloaded' });
      const textarea = widePage.locator('[data-testid="writing-input"]');
      const topbar = widePage.locator('.editor .topbar.has-save-reminder');
      const stack = widePage.locator('.trash-corner-stack');
      const selNotice = widePage.locator('[data-testid="trash-selection-notice"]');
      await textarea.waitFor({ state: 'visible' });

      expect(await widePage.evaluate(() => document.documentElement.getAttribute('data-layout'))).toBe('wide');
      expect(await topbar.count()).toBe(1);

      await textarea.click();
      await widePage.keyboard.press('Control+a');
      await selNotice.waitFor({ state: 'visible' });

      const wideInspection = await stack.evaluate((el) => {
        const computed = getComputedStyle(el);
        const matchingTopRules = [];
        for (const sheet of Array.from(document.styleSheets)) {
          let rules;
          try {
            rules = sheet.cssRules;
          } catch {
            continue;
          }
          for (const rule of Array.from(rules)) {
            if (rule instanceof CSSStyleRule && rule.style.top && el.matches(rule.selectorText)) {
              matchingTopRules.push({ selector: rule.selectorText, top: rule.style.top });
            }
          }
        }
        return {
          computedTop: computed.top,
          computedBottom: computed.bottom,
          matchingTopRules,
        };
      });
      const wideStackBox = await stack.boundingBox();
      expect(wideStackBox).not.toBeNull();
      // position: fixed + top: auto + bottom: 20px 在 CSSOM 會解析為貼底像素值（非 92px），且命中的最高規則為 top: auto
      expect(wideInspection.matchingTopRules.some((r) => r.selector.includes('.has-save-reminder'))).toBe(false);
      expect(wideInspection.matchingTopRules.at(-1)?.top).toBe('auto');
      expect(Math.abs(parseFloat(wideInspection.computedTop) - wideStackBox.y)).toBeLessThan(1.5);
      expect(wideStackBox.y).toBeGreaterThan(450);
      expect(wideStackBox.height).toBeLessThan(120);
    } finally {
      await wideCtx.close();
    }
  }, 60000);
});
