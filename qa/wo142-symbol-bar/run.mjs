/**
 * WO-142：寫作頁全形標點列的瀏覽器驗收（不屬於 npm test，由派工者執行）。
 *
 * 每個情境都用全新的 context，並自己從首頁「開新稿子」建立【範例】稿；
 * 不讀任何真實稿件或 .db。電腦情境用 init script 寫入 input-mode=mouse、device-kind=computer
 * （無頭 Chromium 預設會被猜成手指裝置）。
 *
 * 環境變數：
 *   BASE       預設 http://127.0.0.1:4199
 *   QA_DIR     報告與截圖目錄，預設 /workspace/delivery/novel-editor-mobile/wo142/qa
 *   HEADLESS   1（預設）或 0
 *   PLAYWRIGHT_MODULE、CHROMIUM_PATH（沿用 qa/playwright-env.mjs）
 * 有任何「失敗」結束碼為 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromiumPath, loadPlaywright } from '../playwright-env.mjs';

const BASE = (process.env.BASE || 'http://127.0.0.1:4199').replace(/\/$/, '');
const QA_DIR = process.env.QA_DIR || '/workspace/delivery/novel-editor-mobile/wo142/qa';
const HEADLESS = process.env.HEADLESS !== '0';
const KEY = 'jiufang-novel-m.symbol-bar.v1';
const TITLE = '【範例】WO-142 驗收';
// 以 src/editor/writingSymbols.ts 為準
const SYMBOL_IDS = [
  'ideographic-space', 'comma', 'period', 'enum-comma', 'question', 'exclamation', 'colon', 'semicolon',
  'ellipsis', 'dash', 'quote', 'double-quote', 'book-title', 'article-title',
];
fs.mkdirSync(QA_DIR, { recursive: true });

let failed = 0;
const check = (item, ok, expected, actual) => {
  if (!ok) failed += 1;
  console.log(`${ok ? '通過' : '失敗'} ${item} :: 預期 ${expected} / 實際 ${actual}`);
};
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);

const initScript = ({ desktop }) => {
  try {
    localStorage.setItem(
      'jiufang-novel-m.onboarding.v1',
      JSON.stringify({ status: 'skipped', at: '2026-11-18T05:00:00.000Z', appVersion: '0.1.0' }),
    );
    localStorage.setItem('jiufang-novel-m.theme.v1', 'forest');
    if (desktop) {
      localStorage.setItem('jiufang-novel-m.input-mode.v1', 'mouse');
      localStorage.setItem('jiufang-novel-m.device-kind.v1', 'computer');
    }
  } catch {}
};

const playwright = await loadPlaywright();
const exe = chromiumPath();
const launchOpts = { headless: HEADLESS, args: ['--no-sandbox', '--disable-setuid-sandbox'] };
const browser = await playwright.chromium.launch(exe && fs.existsSync(exe) ? { ...launchOpts, executablePath: exe } : launchOpts);

/** 開全新 context，從首頁開新範例稿，回到寫作頁。 */
async function openSample(contextOptions, desktop) {
  const context = await browser.newContext(contextOptions);
  await context.addInitScript(initScript, { desktop });
  const page = await context.newPage();
  await page.goto(BASE);
  const skip = page.getByRole('button', { name: '跳過' });
  if (await skip.first().isVisible().catch(() => false)) await skip.first().click();
  await page.getByRole('button', { name: '開新稿子' }).first().click();
  await page.locator('form.dialog input').first().fill(TITLE);
  await page.locator('form.dialog button[type="submit"]').first().click();
  await page.waitForURL(/\/p\/[^/]+\/write/, { timeout: 15000 });
  const input = tid(page, 'writing-input');
  await input.waitFor({ timeout: 15000 });
  return { context, page, input };
}

const focusedIsInput = (page) =>
  page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'writing-input');
const caretOf = (input) => input.evaluate((el) => [el.selectionStart, el.selectionEnd]);

