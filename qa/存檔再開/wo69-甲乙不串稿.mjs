/**
 * WO-69：甲、乙兩份【範例】新稿與內建範例書的「今天寫了」與統計互不干擾（四種版面，畫面操作）。
 *
 * 啟動：BASE=http://127.0.0.1:4173 RUN_LABEL=WO-69-甲乙-第1次 node qa/存檔再開/wo69-甲乙不串稿.mjs
 * 流程（每種版面一個全新瀏覽器環境，全程不重新整理）：
 *   範例書統計基準 → 關閉回首頁 → 開甲、寫字、看統計 → 關閉 → 開乙（先看是 0）、寫字、看統計 → 關閉
 *   → 從最近清單開回甲（仍是甲的值）→ 關閉 → 開回乙（仍是乙的值）→ 關閉 → 開回範例書（與基準相同）。
 * 守則：只用 tap／click 實際操作，不用 force，不用 evaluate 改狀態或呼叫內部函式，不跳內部網址；
 *   唯一的 page.goto 是一開始打開首頁。手機橫拿沿用 WO-68 直排分頁（寫作頁先按「展開目錄」）。
 *   本次以 Chromium 代測，無 WebKit 證據。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, chromiumPath } from '../playwright-env.mjs';

const { chromium } = loadPlaywright();
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');

const BASE = (process.env.BASE || 'http://127.0.0.1:4173').replace(/\/$/, '');
const QA_DIR = process.env.QA_DIR || process.env.OUT_DIR || path.join(REPO_ROOT, 'test-results', 'qa', '存檔再開');
const RUN_LABEL = process.env.RUN_LABEL || 'WO-69-甲乙-試跑';
const RUN_DIR = path.join(QA_DIR, RUN_LABEL);
const SHELL = chromiumPath();
fs.mkdirSync(RUN_DIR, { recursive: true });

const LAYOUTS = [
  { id: 'phone-portrait', name: '手機直拿', viewport: { width: 390, height: 844 }, touch: true },
  { id: 'phone-landscape', name: '手機橫拿', viewport: { width: 844, height: 390 }, touch: true },
  { id: 'tablet-portrait', name: '中等', viewport: { width: 768, height: 1024 }, touch: true },
  { id: 'desktop-wide', name: '寬版', viewport: { width: 1280, height: 800 }, touch: false },
];
const taipeiTime = () => new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });

const results = [];
function rec(L, step, item, ok, expected, actual, shotRel = null) {
  const e = { layout: L.name, step, item, status: ok ? '通過' : '失敗', expected, actual, screenshot: shotRel };
  results.push(e);
  console.log(`[${L.name}] ${e.status} ${step} ${item} :: ${actual}`.slice(0, 400));
}

const act = (L, loc) => (L.touch ? loc.tap({ timeout: 8000 }) : loc.click({ timeout: 8000 }));
const vis = (loc) => loc.first().isVisible().catch(() => false);

function parseStats(t) {
  const s = String(t);
  const num = (re) => { const m = s.match(re); return m ? Number(m[1].replace(/,/g, '')) : null; };
  return {
    today: num(/今天寫了\s*([\d,]+)/),
    streak: num(/連續寫作\s*(\d+)\s*天/),
    longest: num(/最長連續\s*(\d+)/),
    last7: num(/近\s*7\s*天累計\s*([\d,]+)/),
    hours: (s.match(/總共寫了\s*([\d.]+)\s*小時/) || [])[1] ?? null,
    activeDays: num(/有寫的天數\s*([\d,]+)/),
    achieved: num(/已達成\s*(\d+)\s*次/),
  };
}
const fmt = (p) => `今天 ${p.today}、連續 ${p.streak}、最長連續 ${p.longest}、近七日 ${p.last7}、時數 ${p.hours}、有寫天數 ${p.activeDays}、已達成 ${p.achieved}`;
const same = (a, b) => ['today', 'streak', 'longest', 'last7', 'hours', 'activeDays', 'achieved'].every((k) => String(a[k]) === String(b[k]));

async function shot(page, L, name) {
  const dir = path.join(RUN_DIR, L.id);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${name}.png`);
  await page.screenshot({ path: f }).catch(() => {});
  return path.relative(QA_DIR, f);
}

async function gotoTab(page, L, tab) {
  const nav = L.id === 'desktop-wide' || L.id === 'phone-landscape' ? '[data-testid="nav-rail"]' : '[data-testid="bottom-nav"]';
  const btn = page.locator(`${nav} [data-testid="nav-${tab}"]`).first();
  if (L.id === 'phone-landscape' && !(await vis(btn))) {
    const opener = page.locator('[data-testid="toggle-tree-floating"]').first();
    if (await vis(opener)) { await act(L, opener); await page.waitForTimeout(600); }
  }
  if (!(await vis(btn))) return false;
  await act(L, btn);
  await page.waitForURL((u) => u.toString().includes(`/${tab}`), { timeout: 8000 }).catch(() => null);
  await page.waitForTimeout(500);
  return page.url().includes(`/${tab}`);
}

async function readStats(page, L) {
  if (!(await gotoTab(page, L, 'stats'))) return null;
  await page.waitForSelector('[data-testid="stats-screen"]', { timeout: 8000 }).catch(() => {});
  const t = (await page.locator('[data-testid="stats-screen"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
  return { text: t, ...parseStats(t) };
}

async function closeToHome(page, L) {
  if (!(await gotoTab(page, L, 'files'))) return false;
  const close = page.locator('[data-testid="close-project"]').first();
  if (!(await vis(close))) return false;
  await act(L, close);
  return page.waitForSelector('[data-testid="home-screen"]', { timeout: 10000 }).then(() => true).catch(() => false);
}

async function openFromRecent(page, L, title) {
  const link = page.locator('[data-testid="project-card"] a.project-main', { hasText: title }).first();
  if (!(await vis(link))) return false;
  await act(L, link);
  await page.waitForURL(/\/p\/[^/]+\/write/, { timeout: 10000 }).catch(() => null);
  await page.waitForTimeout(600);
  return /\/p\/[^/]+\/write/.test(page.url());
}

async function createDraft(page, L, title) {
  await act(L, page.getByRole('button', { name: '開新稿子' }).first());
  await page.locator('form.dialog input').first().fill(title);
  await act(L, page.locator('form.dialog button[type="submit"]').first());
  await page.waitForURL(/\/p\/[^/]+\/write/, { timeout: 15000 });
  await page.waitForTimeout(700);
}

async function typeInFirstChapter(page, L, text) {
  const input = page.locator('[data-testid="writing-input"], textarea.editor-input').first();
  if (!(await vis(input))) {
    for (const s of ['[data-testid="back-button"]', '[data-testid="toggle-tree-topbar"]', '[data-testid="toggle-tree-floating"]']) {
      if (await vis(page.locator('.tree-row[data-node-id] .tree-main'))) break;
      const b = page.locator(s).first();
      if (await vis(b)) { await act(L, b).catch(() => {}); await page.waitForTimeout(600); }
    }
    const row = page.locator('.tree-row[data-node-id] .tree-main').first();
    if (await vis(row)) await act(L, row);
    await input.waitFor({ state: 'visible', timeout: 10000 });
  }
  await act(L, input);
  await page.keyboard.press('End');
  await page.keyboard.type(text, { delay: 15 });
  await page.keyboard.press('Tab');
  await page.waitForTimeout(800);
}

async function runLayout(L) {
  const opts = { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] };
  let browser;
  try {
    const launchOpts = { ...opts };
    if (SHELL && fs.existsSync(SHELL)) launchOpts.executablePath = SHELL;
    browser = await chromium.launch(launchOpts);
  } catch (err) {
    if (fs.existsSync('/usr/bin/google-chrome')) {
      browser = await chromium.launch({ ...opts, executablePath: '/usr/bin/google-chrome' });
    } else {
      throw err;
    }
  }
  const ctxOpts = { viewport: L.viewport, locale: 'zh-TW', timezoneId: 'Asia/Taipei' };
  if (L.touch) { ctxOpts.hasTouch = true; ctxOpts.isMobile = true; }
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  const A = `【範例】甲稿-${L.name}-${RUN_LABEL}`;
  const B = `【範例】乙稿-${L.name}-${RUN_LABEL}`;
  const SAMPLE = '【範例】霧港紀事';
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="home-screen"]', { timeout: 20000 });

    // 範例書基準
    const okS = await openFromRecent(page, L, SAMPLE);
    const sample0 = okS ? await readStats(page, L) : null;
    rec(L, 'S0', '範例書自己的範例紀錄仍在（基準）', !!sample0 && sample0.achieved === 5 && sample0.activeDays >= 6,
      '範例書已達成 5 次、有寫天數含 10/18～10/28 六天', sample0 ? fmt(sample0) : '進不了範例書統計', sample0 ? null : await shot(page, L, 'S0'));
    await closeToHome(page, L);

    // 甲
    await createDraft(page, L, A);
    const a0 = await readStats(page, L);
    await gotoTab(page, L, 'write');
    await typeInFirstChapter(page, L, '甲稿今天先寫這一句。');
    const a1 = await readStats(page, L);
    rec(L, 'A1', '甲稿寫字後，今天寫了只算甲稿', !!a0 && !!a1 && a0.today === 0 && a1.today > 0 && a1.activeDays === 1 && a1.achieved === 0,
      '建立時 0，寫字後大於 0、有寫天數 1、已達成 0', `建立時 ${a0 ? fmt(a0) : '無'}；寫字後 ${a1 ? fmt(a1) : '無'}`);
    await closeToHome(page, L);

    // 乙
    await createDraft(page, L, B);
    const b0 = await readStats(page, L);
    rec(L, 'B0', '切到乙稿：乙稿仍是自己的 0，沒有帶入甲稿字數', !!b0 && b0.today === 0 && b0.activeDays === 0 && b0.achieved === 0 && b0.hours !== null && Number(b0.hours) === 0,
      '乙稿各項 0', b0 ? fmt(b0) : '讀不到統計', b0 && b0.today === 0 ? null : await shot(page, L, 'B0'));
    await gotoTab(page, L, 'write');
    await typeInFirstChapter(page, L, '乙稿寫比較短。');
    const b1 = await readStats(page, L);
    rec(L, 'B1', '乙稿寫字後，今天寫了只算乙稿', !!b1 && !!a1 && b1.today > 0 && b1.today < a1.today && b1.activeDays === 1 && b1.achieved === 0,
      '乙稿只有自己的字數（乙稿輸入比甲稿短，今天寫了應小於甲稿；有寫天數 1、已達成 0）', `${b1 ? fmt(b1) : '讀不到統計'}；甲稿今天 ${a1?.today}`);
    await closeToHome(page, L);

    // 回甲
    const okA = await openFromRecent(page, L, A);
    const a2 = okA ? await readStats(page, L) : null;
    rec(L, 'A2', '從最近清單開回甲稿：仍是甲稿自己的值', !!a2 && !!a1 && same(a2, a1),
      `與甲稿寫字後相同：${a1 ? fmt(a1) : '無'}`, a2 ? fmt(a2) : '開不回甲稿', a2 && a1 && same(a2, a1) ? null : await shot(page, L, 'A2'));
    await closeToHome(page, L);

    // 回乙
    const okB = await openFromRecent(page, L, B);
    const b2 = okB ? await readStats(page, L) : null;
    rec(L, 'B2', '從最近清單開回乙稿：仍是乙稿自己的值', !!b2 && !!b1 && same(b2, b1),
      `與乙稿寫字後相同：${b1 ? fmt(b1) : '無'}`, b2 ? fmt(b2) : '開不回乙稿', b2 && b1 && same(b2, b1) ? null : await shot(page, L, 'B2'));
    await closeToHome(page, L);

    // 回範例書
    const okS2 = await openFromRecent(page, L, SAMPLE);
    const sample1 = okS2 ? await readStats(page, L) : null;
    rec(L, 'S1', '再看範例書：沒有加上甲乙字數，範例紀錄與結算不變', !!sample1 && !!sample0 && same(sample1, sample0),
      `與基準相同：${sample0 ? fmt(sample0) : '無'}`, sample1 ? fmt(sample1) : '開不回範例書', sample1 && sample0 && same(sample1, sample0) ? null : await shot(page, L, 'S1'));
    const title = (await page.locator('[data-testid="stats-screen"] .stats-book-name').innerText().catch(() => '')).trim();
    rec(L, 'S2', '範例書維持【範例】標示', title === SAMPLE, `統計頁書名「${SAMPLE}」`, `統計頁書名「${title}」`);
    await shot(page, L, '範例書統計-最後');
  } catch (e) {
    rec(L, 'X', '測試程式例外', false, '流程順利', String(e.message).slice(0, 200), await shot(page, L, '例外'));
  }
  await context.close();
  await browser.close();
}

const startedAt = taipeiTime();
for (const L of LAYOUTS) {
  console.log(`\n===== ${L.name} =====`);
  await runLayout(L);
}
const passed = results.filter((r) => r.status === '通過').length;
const failed = results.length - passed;
const esc = (t) => String(t ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
let md = `# WO-69 甲乙兩稿與範例書不串稿（${RUN_LABEL}）\n\n`;
md += `- 臺北執行時間：${startedAt} 開始，${taipeiTime()} 結束\n- 目標 BASE：${BASE}\n`;
md += `- **本次以 Chromium 代測，無 WebKit 證據。**\n`;
md += `- 全程畫面操作（tap／click），不用 force、不用 evaluate、不跳內部網址；只在開始時打開首頁。\n`;
md += `- 總計：${results.length} 項｜通過：${passed}｜失敗：${failed}\n\n`;
md += `| 版面 | 步驟 | 項目 | 結果 | 預期 | 實際 | 截圖 |\n|---|---|---|---|---|---|---|\n`;
for (const r of results) md += `| ${r.layout} | ${r.step} | ${esc(r.item)} | ${r.status} | ${esc(r.expected)} | ${esc(r.actual)} | ${r.screenshot ? `[截圖](../${r.screenshot})` : '-'} |\n`;
fs.writeFileSync(path.join(RUN_DIR, '結果.md'), md, 'utf8');
fs.writeFileSync(path.join(RUN_DIR, '結果.json'), JSON.stringify({ label: RUN_LABEL, base: BASE, startedAt, results }, null, 2), 'utf8');
console.log(`\n總計 ${results.length}｜通過 ${passed}｜失敗 ${failed}`);
process.exit(0);
