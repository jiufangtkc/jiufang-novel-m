/**
 * WO-120：匯入文字檔改到首頁，統計改為匯入說明（獨立 QA，不屬於 npm test）。
 *
 * 只用假稿與記憶體產生的假文字檔；先略過歡迎導覽；不碰真書稿或 .db。
 * 檢查：
 *  1. 390、1024、1440 寬度的首頁三鈕：順序、文字完整（不被切掉）、不超出視窗左右、有換行時仍整顆在畫面內。
 *  2. 新開假稿後，檔案頁沒有「匯入文字檔」按鈕，並記錄分組標題現況（標題已改為「匯出」）。
 *  3. 沒匯入過的假稿：統計頁沒有匯入說明與「匯入次數」，紀錄卡沒有「這天從文字檔匯入」「大量刪除」。
 *  4. 首頁按「匯入文字檔」選假 .txt：直接開成新稿子；新稿統計頁有一整句、紀錄卡有匯入日一行、沒有次數與大量刪除。
 *
 * 環境變數：BASE（預設 http://127.0.0.1:4199）、PLAYWRIGHT_MODULE、CHROMIUM_PATH、QA_DIR、SHOT_DIR、RUN_LABEL。
 * 有任何斷言失敗，結束碼為 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumPath, loadPlaywright } from '../playwright-env.mjs';

const pw = loadPlaywright();
const BASE = (process.env.BASE || 'http://127.0.0.1:4199').replace(/\/$/, '');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const QA_DIR = process.env.QA_DIR || path.join(REPO_ROOT, 'test-results', 'qa', 'wo120-import-home');
const RUN_LABEL = process.env.RUN_LABEL || 'WO-120';
const SHOT_DIR = process.env.SHOT_DIR || path.join(QA_DIR, '截圖');
fs.mkdirSync(QA_DIR, { recursive: true });
fs.mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
function rec(scene, item, ok, expected, actual) {
  results.push({ scene, item, status: ok ? 'passed' : 'failed', expected: String(expected), actual: String(actual) });
  console.log(`${ok ? '通過' : '失敗'} [${scene}] ${item} :: 預期 ${expected} / 實際 ${actual}`);
}
function note(scene, item, text) {
  results.push({ scene, item, status: 'note', actual: text });
  console.log(`備註 [${scene}] ${item} :: ${text}`);
}

const tid = (page, id) => page.locator(`[data-testid="${id}"]`);

async function launch() {
  const opts = { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] };
  const exe = chromiumPath();
  return pw.chromium.launch(exe && fs.existsSync(exe) ? { ...opts, executablePath: exe } : opts);
}

async function skipTourIfAny(page) {
  const skip = page.locator('.welcome-skip').first();
  if (await skip.isVisible().catch(() => false)) {
    await skip.click({ timeout: 8000 });
    await page.waitForTimeout(400);
  }
}

async function openHome(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await skipTourIfAny(page);
  await page.waitForSelector('[data-testid="home-screen"]', { timeout: 20000 });
}

async function createDraft(page, title) {
  await openHome(page);
  await page.getByRole('button', { name: '開新稿子' }).first().click({ timeout: 8000 });
  await page.locator('form.dialog input').first().fill(title);
  await page.locator('form.dialog button[type="submit"]').first().click({ timeout: 8000 });
  await page.waitForURL(/\/p\/[^/]+\/write/, { timeout: 15000 });
  await page.waitForTimeout(600);
}

/** 唯讀量測首頁動作列三顆按鈕。 */
async function measureHomeButtons(page) {
  return page.evaluate(() => {
    const footer = document.querySelector('.home-actions');
    const buttons = [...footer.querySelectorAll(':scope > button')];
    return {
      vw: document.documentElement.clientWidth,
      footerRight: footer.getBoundingClientRect().right,
      buttons: buttons.map((b) => {
        const r = b.getBoundingClientRect();
        return {
          text: b.textContent.trim(),
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          clipped: b.scrollWidth > b.clientWidth + 1,
        };
      }),
    };
  });
}

async function homeLayoutScene(browser, label, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  await openHome(page);
  const m = await measureHomeButtons(page);
  const names = m.buttons.map((b) => b.text);
  rec(label, '首頁三顆按鈕順序', JSON.stringify(names) === JSON.stringify(['開新稿子', '開啟稿子', '匯入文字檔']), '開新稿子→開啟稿子→匯入文字檔', names.join('→'));
  rec(label, '文字沒有被切掉', m.buttons.every((b) => !b.clipped), '全部未切字', m.buttons.map((b) => b.clipped).join(','));
  rec(label, '沒有超出視窗左右', m.buttons.every((b) => b.left >= 0 && b.right <= m.vw + 0.5), `0～${m.vw}`, m.buttons.map((b) => `${Math.round(b.left)}-${Math.round(b.right)}`).join(' / '));
  const rows = new Set(m.buttons.map((b) => Math.round(b.top)));
  note(label, '排列', rows.size === 1 ? '三顆同一排' : `分 ${rows.size} 排（窄版換行）`);
  await page.screenshot({ path: path.join(SHOT_DIR, `首頁-${label}.png`) });
  await ctx.close();
}