// ---- 電腦（滑鼠） ----
{
  const { context, page, input } = await openSample({ viewport: { width: 1280, height: 800 } }, true);
  const bar = tid(page, 'symbol-bar');
  check('電腦預設關閉', (await bar.count()) === 0, '沒有符號列', String(await bar.count()));

  await tid(page, 'format-more-topbar').click();
  check('選單顯示「顯示符號列」', (await tid(page, 'format-menu-symbol-bar-toggle').innerText()).includes('顯示符號列'), '顯示符號列', '見畫面');
  await tid(page, 'format-menu-symbol-bar-toggle').click();
  await bar.waitFor();
  check('從「⋯」打開後顯示', await bar.isVisible(), '顯示', String(await bar.isVisible()));
  const ids = await page.locator('[data-symbol-id]').evaluateAll((els) => els.map((el) => el.getAttribute('data-symbol-id')));
  check('14 個鍵、id 與順序', JSON.stringify(ids) === JSON.stringify(SYMBOL_IDS), SYMBOL_IDS.join(','), ids.join(','));
  check('記住為 1', (await page.evaluate((k) => localStorage.getItem(k), KEY)) === '1', '1', '見畫面');

  await input.click();
  await input.press('Control+A');
  await input.press('Delete');
  await input.pressSequentially('甲乙');
  await input.press('ArrowLeft');
  await tid(page, 'symbol-key-quote').click();
  check('成對符號插入', (await input.inputValue()) === '甲「」乙', '甲「」乙', await input.inputValue());
  check('點符號後焦點仍在輸入框', await focusedIsInput(page), '是', '否');
  const caret = await caretOf(input);
  check('游標在中間', caret[0] === 2 && caret[1] === 2, '2,2', caret.join(','));
  await input.press('Control+Z');
  check('Ctrl+Z 一次整對復原', (await input.inputValue()) === '甲乙', '甲乙', await input.inputValue());

  // 選取後包起來
  await input.press('Control+A');
  await tid(page, 'symbol-key-book-title').click();
  check('選取後包起來', (await input.inputValue()) === '《甲乙》', '《甲乙》', await input.inputValue());
  const wrapCaret = await caretOf(input);
  check('包起來後游標在右符號之後', wrapCaret[0] === 4, '4', String(wrapCaret[0]));

  // 破折號
  await input.press('Control+A');
  await tid(page, 'symbol-key-dash').click();
  check('破折號為 U+2500×2', (await input.inputValue()) === '──', '──', await input.inputValue());

  // 大段選取包「」後 Ctrl+Z 內容回原樣
  const BIG = '字'.repeat(150);
  await input.fill(`前${BIG}`);
  const original = await input.inputValue();
  await input.press('Control+A');
  await tid(page, 'symbol-key-quote').click();
  check('大段選取包「」', (await input.inputValue()) === `「${original}」`, '包起來', (await input.inputValue()).slice(0, 6));
  await input.press('Control+Z');
  check('Ctrl+Z 後內容回原樣', (await input.inputValue()) === original, '原樣', `長度 ${(await input.inputValue()).length}`);
  await page.screenshot({ path: path.join(QA_DIR, 'desktop-symbol-bar.png') });
  await context.close();
}

// ---- 手機直拿（手指） ----
{
  const { context, page, input } = await openSample(
    { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
    false,
  );
  const bar = tid(page, 'symbol-bar');
  check('手機沒焦點時不顯示', (await bar.count()) === 0, '沒有', String(await bar.count()));
  await input.tap();
  await bar.waitFor();
  check('手機有焦點時顯示', await bar.isVisible(), '顯示', String(await bar.isVisible()));
  await input.pressSequentially('甲');
  await tid(page, 'symbol-key-comma').tap();
  check('點符號後輸入框內容', (await input.inputValue()).includes('甲，'), '含 甲，', await input.inputValue());
  check('點符號後焦點仍在輸入框', await focusedIsInput(page), '是', '否');
  await page.screenshot({ path: path.join(QA_DIR, 'phone-portrait-bar.png') });
  await tid(page, 'symbol-bar-collapse').tap();
  check('收起後不顯示', (await bar.count()) === 0, '沒有', String(await bar.count()));
  check('收起後焦點仍在輸入框', await focusedIsInput(page), '是', '否');
  check('收起後記住為 0', (await page.evaluate((k) => localStorage.getItem(k), KEY)) === '0', '0', '見畫面');
  await context.close();
}

// ---- 手機橫拿：收起鈕不被浮動圓鈕蓋住 ----
{
  const { context, page, input } = await openSample(
    { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true },
    false,
  );
  await input.tap();
  const bar = tid(page, 'symbol-bar');
  await bar.waitFor();
  const collapse = tid(page, 'symbol-bar-collapse');
  const box = await collapse.boundingBox();
  check('收起鈕有位置', Boolean(box), '有', String(Boolean(box)));
  if (box) {
    const hit = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return el?.closest('[data-testid="symbol-bar-collapse"]') ? 'self' : (el?.className || el?.tagName || 'none').toString();
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
    check('收起鈕中心點命中自己（沒被浮動鈕蓋住）', hit === 'self', 'self', hit);
    check('收起鈕左緣離螢幕邊至少 72px', box.x >= 72, '>=72', String(Math.round(box.x)));
  }
  const keyBox = await tid(page, 'symbol-key-article-title').boundingBox();
  check('最右符號鍵可捲到（鍵存在）', Boolean(keyBox), '有', String(Boolean(keyBox)));
  await page.screenshot({ path: path.join(QA_DIR, 'phone-landscape-bar.png') });
  await context.close();
}

await browser.close();
process.exit(failed ? 1 : 0);
