/**
 * WO-84：首頁最近清單同名稿子合併成一筆（只留剛存的那份）專用檢查
 *
 * 啟動：BASE=http://127.0.0.1:4194 ENGINE=chromium node qa/最近清單同名合併/run.mjs
 * 環境變數：BASE、SHOT_DIR（截圖資料夾，預設 test-results/qa/最近清單同名合併/截圖）、PLAYWRIGHT_MODULE、CHROMIUM_PATH
 *
 * 流程（每個版面各跑一次，都從畫面正常入口操作，不 force、不 evaluate 改狀態、不跳內部網址）：
 *   A 開新【範例】稿，寫正文甲，另存成 .db，從「開啟稿子」開回本趟下載的檔，回首頁：同名只一筆，點開看到正文甲。
 *   B 再開同書名的第二份稿，寫不同的正文乙，另存（較晚）；再開回較舊的檔（開啟順序晚於存檔順序）；
 *     回首頁：同名只一筆，點開看到的是較晚另存的正文乙，不是剛開啟的舊檔。
 *   觀察：檔案頁（App 空間）另一份是否仍可見，照實記錄。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, chromiumPath } from '../playwright-env.mjs';

const { chromium } = loadPlaywright();
const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '../..');
const BASE = (process.env.BASE || 'http://127.0.0.1:4194').replace(/\/$/, '');
const SHOT_DIR = process.env.SHOT_DIR || path.join(ROOT, 'test-results/qa/最近清單同名合併/截圖');
const TMP = path.join(ROOT, 'test-results/qa/最近清單同名合併/下載');
fs.mkdirSync(SHOT_DIR, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const LAYOUTS = [
  { id: 'phone-portrait', name: '手機直拿', size: '390x844', viewport: { width: 390, height: 844 }, touch: true },
  { id: 'phone-landscape', name: '手機橫拿', size: '844x390', viewport: { width: 844, height: 390 }, touch: true },
  { id: 'tablet-portrait', name: '中等', size: '768x1024', viewport: { width: 768, height: 1024 }, touch: true },
  { id: 'desktop-wide', name: '寬版', size: '1280x800', viewport: { width: 1280, height: 800 }, touch: false },
];
const results = [];
const check = (L, item, ok, actual) => {
  results.push({ layout: L.name, item, ok, actual });
  console.log(`[${L.name}] ${ok ? '通過' : '失敗'} ${item} :: ${actual}`);
};

async function run(L) {
  const exe = chromiumPath();
  const opts = { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] };
  if (exe && fs.existsSync(exe)) opts.executablePath = exe;
  const browser = await chromium.launch(opts);
  const ctxOpts = { viewport: L.viewport, locale: 'zh-TW', timezoneId: 'Asia/Taipei', acceptDownloads: true };
  if (L.touch) { ctxOpts.hasTouch = true; ctxOpts.isMobile = true; }
  const context = await browser.newContext(ctxOpts);
  // 與存檔再開腳本相同：模擬沒有系統存檔／選檔視窗的瀏覽器（如 iPhone Safari），走下載與選檔器路徑。
  await context.addInitScript(() => { try { delete window.showSaveFilePicker; delete window.showOpenFilePicker; } catch { /* 略 */ } });
  const page = await context.newPage();
  const act = (loc) => (L.touch ? loc.tap({ timeout: 8000 }) : loc.click({ timeout: 8000 }));
  const title = `【範例】同名合併測試-${L.name}`;
  const T1 = `甲稿：舊燈塔的光掃過海面，${L.name}。`;
  const T2 = `乙稿：新港口的鐘聲響了三下，${L.name}。`;
  const shotAs = (name) => page.screenshot({ path: path.join(SHOT_DIR, `${name}-${L.name}-${L.size}.png`) });
  const goHome = async () => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="home-screen"]', { timeout: 20000 });
  };
  const ensureTree = async () => {
    const rows = page.locator('.tree-row[data-node-id]');
    if (await rows.first().isVisible().catch(() => false)) return;
    for (const s of ['[data-testid="back-button"]', '[data-testid="toggle-tree-topbar"]', '[data-testid="toggle-tree-floating"]']) {
      const b = page.locator(s).first();
      if (await b.isVisible().catch(() => false)) { await act(b).catch(() => {}); await page.waitForTimeout(600); if (await rows.first().isVisible().catch(() => false)) return; }
    }
  };
  const gotoFiles = async () => {
    const nav = L.id === 'desktop-wide' || L.id === 'phone-landscape' ? '[data-testid="nav-rail"]' : '[data-testid="bottom-nav"]';
    const btn = page.locator(`${nav} [data-testid="nav-files"]`).first();
    if (L.id === 'phone-landscape' && !(await btn.isVisible().catch(() => false))) {
      const o = page.locator('[data-testid="toggle-tree-floating"]').first();
      if (await o.isVisible().catch(() => false)) { await act(o); await page.waitForTimeout(600); }
    }
    if (await btn.isVisible().catch(() => false)) await act(btn);
    else await act(page.locator('button.save-status, [data-testid="save-status"]').first());
    await page.waitForSelector('[data-testid="save-as-project"]', { timeout: 8000 });
  };
  /** 開新稿、寫正文、另存，回傳下載檔路徑 */
  const createAndSave = async (text, tag) => {
    await goHome();
    await act(page.getByRole('button', { name: '開新稿子' }).first());
    await page.locator('form.dialog input').first().fill(title);
    await act(page.locator('form.dialog button[type="submit"]').first());
    await page.waitForURL(/\/p\/[^/]+\/write/, { timeout: 15000 });
    await page.waitForTimeout(800);
    await ensureTree();
    const input = page.locator('[data-testid="writing-input"], textarea.editor-input').first();
    if (!(await input.isVisible().catch(() => false))) await act(page.locator('.tree-row[data-node-id] .tree-main').first());
    await input.waitFor({ state: 'visible', timeout: 10000 });
    await act(input);
    await page.keyboard.type(text, { delay: 10 });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1500);
    await gotoFiles();
    const dlWait = page.waitForEvent('download', { timeout: 20000 });
    await act(page.locator('[data-testid="save-as-project"]').first());
    const dl = await dlWait;
    const file = path.join(TMP, `${L.id}-${tag}.db`);
    await dl.saveAs(file);
    await page.waitForTimeout(2000);
    return file;
  };
  const reopen = async (file) => {
    await goHome();
    const chooserWait = page.waitForEvent('filechooser', { timeout: 10000 });
    await act(page.getByRole('button', { name: '開啟稿子' }).first());
    await (await chooserWait).setFiles(file);
    await page.waitForURL(/\/p\/[^/]+\/write/, { timeout: 20000 });
    await page.waitForTimeout(1000);
  };
  const homeCards = async () => {
    await goHome();
    const cards = page.locator('[data-testid="project-card"]');
    // 檔案稿子是非同步從本機載回，先等到至少一筆同名出現，再稍等其餘載入完成才計數。
    await page.locator('[data-testid="project-card"]', { hasText: title }).first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(2000);
    const n = await cards.count();
    const same = [];
    for (let i = 0; i < n; i++) { const t = (await cards.nth(i).innerText()).replace(/\s+/g, ' '); if (t.includes(title)) same.push(t); }
    return same;
  };
  const openCardAndRead = async () => {
    await act(page.locator('[data-testid="project-card"]', { hasText: title }).first().locator('a.project-main'));
    await page.waitForURL(/\/p\/[^/]+\/write/, { timeout: 15000 });
    await page.waitForTimeout(800);
    await ensureTree();
    const input = page.locator('[data-testid="writing-input"], textarea.editor-input').first();
    if (!(await input.isVisible().catch(() => false))) { await act(page.locator('.tree-row[data-node-id] .tree-main').first()); }
    await input.waitFor({ state: 'visible', timeout: 10000 });
    return input.inputValue();
  };

  try {
    // A：另存再開
    const f1 = await createAndSave(T1, '甲');
    await reopen(f1);
    let cards = await homeCards();
    check(L, 'A 另存再開後首頁同名只一筆', cards.length === 1, `同名 ${cards.length} 筆：${JSON.stringify(cards)}`);
    await shotAs('首頁');
    let body = await openCardAndRead();
    check(L, 'A 點開看到剛存的正文甲', body === T1, `正文 ${JSON.stringify(body)}`);
    await shotAs('點開剛存正文');

    // B：同名第二份、不同正文，較晚另存；再開較舊的檔
    const f2 = await createAndSave(T2, '乙');
    await reopen(f1);
    cards = await homeCards();
    check(L, 'B 開回較舊檔後首頁同名仍只一筆', cards.length === 1, `同名 ${cards.length} 筆：${JSON.stringify(cards)}`);
    body = await openCardAndRead();
    check(L, 'B 點開的是較晚另存的正文乙（不是剛開啟的舊檔甲）', body === T2, `正文 ${JSON.stringify(body)}`);
    await shotAs('B點開較晚另存正文');
    // 觀察：檔案頁另一份是否仍可見
    await gotoFiles();
    const filesText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const occurrences = filesText.split(title).length - 1;
    console.log(`[${L.name}] 觀察 檔案頁書名出現 ${occurrences} 次：${filesText.slice(0, 300)}`);
    results.push({ layout: L.name, item: '觀察：檔案頁書名出現次數', ok: true, actual: `${occurrences} 次` });
    void f2;
  } catch (err) {
    check(L, '流程完成', false, String(err).slice(0, 300));
    try { await shotAs('失敗現場'); } catch { /* 略 */ }
  } finally {
    await browser.close();
  }
}

for (const L of LAYOUTS) await run(L);
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(ROOT, 'test-results/qa/最近清單同名合併/結果.json'), JSON.stringify(results, null, 2));
console.log(`\n共 ${results.length} 項，失敗 ${failed.length} 項`);
process.exit(failed.length ? 1 : 0);