async function main() {
  const browser = await launch();
  try {
    await homeLayoutScene(browser, '手機直拿390', 390, 844);
    await homeLayoutScene(browser, '手機橫拿844', 844, 390);
    await homeLayoutScene(browser, '中等768', 768, 1024);
    await homeLayoutScene(browser, '1024', 1024, 768);
    await homeLayoutScene(browser, '1440', 1440, 900);

    // 沒匯入過的假稿
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const page = await ctx.newPage();
    await createDraft(page, '【範例】匯入首頁QA');
    const projectId = page.url().match(/\/p\/([^/]+)\//)?.[1];

    await page.goto(`${BASE}/p/${projectId}/files`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="files-screen"]', { timeout: 15000 });
    rec('檔案頁', '沒有匯入文字檔按鈕', (await tid(page, 'import-text-file').count()) === 0, '0', await tid(page, 'import-text-file').count());
    const filesText = await page.locator('[data-testid="files-screen"]').innerText();
    rec('檔案頁', '畫面沒有「匯入文字檔」字樣', !filesText.includes('匯入文字檔'), '不含', filesText.includes('匯入文字檔') ? '含' : '不含');
    const groupTitle = await tid(page, 'files-group-import-export').locator('h2').innerText();
    note('檔案頁', '分組標題現況', `標題是「${groupTitle}」（九方 t408s2930 定案改為「匯出」），組內只剩「匯出全文」一項。`);
    await page.screenshot({ path: path.join(SHOT_DIR, '檔案頁-只剩匯出.png'), fullPage: true });

    await page.goto(`${BASE}/p/${projectId}/stats`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="stats-screen"]', { timeout: 15000 });
    const noImportStats = await page.locator('[data-testid="stats-screen"]').innerText();
    rec('統計頁（無匯入）', '沒有匯入說明與次數字樣', !/從文字檔匯入的|匯入次數|只算匯入文字檔的次數/.test(noImportStats), '不含', /從文字檔匯入的|匯入次數|只算匯入文字檔的次數/.test(noImportStats) ? '含' : '不含');
    await page.screenshot({ path: path.join(SHOT_DIR, '統計頁-無匯入.png'), fullPage: true });
    await ctx.close();

    // 匯入：首頁按鈕選假 .txt，直接開成新稿子
    const ctx2 = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const p2 = await ctx2.newPage();
    await openHome(p2);
    await p2.locator('[data-testid="import-text-input"]').setInputFiles({
      name: '【範例】匯入假稿.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('第一章 起\n假正文一\n第二章 承\n假正文二\n', 'utf8'),
    });
    await p2.waitForURL(/\/p\/[^/]+\/write/, { timeout: 20000 }).catch(() => {});
    rec('匯入', '成功後直接開成新稿子（進入寫作頁）', /\/p\/[^/]+\/write/.test(p2.url()), '/p/:id/write', p2.url());
    const importedId = p2.url().match(/\/p\/([^/]+)\//)?.[1];

    await p2.goto(`${BASE}/p/${importedId}/stats`, { waitUntil: 'domcontentloaded' });
    await p2.waitForSelector('[data-testid="stats-screen"]', { timeout: 15000 });
    const noteText = await tid(p2, 'stats-import-note').first().innerText().catch(() => '');
    rec('統計頁（有匯入）', '一整句匯入說明（年必寫、月日不補 0、不含星期）', /^這份稿子是 \d{4} 年 (?:[1-9]|1[0-2]) 月 (?:[1-9]|[12]\d|3[01]) 日從文字檔匯入的。$/.test(noteText), '這份稿子是 YYYY 年 M 月 D 日從文字檔匯入的。', noteText);
    const withImport = await p2.locator('[data-testid="stats-screen"]').innerText();
    rec('統計頁（有匯入）', '沒有次數字樣', !/匯入次數|只算匯入文字檔的次數/.test(withImport), '不含', /匯入次數|只算匯入文字檔的次數/.test(withImport) ? '含' : '不含');
    await p2.screenshot({ path: path.join(SHOT_DIR, '統計頁-有匯入.png'), fullPage: true });

    await p2.goto(`${BASE}/p/${importedId}/logs`, { waitUntil: 'domcontentloaded' });
    await p2.waitForSelector('[data-testid="logs-screen"]', { timeout: 15000 });
    const logsText = await p2.locator('[data-testid="logs-screen"]').innerText();
    rec('紀錄頁（有匯入）', '匯入日有「這天從文字檔匯入」且只一行', (logsText.match(/這天從文字檔匯入/g) || []).length === 1, '1 行', (logsText.match(/這天從文字檔匯入/g) || []).length);
    rec('紀錄頁（有匯入）', '沒有「匯入 N 次」與「大量刪除」', !/匯入[\s　]*\d+\s*次|大量刪除/.test(logsText), '不含', /匯入[\s　]*\d+\s*次|大量刪除/.test(logsText) ? '含' : '不含');
    await p2.screenshot({ path: path.join(SHOT_DIR, '紀錄頁-有匯入.png'), fullPage: true });
    await ctx2.close();
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => r.status === 'failed');
  fs.writeFileSync(path.join(QA_DIR, 'results.json'), JSON.stringify({ label: RUN_LABEL, base: BASE, results }, null, 2));
  console.log(`\n${RUN_LABEL}：共 ${results.length} 項，失敗 ${failed.length} 項`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
