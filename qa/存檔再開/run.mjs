/**
 * WO-67：新稿子存檔再開的自動測試
 *
 * 啟動：node qa/存檔再開/run.mjs
 * 環境變數：
 *   BASE        測試網址（預設 http://127.0.0.1:4173；也可設為分支預覽網址）
 *   ENGINE      webkit 時，直拿／橫拿／中等改用 WebKit（寬版固定 Chromium）；預設 chromium（WebKit 未裝妥時以 Chromium 代測）
 *   RUN_LABEL   產物資料夾名稱；未設定時自動取「第N次」（N = 產出目錄裡既有「第N次」資料夾數 + 1）
 *   LAYOUTS     只跑部分版面（逗號分隔 id，除錯用），例如 LAYOUTS=phone-portrait
 *   QA_DIR 或 OUT_DIR  產出資料夾（預設 test-results/qa/存檔再開，已列入 .gitignore）
 *   WO67_DIR    若有設定，正式（第N次）結果會再複製一份到此
 *   PLAYWRIGHT_MODULE、CHROMIUM_PATH  見 qa/README.md
 *
 * WO-68（2026-11-14）：手機橫拿改走目錄抽屜左邊的直排分頁（nav-rail）；寫作頁先按「展開目錄」再點分頁。
 *   原本因橫拿沒有分頁而標「待修後必須通過（WO-68）」的 2b、5、5b、5d、10d、10f、S 不再豁免，走不到即失敗；
 *   橫拿另記 2b-導覽、5d-導覽、10f-導覽（入口可達／可返回）與 6r（另存後用畫面回寫作、重進原章正文仍在），
 *   與 WO-69 的統計資料斷言分開記錄。
 * WO-69（2026-11-14）：原標「待修後必須通過（WO-69）」的 2、2b、5d、7d、10f 全部改為必須通過（不符即失敗）；
 *   7d 逐筆核對下載檔 writing_logs 的全部日期只屬本趟實際經過的臺北日期，且至少有一筆；
 *   新增 2c（建立時統計各項從 0 起算）、5e（另存前統計只算今天、未多出已結算達成）、10i（重開後統計與另存前一致）。
 *
 * 守則：不用 force 點擊、不用 evaluate 改狀態或呼叫內部函式；evaluate 只用於唯讀觀察與瀏覽器能力模擬（見 addInitScript 註解）。
 * 稿子一律由本測試用 App 建立【範例】稿；唯一讀取的稿檔是本趟 Playwright 下載事件取得的那一份。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { loadPlaywright, chromiumPath } from '../playwright-env.mjs';

const { chromium, webkit } = loadPlaywright();
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');

const BASE = (process.env.BASE || 'http://127.0.0.1:4173').replace(/\/$/, '');
const ENGINE = process.env.ENGINE === 'webkit' ? 'webkit' : 'chromium';
const QA_DIR = process.env.QA_DIR || process.env.OUT_DIR || path.join(REPO_ROOT, 'test-results', 'qa', '存檔再開');
const WO67_DIR = process.env.WO67_DIR || '';
const SHELL = chromiumPath();

const LAYOUTS = [
  { id: 'phone-portrait', name: '手機直拿', viewport: { width: 390, height: 844 }, touch: true, wk: true, phone: true },
  { id: 'phone-landscape', name: '手機橫拿', viewport: { width: 844, height: 390 }, touch: true, wk: true, phone: true },
  { id: 'tablet-portrait', name: '中等', viewport: { width: 768, height: 1024 }, touch: true, wk: true, phone: false },
  { id: 'desktop-wide', name: '寬版', viewport: { width: 1280, height: 800 }, touch: false, wk: false, phone: false },
];

fs.mkdirSync(QA_DIR, { recursive: true });
const nextNo = fs.readdirSync(QA_DIR).filter((n) => /^第\d+次$/.test(n)).length + 1;
const SELFTEST = process.env.SELFTEST === '1';
const RUN_LABEL = SELFTEST ? '自我檢查' : (process.env.RUN_LABEL || `第${nextNo}次`);
const RUN_DIR = path.join(QA_DIR, RUN_LABEL);
const OFFICIAL = /^第\d+次$/.test(RUN_LABEL);
fs.mkdirSync(RUN_DIR, { recursive: true });

const taipeiDate = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
const taipeiTime = () => new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────── 結果收集 ─────────
const results = [];
function rec(layout, step, item, status, o = {}) {
  const e = { layout: layout.name, layoutId: layout.id, step, item, status, issue: o.issue || null, expected: o.expected || '', actual: o.actual || '', screenshot: o.screenshot || null, note: o.note || '' };
  results.push(e);
  console.log(`[${layout.name}] ${status}${e.issue ? `(${e.issue})` : ''} ${step} ${item} :: ${e.actual}`.slice(0, 400));
  return e;
}

// 受阻後下游步驟一律用統一代碼（pending／failed），逐項列「尚未執行」與原因
const STEP_NAMES = [
  ['2', '建立時今日字數為 0'], ['2c', '建立時統計各項從 0 起算'], ['3', '進章節並輸入兩段'], ['4', '輸入後的已暫存回饋'], ['5', '走到檔案頁'],
  ['5b', '另存前今日字數增量'], ['5c', '本章字數與今日增量算法'], ['5e', '另存前統計只算今天'], ['6', '另存專案取得 1 個 .db 下載'],
  ['7a', '輸出檔：書名'], ['7b', '輸出檔：章節與正文'], ['7c', '輸出檔：卷章名稱與關聯'], ['7d', '輸出檔：無範例日期'], ['7e', '輸出檔：含今日臺北日期的寫作紀錄'],
  ['8', '重整後回首頁'], ['9', '從「開啟稿子」選回'], ['10a', '重開後：書名'], ['10b', '重開後：卷章'], ['10c', '重開後：兩段正文'],
  ['10d', '重開後：今日字數保留'], ['10e', '上次另存紀錄'], ['10i', '重開後統計與另存前一致'], ['10g', '重開後本章字數'], ['10h', '今日字數三處一致'],
];
function skipSteps(L, doneSet, blockedBy, fatal, shotRel = null) {
  for (const [step, item] of STEP_NAMES) {
    if (doneSet.has(step)) continue;
    const issue = blockedBy?.issue || null;
    rec(L, step, item, issue ? 'pending' : 'failed', {
      issue, expected: '依序完成', actual: `尚未執行（${issue ? `${issue} 阻擋：${blockedBy.reason}` : `前置步驟失敗：${fatal}`}）`, screenshot: shotRel,
    });
  }
}

// ───────── 瀏覽器 ─────────
async function launch(layout) {
  if (ENGINE === 'webkit' && layout.wk) return { browser: await webkit.launch({ headless: true }), engineName: 'WebKit' };
  const opts = { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] };
  if (SHELL && fs.existsSync(SHELL)) return { browser: await chromium.launch({ ...opts, executablePath: SHELL }), engineName: 'Chromium Headless Shell' };
  try {
    return { browser: await chromium.launch(opts), engineName: 'Chromium' };
  } catch (err) {
    if (fs.existsSync('/usr/bin/google-chrome')) {
      return { browser: await chromium.launch({ ...opts, executablePath: '/usr/bin/google-chrome' }), engineName: 'Google Chrome（後備）' };
    }
    throw err;
  }
}

async function newContext(browser, layout, engineName) {
  const opts = { viewport: layout.viewport, locale: 'zh-TW', timezoneId: 'Asia/Taipei', acceptDownloads: true };
  if (layout.touch) { opts.hasTouch = true; opts.isMobile = true; }
  const context = await browser.newContext(opts);
  if (engineName !== 'WebKit') {
    // 瀏覽器能力模擬：移除 Chromium 才有的檔案存取視窗 API，讓 App 走「無系統存檔視窗」路徑（與 iPhone Safari 相同）。
    // 這不是改 App 狀態；系統存檔／選檔視窗因此「未測」。
    await context.addInitScript(() => {
      try { delete window.showSaveFilePicker; delete window.showOpenFilePicker; } catch { /* 略 */ }
    });
  }
  return context;
}

const act = (layout, loc) => (layout.touch ? loc.tap({ timeout: 8000 }) : loc.click({ timeout: 8000 }));
const vis = (loc) => loc.first().isVisible().catch(() => false);

async function shot(page, layout, name) {
  try {
    const dir = path.join(RUN_DIR, layout.id);
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `${name}.png`);
    await page.screenshot({ path: f });
    return path.relative(QA_DIR, f);
  } catch { return null; }
}

// ───────── 共用畫面動作 ─────────
const sel = {
  words: '[data-testid="topbar-words"], [data-testid="focus-bottom-status"], [data-testid="status-bar"]',
  save: '[data-testid="topbar-save"], [data-testid="save-status"], button.save-status',
  input: '[data-testid="writing-input"], textarea.editor-input',
  treeMain: '.tree-row[data-node-id] .tree-main',
};

async function textOf(page, selector) {
  const loc = page.locator(selector);
  const n = await loc.count();
  const parts = [];
  for (let i = 0; i < n; i++) {
    if (await loc.nth(i).isVisible().catch(() => false)) parts.push((await loc.nth(i).innerText().catch(() => '')).replace(/\s+/g, ' ').trim());
  }
  return parts.join(' ｜ ');
}

async function goHome(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="home-screen"]', { timeout: 20000 });
}

async function readTreeRows(page) {
  return page.locator('.tree-row[data-node-id]').evaluateAll((els) =>
    els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => {
      const main = e.querySelector('.tree-main') || e;
      return {
        id: e.dataset.nodeId.replace(/^p-[^-]+-/, '').replace(/^.*?-(?=ch|vol|v)/, ''),
        text: main.innerText.replace(/\s+/g, ' ').trim(),
        indent: Math.round(main.getBoundingClientRect().left - e.getBoundingClientRect().left),
        cls: e.className,
      };
    }));
}

/** 讓目錄露出來（直拿用左上返回目錄，中等／橫拿用目錄按鈕）；不使用 force。 */
async function ensureTree(page, layout) {
  if ((await page.locator('.tree-row[data-node-id]').count()) > 0 && (await vis(page.locator('.tree-row[data-node-id]')))) return true;
  for (const s of ['[data-testid="back-button"]', '[data-testid="toggle-tree-topbar"]', '[data-testid="toggle-tree-floating"]']) {
    const b = page.locator(s).first();
    if (await b.isVisible().catch(() => false)) {
      await act(layout, b).catch(() => {});
      await page.waitForTimeout(600);
      if (await vis(page.locator('.tree-row[data-node-id]'))) return true;
    }
  }
  return vis(page.locator('.tree-row[data-node-id]'));
}

/** 從畫面入口走到某分頁；回傳 ok 與路徑說明。
 *  WO-68：橫拿的分頁在目錄抽屜左邊（nav-rail）；在已進章的寫作頁先按「展開目錄」浮動鈕再點分頁。 */
async function gotoTab(page, layout, tab) {
  const nav = layout.id === 'desktop-wide' || layout.id === 'phone-landscape' ? '[data-testid="nav-rail"]' : '[data-testid="bottom-nav"]';
  const btn = page.locator(`${nav} [data-testid="nav-${tab}"]`).first();
  let via = `${nav} 的「${tab}」分頁`;
  if (layout.id === 'phone-landscape' && !(await btn.isVisible().catch(() => false))) {
    const opener = page.locator('[data-testid="toggle-tree-floating"]').first();
    if (await opener.isVisible().catch(() => false)) {
      await act(layout, opener);
      await page.waitForTimeout(600);
      via = `「展開目錄」→ ${via}`;
    }
  }
  if (await btn.isVisible().catch(() => false)) {
    await act(layout, btn);
    await page.waitForTimeout(700);
    return { ok: page.url().includes(`/${tab}`), via };
  }
  if (tab === 'files') {
    const s = page.locator('button.save-status, [data-testid="save-status"]').first();
    if (await s.isVisible().catch(() => false)) {
      await act(layout, s);
      await page.waitForTimeout(700);
      return { ok: page.url().includes('/files'), via: '編輯頁頂端存檔狀態鈕' };
    }
  }
  return { ok: false, via: '找不到分頁列或替代入口' };
}

// 字數：全形標點算字、連續阿拉伯數字算一字、不含換行與空白（WO-76 定案算法，本測試只記錄差異）
function expectedWordCount(text) {
  const t = text.replace(/\s+/g, '');
  const nums = t.match(/\d+/g) || [];
  return t.replace(/\d+/g, '').length + nums.length;
}
function todayNum(s) {
  const t = String(s || '');
  let m = t.match(/今天寫了\s*([\d,]+)/) || t.match(/([\d,]+)\s*[／\/]\s*[\d,]+/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}
/** 統計串稿跡象：新稿不該有多天紀錄 */
function statsLeak(t) {
  const d = Number((String(t).match(/有寫的天數\s*(\d+)/) || [])[1] || 0);
  const l = Number((String(t).match(/最長連續\s*(\d+)/) || [])[1] || 0);
  return SAMPLE_DATE_RE.test(t) || d > 1 || l > 1;
}
/** WO-69：從統計頁可見文字讀出各項數字（唯讀解析畫面文字）。 */
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
const fmtStats = (p) => `今天 ${p.today}、連續 ${p.streak}、最長連續 ${p.longest}、近七日 ${p.last7}、時數 ${p.hours}、有寫天數 ${p.activeDays}、已達成 ${p.achieved}`;
/** WO-69：本趟這個版面實際經過的臺北日期（起迄之間每一天）。 */
function taipeiDatesBetween(startMs, endMs) {
  const fmt = (ms) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date(ms));
  const out = new Set([fmt(startMs), fmt(endMs)]);
  for (let t = startMs; t < endMs; t += 3600 * 1000) out.add(fmt(t));
  return [...out].sort();
}
function firstNumber(s) { const m = String(s).match(/(\d[\d,]*)/); return m ? Number(m[1].replace(/,/g, '')) : null; }

// ───────── 資料庫唯讀檢查（只開本趟下載的那一份） ─────────
function inspectDb(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  const out = { tables: {}, cells: [], info: [], chapters: [], logs: [] };
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
    const has = (t) => tables.includes(t);
    if (has('project_info')) out.info = db.prepare('SELECT id, title FROM project_info').all().map((r) => ({ ...r }));
    if (has('chapters')) out.chapters = db.prepare('SELECT id, parent_id, name, node_type, content, sort_order FROM chapters ORDER BY sort_order, id').all().map((r) => ({ ...r }));
    if (has('writing_logs')) out.logs = db.prepare('SELECT date, word_count FROM writing_logs ORDER BY date').all().map((r) => ({ ...r }));
    for (const t of tables) {
      const rows = db.prepare(`SELECT * FROM "${t}" LIMIT 2000`).all();
      out.tables[t] = rows.length;
      for (const row of rows) for (const [k, v] of Object.entries(row)) {
        if (typeof v === 'string') out.cells.push({ t, k, v });
        else if (v instanceof Uint8Array) {
          const s = Buffer.from(v).toString('utf8');
          if (/[一-鿿]/.test(s)) out.cells.push({ t, k, v: s });
        }
      }
    }
  } finally { db.close(); }
  return out;
}

const SAMPLE_DATE_RE = /(?:^|[^\d])(?:\d{4}[-\/])?10[-\/月]\s?(?:1[89]|2[0-8])(?!\d)/;

// ───────── 單一版面完整流程 ─────────
async function runLayout(layout) {
  const { browser, engineName } = await launch(layout);
  const context = await newContext(browser, layout, engineName);
  const page = await context.newPage();
  const L = layout;
  const layoutStartMs = Date.now(); // WO-69：本版面起始時間，用來列出允許的臺北日期
  const dir = path.join(RUN_DIR, L.id);
  fs.mkdirSync(dir, { recursive: true });
  const title = `【範例】存檔再開測試-${L.name}-${RUN_LABEL}`;
  const P1 = '港口起霧，燈塔還看得見。';
  const P2 = '她把舊地圖攤在桌上，等潮水退去。';
  const typed = `${P1}\n${P2}`;
  const meta = { layout: L.name, engine: engineName, title, base: BASE, viewport: L.viewport, touch: L.touch };
  const downloads = [];
  page.on('download', (d) => downloads.push(d));
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
  const seenText = {};
  const sizeBtns = {};
  const pendingList = [];  // 下游因前置受阻而尚未執行的項目
  let blockedBy = null;    // {issue, reason}
  let fatal = null;
  // 非通過結果一律補「當下」截圖（已自帶截圖者不重拍）
  const R = async (layout, step, item, status, o = {}) => {
    const e = rec(layout, step, item, status, o);
    if (['pending', 'failed', 'unverified'].includes(status) && !e.screenshot) e.screenshot = await shot(page, layout, `${step}_${MARK[status]}`);
    return e;
  };

  try {
    // ── 1 開新稿子 ──
    await goHome(page);
    seenText.home = await page.locator('body').innerText();
    meta.recentBefore = await page.locator('[data-testid="project-card"]').count();
    for (const [k, loc] of [['開新稿子', page.getByRole('button', { name: '開新稿子' })], ['開啟稿子', page.getByRole('button', { name: '開啟稿子' })]]) {
      const b = await loc.first().boundingBox().catch(() => null);
      sizeBtns[k] = b ? `${Math.round(b.width)}×${Math.round(b.height)}` : '無';
    }
    await act(L, page.getByRole('button', { name: '開新稿子' }).first());
    await page.locator('form.dialog input').first().fill(title);
    await act(L, page.locator('form.dialog button[type="submit"]').first());
    await page.waitForURL(/\/p\/[^/]+\/write/, { timeout: 15000 });
    meta.projectId = page.url().match(/\/p\/([^/]+)/)[1];
    await page.waitForTimeout(800);
    await R(L, '1', '從首頁開新稿子（書名帶【範例】）', 'passed', { expected: '建立後進入寫作頁', actual: `書名「${title}」，網址 ${page.url().replace(BASE, '')}` });

    // 初始卷章結構（目錄）
    await ensureTree(page, L);
    const treeBefore = await readTreeRows(page);
    meta.treeBefore = treeBefore;
    meta.bookTitleShown = await textOf(page, '[data-testid="book-title-button"]');

    // ── 2 建立時的今日字數與統計 ──
    const initWords = await textOf(page, sel.words);
    let initStats = '（未提供：此版面沒有統計分頁入口）';
    let initStatsNote = '';
    const sNav = await gotoTab(page, L, 'stats');
    if (sNav.ok) {
      await page.waitForSelector('[data-testid="stats-screen"]', { timeout: 6000 }).catch(() => {});
      initStats = (await page.locator('[data-testid="stats-screen"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
      seenText.stats = initStats;
      const back = await gotoTab(page, L, 'write');
      if (!back.ok) initStatsNote = '（從統計頁回不到寫作頁）';
      await page.waitForTimeout(500);
      if (L.id === 'phone-landscape') {
        // WO-68：入口可達／可返回與 WO-69 統計資料分開記錄
        await R(L, '2b-導覽', '橫拿：建立後由直排分頁走到統計並返回', back.ok ? 'passed' : 'failed', {
          issue: back.ok ? null : 'WO-68', expected: '直排分頁「統計」進得去、「寫作」回得來', actual: `進統計：${sNav.via}；返回：${back.via}${back.ok ? '，已回寫作（目錄）頁' : `，未回到寫作頁（${page.url().replace(BASE, '')}）`}`,
        });
        const bad2b = statsLeak(initStats);
        await R(L, '2b', '建立時統計與寫作紀錄不串稿', bad2b ? 'failed' : 'passed', {
          issue: bad2b ? 'WO-69' : null, expected: '新稿統計無 10/18～10/28 範例日期、有寫天數與最長連續不超過 1', actual: initStats.slice(0, 220),
          note: 'WO-69 後改為必須通過（原標待修後必須通過）',
        });
      }
    } else if (L.id === 'phone-landscape') {
      await R(L, '2b-導覽', '橫拿：建立後由直排分頁走到統計並返回', 'failed', { issue: 'WO-68', expected: '直排分頁「統計」進得去', actual: `${sNav.via}；網址 ${page.url().replace(BASE, '')}` });
    }
    meta.initWords = initWords;
    meta.initStats = initStats.slice(0, 1500);
    const initWordNum = firstNumber(initWords);
    let initToday = todayNum(initStats) ?? todayNum(initWords);
    let deferInit = false;
    const initStatsBad = statsLeak(initStats);
    meta.initToday = initToday;
    if (sNav.ok || initWords) {
      const bad = (initToday !== null && initToday !== 0) || initStatsBad;
      if (bad) {
        await R(L, '2', '建立時今日字數為 0、統計不串稿', 'failed', { issue: 'WO-69', note: 'WO-69 後改為必須通過（原標待修後必須通過）', expected: '新稿今日字數 0、統計與寫作紀錄不含 10/18～10/28 範例日期', actual: `頂端字數「${initWords}」；統計：${initStats.slice(0, 160)}`, screenshot: await shot(page, L, '建立時字數與統計') });
      } else {
        await R(L, '2', '建立時今日字數為 0、統計不串稿', 'passed', { expected: '今日 0 字、無範例日期', actual: `頂端字數「${initWords || '（此畫面未顯示）'}」；統計：${initStats.slice(0, 120)}${initStatsNote}` });
      }
    } else {
      deferInit = true; // 目錄畫面沒有字數、也走不到統計：改在進入章節後、輸入前觀察
    }
    // 2c（WO-69 新增）：建立時統計各項都從 0 起算（每日與全書目標值不必歸零）
    const initParsed = parseStats(initStats);
    meta.initParsed = initParsed;
    if (sNav.ok) {
      const zeroKeys = ['today', 'streak', 'longest', 'last7', 'activeDays', 'achieved'];
      const allZero = zeroKeys.every((k) => initParsed[k] === 0) && initParsed.hours !== null && Number(initParsed.hours) === 0;
      await R(L, '2c', '建立時統計各項從 0 起算（今日、近七日、有寫天數、連續、最長連續、時數、達成次數）', allZero ? 'passed' : 'failed', {
        issue: allZero ? null : 'WO-69', expected: '今天 0、連續 0、最長連續 0、近七日 0、時數 0.0、有寫天數 0、已達成 0（不可出現 12.0 小時或已達成 5 次）',
        actual: fmtStats(initParsed),
      });
    } else {
      await R(L, '2c', '建立時統計各項從 0 起算', 'failed', { issue: 'WO-69', expected: '可觀察統計頁', actual: `走不到統計頁：${sNav.via}` });
    }

    // ── 3 進章節、輸入兩段 ──
    await ensureTree(page, L);
    const firstRow = page.locator(sel.treeMain).first();
    await act(L, firstRow);
    await page.locator(sel.input).first().waitFor({ state: 'visible', timeout: 10000 });
    const input = page.locator(sel.input).first();
    if (deferInit) {
      const w0 = await textOf(page, sel.words);
      initToday = todayNum(w0);
      meta.initToday = initToday;
      const bad0 = initToday !== null && initToday !== 0;
      await R(L, '2', '建立時今日字數為 0', initToday === null ? 'unverified' : (bad0 ? 'failed' : 'passed'), {
        issue: bad0 ? 'WO-69' : null, expected: '新稿今日字數 0', actual: `進章節後、輸入前頂端字數「${w0}」`,
        note: bad0 ? '今日字數非 0；WO-69 後為必須通過' : '',
      });
      await R(L, '2b', '建立時統計與寫作紀錄不串稿', 'failed', {
        expected: '可觀察統計頁', actual: '走不到統計頁（WO-68 後橫拿已有直排分頁，不再豁免）',
      });
    }
    await act(L, input);
    await page.keyboard.type(P1, { delay: 15 });
    await page.keyboard.press('Enter');
    await page.keyboard.type(P2, { delay: 15 });
    await page.waitForTimeout(400);
    const bodyBaseline = await input.inputValue();
    meta.bodyBaseline = bodyBaseline;
    const parasBase = bodyBaseline.split('\n').filter((s) => s.trim() !== '');
    const okTyped = parasBase.length === 2 && parasBase[0].trim() === P1 && parasBase[1].trim() === P2;
    await R(L, '3', '進入章節並以鍵盤輸入兩段繁體中文', okTyped ? 'passed' : 'failed', {
      expected: `輸入區為兩段：「${P1}」「${P2}」`, actual: `輸入區內容：${JSON.stringify(bodyBaseline)}`,
      screenshot: okTyped ? null : await shot(page, L, '輸入兩段'),
    });
    meta.chapterUrl = page.url().replace(BASE, '');

    // ── 4 離開輸入區（Tab 鍵移開焦點）、等「已暫存」回饋 ──
    // 只認真正代表已暫存的畫面文字：編輯頁「已暫存 HH:MM」，或檔案頁「最後暫存 HH:MM」。
    // 「今天還沒另存」「尚未暫存」不是已暫存回饋，不可判通過。
    await page.keyboard.press('Tab');
    await sleep(1500);
    const readSave = async () => (await page.locator(sel.save).evaluateAll((els) => els.filter((e) => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; }).map((e) => e.textContent.trim()).filter(Boolean).join(' ｜ ')).catch(() => '')); // 唯讀觀察：只讀「可見」文字
    const STORED_RE = /(已暫存|最後暫存)\s*\d{1,2}[:：]\d{2}/;
    let saveText = '';
    for (let i = 0; i < 10; i++) {
      saveText = await readSave();
      if (STORED_RE.test(saveText)) break;
      await sleep(500);
    }
    const chapWords = await page.locator('[data-testid="chapter-word-count"]').first().textContent().catch(() => '');
    const wordsTyped = await textOf(page, sel.words);
    meta.wordsTyped = wordsTyped;
    meta.saveTextBeforeLeave = saveText;
    meta.chapWords = chapWords;
    const editorStored = STORED_RE.test(saveText);
    const rec4 = async (filesText) => {
      const filesStored = STORED_RE.test(filesText || '');
      const ok = editorStored || filesStored;
      await R(L, '4', '輸入後看得到「已暫存」回饋', ok ? 'passed' : 'unverified', {
        expected: '編輯頁出現「已暫存 時:分」，或檔案頁出現「最後暫存 時:分」',
        actual: `編輯頁可見狀態「${saveText || '（無）'}」；檔案頁狀態「${filesText ? filesText.slice(0, 110) : '（尚未進入檔案頁）'}」`,
        note: ok ? '' : '兩處都沒有「已暫存」類文字（編輯頁只有「今天還沒另存」提示、檔案頁寫「還沒存進…App 空間」），無法驗證 App 是否已自動暫存；依規不判通過，待產品提供可見暫存回饋',
      });
    };

    // 另存前的今日字數／統計（在離開寫作頁前，先看頂端字數；有分頁列時再看統計頁）
    const expWords = expectedWordCount(typed);
    const typedNum = firstNumber(wordsTyped);
    meta.expWords = expWords;

    // ── 5 走到檔案頁 ──
    const sNav2 = await gotoTab(page, L, 'stats');
    let preStats = '（未提供：此版面沒有統計分頁入口）';
    if (sNav2.ok) {
      await page.waitForSelector('[data-testid="stats-screen"]', { timeout: 6000 }).catch(() => {});
      preStats = (await page.locator('[data-testid="stats-screen"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    }
    meta.preStats = preStats.slice(0, 1500);
    const fNav = await gotoTab(page, L, 'files');
    if (!fNav.ok) {
      blockedBy = null; // WO-68 後橫拿已有直排分頁，走不到檔案頁一律失敗
      fatal = '走不到檔案頁';
      await rec4('');
      await R(L, '5', '從畫面走到檔案頁', blockedBy ? 'pending' : 'failed', { issue: blockedBy?.issue, expected: '點分頁或入口進檔案頁', actual: `${fNav.via}；網址 ${page.url().replace(BASE, '')}`, screenshot: await shot(page, L, '走不到檔案頁') });
      throw new Error('blocked');
    }
    await page.waitForSelector('[data-testid="files-screen"]', { timeout: 8000 });
    const filesText = (await page.locator('[data-testid="files-status"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    seenText.files = await page.locator('[data-testid="files-screen"]').innerText();
    meta.filesStatusBefore = filesText;
    await rec4(filesText);
    for (const [k, tid] of [['開啟別的稿子', 'open-other-file'], ['關閉稿子並回首頁', 'close-project']]) {
      const b = await page.locator(`[data-testid="${tid}"]`).first().boundingBox().catch(() => null);
      sizeBtns[k] = b ? `${Math.round(b.width)}×${Math.round(b.height)}` : '無';
    }
    await R(L, '5', '從畫面走到檔案頁', 'passed', { expected: '進入檔案頁', actual: `由${fNav.via}進入；檔案狀態：${filesText.slice(0, 160)}` });

    // 統計對照（另存前）
    const typedToday = todayNum(preStats) ?? todayNum(wordsTyped);
    meta.typedToday = typedToday;
    if (typedToday !== null && initToday !== null && initToday !== undefined) {
      const delta = typedToday - initToday;
      await R(L, '5b', '另存前：今日字數增量等於輸入字數（含全形標點）', delta === expWords ? 'passed' : 'failed', {
        issue: delta === expWords ? null : 'WO-76', expected: `增量 ${expWords}（建立時 ${initToday}，依定案算法自算）`, actual: `另存前今日 ${typedToday}，增量 ${delta}`,
        note: delta === expWords ? '' : '正文已保存（見 7b／10c）；字數差異屬已知 WO-76，不代修',
      });
    } else {
      await R(L, '5b', '另存前：今日字數增量等於輸入字數（含全形標點）', 'failed', { expected: '可對照字數', actual: `無法取得數字（建立時 ${initToday}、另存前 ${typedToday}）` });
    }
    const chapNum = firstNumber(chapWords);
    if (chapNum !== null) {
      await R(L, '5c', '本章字數與今日增量算法一致', chapNum === expWords ? 'passed' : 'failed', { issue: chapNum === expWords ? null : 'WO-76', expected: `本章字數 ${expWords}`, actual: `畫面「${chapWords}」`, note: chapNum === expWords ? '' : '本章字數不含全形標點、今日字數含，屬已知 WO-76（各處字數算法不一致）' });
    }
    const leakPre = statsLeak(preStats);
    if (L.id === 'phone-landscape') {
      await R(L, '5d-導覽', '橫拿：輸入後由「展開目錄」直排分頁走到統計，再走到檔案', sNav2.ok && fNav.ok ? 'passed' : 'failed', {
        issue: sNav2.ok && fNav.ok ? null : 'WO-68', expected: '寫作頁→展開目錄→統計→檔案', actual: `統計：${sNav2.via}（${sNav2.ok ? '進得去' : '進不去'}）；檔案：${fNav.via}（${fNav.ok ? '進得去' : '進不去'}）`,
      });
    }
    if (!sNav2.ok) {
      await R(L, '5d', '另存前：寫作紀錄不串稿', 'failed', { expected: '可觀察統計頁', actual: '找不到統計入口' });
    } else {
      await R(L, '5d', '另存前：寫作紀錄不串稿', leakPre ? 'failed' : 'passed', { issue: leakPre ? 'WO-69' : null, expected: '新稿紀錄只有今天', actual: preStats.slice(0, 220), note: 'WO-69 後改為必須通過（原標待修後必須通過）' });
    }
    // 5e（WO-69 新增）：另存前統計只算今天，當天暫時達標也不多出已結算達成
    const preParsed = parseStats(preStats);
    meta.preParsed = preParsed;
    if (sNav2.ok) {
      const ok5e = preParsed.today > 0 && preParsed.activeDays === 1 && preParsed.streak === 1 && preParsed.longest === 1
        && preParsed.last7 === preParsed.today && preParsed.achieved === 0;
      await R(L, '5e', '另存前：統計只算今天（有寫天數 1、連續 1、近七日＝今天、已達成 0）', ok5e ? 'passed' : 'failed', {
        issue: ok5e ? null : 'WO-69', expected: '有寫天數 1、連續 1、最長連續 1、近七日＝今天字數、已達成 0（今天尚未結算）', actual: fmtStats(preParsed),
      });
    } else {
      await R(L, '5e', '另存前：統計只算今天', 'failed', { issue: 'WO-69', expected: '可觀察統計頁', actual: '找不到統計入口' });
    }

    // ── 6 另存專案（下載） ──
    const nBefore = downloads.length;
    const saveAs = page.locator('[data-testid="save-as-project"]').first();
    const sb = await saveAs.boundingBox().catch(() => null);
    sizeBtns['另存專案'] = sb ? `${Math.round(sb.width)}×${Math.round(sb.height)}` : '無';
    const dlWait = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
    await act(L, saveAs);
    const dl = await dlWait;
    await sleep(2500);
    const newDls = downloads.slice(nBefore);
    if (!dl) {
      await R(L, '6', '另存專案取得 1 個 .db 下載', 'failed', { expected: '觸發 1 次 .db 下載', actual: '沒有觀察到下載事件', screenshot: await shot(page, L, '另存無下載') });
      fatal = '另存沒有下載';
      throw new Error('blocked');
    }
    const suggested = dl.suggestedFilename();
    const outFile = path.join(dir, `本趟下載-${suggested.replace(/[\\/:*?"<>|]/g, '_')}`);
    const tmpPath = await dl.path().catch(() => null);
    await dl.saveAs(outFile);
    meta.downloadTmpPath = tmpPath;
    meta.outFile = outFile;
    meta.downloadNames = newDls.map((d) => d.suggestedFilename());
    const onlyOneDb = newDls.length === 1 && /\.db$/i.test(suggested);
    await R(L, '6', '另存專案取得 1 個 .db 下載', onlyOneDb ? 'passed' : 'failed', {
      expected: '只下載 1 個 .db，無文字檔或其他附件', actual: `本次下載事件 ${newDls.length} 個：${meta.downloadNames.join('、')}；已存為 ${path.relative(QA_DIR, outFile)}（大小 ${fs.statSync(outFile).size} 位元組）`,
      screenshot: onlyOneDb ? null : await shot(page, L, '下載數量不符'),
    });
    meta.filesStatusAfterSave = (await page.locator('[data-testid="files-status"]').innerText().catch(() => '')).replace(/\s+/g, ' ');

    // ── 7 讀輸出檔 ──
    let dbInfo = null;
    try { dbInfo = inspectDb(outFile); } catch (e) { await R(L, '7', '輸出檔可唯讀開啟', 'failed', { expected: '能以唯讀開啟 .db', actual: String(e).slice(0, 200) }); }
    let dbToday = null;
    if (dbInfo) {
      meta.dbTables = dbInfo.tables;
      meta.dbChapters = dbInfo.chapters.map((c) => ({ id: c.id, parent_id: c.parent_id, name: c.name, node_type: c.node_type, sort_order: c.sort_order, contentLen: (c.content || '').length }));
      meta.dbLogs = dbInfo.logs;
      const cells = dbInfo.cells;
      // 7a 書名：專案資料表的書名必須與建立時完全相同
      const dbTitle = dbInfo.info[0]?.title;
      await R(L, '7a', '輸出檔：書名（project_info.title 完全相等）', dbTitle === title ? 'passed' : 'failed', { expected: `「${title}」`, actual: `project_info.title =「${dbTitle ?? '（無此表或無資料）'}」` });
      // 7b 章節與正文：章節 id 為本稿 id 後綴，正文與輸入後的輸入區內容完全相等
      const chapId = `${meta.projectId}-ch`;
      const chRow = dbInfo.chapters.find((c) => c.id === chapId) || dbInfo.chapters.find((c) => (c.content || '') === bodyBaseline);
      const bodyEq = !!chRow && chRow.content === bodyBaseline;
      await R(L, '7b', '輸出檔：章節正文（chapters.content 與輸入完全相等）', bodyEq ? 'passed' : 'failed', {
        expected: `章節 ${chapId} 的 content 等於 ${JSON.stringify(bodyBaseline)}`, actual: chRow ? `章節 ${chRow.id} 的 content = ${JSON.stringify(chRow.content)}` : `找不到章節；現有 ${JSON.stringify(dbInfo.chapters.map((c) => c.id))}`,
      });
      // 7c 卷章名稱、順序、層級與關聯：筆數與畫面目錄相同、名稱相符、父子關聯有效、node_type 為章節、last_opened 指向該章
      const ids = new Set(dbInfo.chapters.map((c) => c.id));
      const parentsOk = dbInfo.chapters.every((c) => c.parent_id == null || ids.has(c.parent_id));
      const nameOk = treeBefore.length === dbInfo.chapters.length && treeBefore.every((r, i) => {
        const c = dbInfo.chapters[i];
        return c && r.text.startsWith((c.name || '').trim());
      });
      const rootOk = dbInfo.chapters.every((c) => c.parent_id == null); // 新稿只有章，皆在最上層（畫面縮排相同）
      const kinds = [...new Set(dbInfo.chapters.map((c) => c.node_type))];
      await R(L, '7c', '輸出檔：卷章名稱、順序、層級與關聯', nameOk && parentsOk && rootOk ? 'passed' : 'failed', {
        expected: `筆數同畫面目錄 ${treeBefore.length}、名稱依序相符 ${JSON.stringify(treeBefore.map((r) => r.text))}、parent_id 全為最上層或指向存在的節點`,
        actual: `chapters = ${JSON.stringify(dbInfo.chapters.map((c) => ({ id: c.id, parent_id: c.parent_id, name: c.name, node_type: c.node_type, sort: c.sort_order })))}`,
        note: `node_type：${kinds.join('、')}；畫面未提供「卷」層級`,
      });
      const dateHits = [...new Set(cells.filter((c) => SAMPLE_DATE_RE.test(c.v)).map((c) => `${c.t}.${c.k}:${c.v.slice(0, 40)}`))];
      const dateLike = [...new Set(cells.flatMap((c) => c.v.match(/\d{4}-\d{2}-\d{2}/g) || []))].sort();
      meta.dbDates = dateLike;
      // WO-69：除排除範例日期外，writing_logs 的全部日期逐筆核對只屬本趟實際經過的臺北日期，且不可是空表
      const allowed = taipeiDatesBetween(layoutStartMs, Date.now());
      const logDates = dbInfo.logs.map((l) => l.date);
      const foreign = logDates.filter((d) => !allowed.includes(d));
      meta.logDates = logDates; meta.allowedDates = allowed;
      const ok7d = dateHits.length === 0 && foreign.length === 0 && logDates.length > 0;
      await R(L, '7d', '輸出檔：無 10/18～10/28 範例日期，writing_logs 全部日期只屬本趟臺北日期', ok7d ? 'passed' : 'failed', {
        issue: ok7d ? null : 'WO-69',
        expected: `不含 10/18～10/28；writing_logs 至少 1 筆，且每筆日期都在允許集合 {${allowed.join('、')}}（本版面 ${new Date(layoutStartMs).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })} 起至檢查當下）`,
        actual: `writing_logs 共 ${logDates.length} 筆，實際日期集合 {${[...new Set(logDates)].sort().join('、') || '（空）'}}；不在允許集合的日期：${foreign.length ? foreign.join('、') : '無'}；範例日期命中：${dateHits.length ? dateHits.slice(0, 5).join('；') : '無'}；全檔日期樣字串：${dateLike.join('、') || '（無）'}`,
        note: 'WO-69 後改為必須通過（原標待修後必須通過）',
      });
      // 7e 寫作紀錄：含「實際臺北日期」那一天，且當天字數與另存前一致
      const today = taipeiDate();
      const logRow = dbInfo.logs.find((l) => l.date === today);
      dbToday = logRow ? logRow.word_count : null;
      meta.taipeiToday = today;
      const consistent = logRow && typedToday !== null && logRow.word_count === typedToday;
      await R(L, '7e', '輸出檔：寫作紀錄含今日臺北日期，且當日字數與另存前一致', consistent ? 'passed' : 'failed', {
        issue: consistent ? null : (logRow ? 'WO-76' : null), expected: `writing_logs 有 ${today}，word_count = 另存前今日字數 ${typedToday}`,
        actual: logRow ? `writing_logs ${today} word_count = ${logRow.word_count}` : `找不到 ${today}；現有日期 ${JSON.stringify(dbInfo.logs.map((l) => l.date))}`,
        note: logRow && !consistent ? '字數不一致，屬字數算法差異（WO-76），不代修' : '',
      });
    }

    // ── 6r（WO-68，僅橫拿）另存後用畫面返回寫作、重新進入原章，正文逐字仍在；再由分頁回檔案頁接續第 8 步 ──
    if (L.id === 'phone-landscape') {
      const back6 = await gotoTab(page, L, 'write');
      let body6 = null;
      if (back6.ok) {
        await page.waitForTimeout(400);
        if (await vis(page.locator(sel.treeMain))) {
          await act(L, page.locator(sel.treeMain).first());
          await page.locator(sel.input).first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
        }
        if (await vis(page.locator(sel.input))) body6 = await page.locator(sel.input).first().inputValue();
      }
      const ok6 = back6.ok && body6 === bodyBaseline;
      await R(L, '6r', '橫拿：另存後由直排分頁回寫作、重進原章正文逐字仍在', ok6 ? 'passed' : 'failed', {
        issue: ok6 ? null : 'WO-68', expected: `檔案頁→分頁「寫作」→點原章，正文 ${JSON.stringify(bodyBaseline)}`,
        actual: `返回：${back6.via}（${back6.ok ? '回到寫作' : '回不來'}）；重進原章正文 ${body6 === null ? '（讀不到輸入區）' : JSON.stringify(body6)}`,
      });
      const toFiles6 = await gotoTab(page, L, 'files');
      if (toFiles6.ok) await page.waitForSelector('[data-testid="files-screen"]', { timeout: 8000 }).catch(() => {});
      meta.landscapeBackToFiles = `${toFiles6.via}：${toFiles6.ok ? '回到檔案頁' : '未回到檔案頁'}`;
    }

    // ── 8 重新整理、關閉稿子回首頁 ──
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="files-screen"], [data-testid="home-screen"], [data-testid="write-screen"]', { timeout: 20000 }).catch(() => {});
    meta.afterReloadUrl = page.url().replace(BASE, '');
    const afterReloadFiles = (await page.locator('[data-testid="files-status"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    meta.filesStatusAfterReload = afterReloadFiles;
    const closeBtn = page.locator('[data-testid="close-project"]').first();
    let closed = false;
    if (await closeBtn.isVisible().catch(() => false)) {
      await act(L, closeBtn);
      await page.waitForSelector('[data-testid="home-screen"]', { timeout: 10000 }).then(() => { closed = true; }).catch(() => {});
    } else if (await vis(page.locator('[data-testid="home-screen"]'))) closed = true;
    await R(L, '8', '重新整理頁面後，循畫面關閉稿子回首頁', closed ? 'passed' : 'failed', { expected: '採「重新整理」；重整後仍在檔案頁，可點關閉稿子回首頁', actual: `重整後網址 ${meta.afterReloadUrl}；${closed ? '已回首頁' : '回不了首頁'}`, screenshot: closed ? null : await shot(page, L, '重整後回不了首頁') });
    if (!closed) { fatal = '重整後回不了首頁'; throw new Error('blocked'); }
    meta.recentAfterClose = await page.locator('[data-testid="project-card"]').count();

    // ── 9 從「開啟稿子」選回同一份檔案 ──
    const openBtn = page.getByRole('button', { name: '開啟稿子' }).first();
    const chooserWait = page.waitForEvent('filechooser', { timeout: 10000 }).catch(() => null);
    await act(L, openBtn);
    const chooser = await chooserWait;
    if (!chooser) {
      await R(L, '9', '從「開啟稿子」選回本趟下載的檔案', 'failed', { expected: '出現選檔器並選回', actual: '沒有出現檔案選擇器', screenshot: await shot(page, L, '無選檔器') });
      fatal = '無選檔器';
      throw new Error('blocked');
    }
    await chooser.setFiles(outFile);
    await page.waitForURL(/\/p\/[^/]+\/write/, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const reopenedId = (page.url().match(/\/p\/([^/]+)/) || [])[1] || '';
    meta.reopenedId = reopenedId;
    meta.reopenUrl = page.url().replace(BASE, '');
    await R(L, '9', '從「開啟稿子」選回本趟下載的檔案', reopenedId ? 'passed' : 'failed', {
      expected: '選回同一份檔案並進入寫作頁', actual: `選檔：${path.relative(QA_DIR, outFile)}；網址 ${meta.reopenUrl}；稿子代號${reopenedId === meta.projectId ? '與原稿相同（無法由代號區分來源）' : '與原稿不同（確為由檔案匯入的新稿）'}`,
      screenshot: reopenedId ? null : await shot(page, L, '選檔後未進寫作'),
    });
    if (!reopenedId) { fatal = '選檔後未進寫作'; throw new Error('blocked'); }

    // ── 10 重開後核對 ──
    await page.waitForTimeout(500);
    await ensureTree(page, L);
    const bookTitle2 = await textOf(page, '[data-testid="book-title-button"]');
    const treeAfter = await readTreeRows(page);
    meta.treeAfter = treeAfter;
    meta.bookTitleAfter = bookTitle2;
    await R(L, '10a', '重開後：書名', bookTitle2.includes(title) ? 'passed' : 'failed', { expected: `畫面書名含「${title}」`, actual: `畫面書名「${bookTitle2}」`, screenshot: bookTitle2.includes(title) ? null : await shot(page, L, '重開書名不符') });
    const cmpKey = (r) => `${r.text}|${r.indent}`;
    const sameTree = treeBefore.length === treeAfter.length && treeBefore.every((r, i) => cmpKey(r) === cmpKey(treeAfter[i]));
    const namesSame = treeBefore.map((r) => r.text).join('／') === treeAfter.map((r) => r.text).join('／');
    await R(L, '10b', '重開後：卷章名稱、順序與層級', sameTree ? 'passed' : 'failed', {
      expected: `與建立時一致：${JSON.stringify(treeBefore.map((r) => `${r.text}(縮排${r.indent})`))}`, actual: JSON.stringify(treeAfter.map((r) => `${r.text}(縮排${r.indent})`)),
      note: `本版面畫面${treeBefore.some((r) => /卷|幕/.test(r.text)) ? '有' : '未提供「卷」層級（新稿只有章），不臆造卷'}`,
      screenshot: sameTree ? null : await shot(page, L, '重開目錄不符'),
    });
    if (!sameTree && namesSame) meta.treeNote = '名稱與順序相同，僅縮排量測不同';

    // 開章讀正文
    let body2 = null;
    if (!(await vis(page.locator(sel.input)))) {
      await act(L, page.locator(sel.treeMain).first()).catch(() => {});
      await page.locator(sel.input).first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    }
    if (await vis(page.locator(sel.input))) body2 = await page.locator(sel.input).first().inputValue();
    const bodyOk2 = body2 !== null && body2 === bodyBaseline;
    const paras2 = (body2 || '').split('\n').filter((s) => s.trim() !== '');
    await R(L, '10c', '重開後：兩段正文逐字與段落', bodyOk2 ? 'passed' : 'failed', {
      expected: `與輸入後一致：${JSON.stringify(bodyBaseline)}`, actual: body2 === null ? '進不了章節輸入區' : JSON.stringify(body2),
      note: bodyOk2 ? '' : `兩段分別${paras2[0]?.trim() === P1 ? '第一段保留' : '第一段不符'}、${paras2[1]?.trim() === P2 ? '第二段保留' : '第二段不符'}`,
      screenshot: bodyOk2 ? null : await shot(page, L, '重開正文不符'),
    });

    const chapWords2 = await page.locator('[data-testid="chapter-word-count"]').first().textContent().catch(() => '');
    const chapNum2 = firstNumber(chapWords2);
    const chapNumBefore = firstNumber(chapWords);
    if (chapNum2 !== null && chapNumBefore !== null) {
      await R(L, '10g', '重開後：本章字數與另存前一致', chapNum2 === chapNumBefore ? 'passed' : 'failed', {
        issue: chapNum2 === chapNumBefore ? null : 'WO-76', expected: `另存前「${chapWords}」`, actual: `重開後「${chapWords2}」`,
        note: chapNum2 === chapNumBefore ? '' : '正文逐字相同（見 10c），僅字數算法不同（開檔後不計全形標點）；屬已知 WO-76，與正文結果分開記錄',
        screenshot: chapNum2 === chapNumBefore ? null : await shot(page, L, '重開本章字數不同'),
      });
    }

    // 重開後今日字數／紀錄
    const words2 = await textOf(page, sel.words);
    let stats2 = '（未提供：此版面沒有統計分頁入口）';
    const sNav3 = await gotoTab(page, L, 'stats');
    if (sNav3.ok) {
      await page.waitForSelector('[data-testid="stats-screen"]', { timeout: 6000 }).catch(() => {});
      stats2 = (await page.locator('[data-testid="stats-screen"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    }
    const files2 = await gotoTab(page, L, 'files');
    let filesText2 = '';
    if (files2.ok) filesText2 = (await page.locator('[data-testid="files-status"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    meta.wordsAfter = words2; meta.statsAfter = stats2.slice(0, 1500); meta.filesStatusAfterReopen = filesText2;
    const num2 = todayNum(stats2) ?? todayNum(words2);
    const leak2 = statsLeak(stats2);
    const kept = num2 !== null && num2 === typedToday;
    if (num2 === null) {
      await R(L, '10d', '重開後：今日字數保留（與另存前對照）', 'failed', { expected: `另存前今日 ${typedToday}`, actual: `重開後取不到數字：頂端「${words2}」；統計入口：${sNav3.ok ? '有' : '無'}` });
    } else {
      await R(L, '10d', '重開後：今日字數保留（與另存前對照）', kept ? 'passed' : 'failed', {
        issue: kept ? null : 'WO-77', expected: `另存前今日 ${typedToday}`, actual: `重開後今日 ${num2}（頂端「${words2.slice(0, 60)}」）`,
        note: kept ? '正文結果見 10c，與字數分開記錄' : '與已知 WO-77（重整／重開後今日字數可能不見）相符；仍記失敗、不套用豁免；正文結果見 10c',
      });
    }
    if (L.id === 'phone-landscape') {
      const back10 = files2.ok ? await gotoTab(page, L, 'write') : { ok: false, via: '未進檔案頁' };
      const ok10 = sNav3.ok && files2.ok && back10.ok;
      await R(L, '10f-導覽', '橫拿：重開後由「展開目錄」直排分頁走到統計、檔案並返回寫作', ok10 ? 'passed' : 'failed', {
        issue: ok10 ? null : 'WO-68', expected: '寫作頁→展開目錄→統計→檔案→寫作',
        actual: `統計：${sNav3.via}（${sNav3.ok ? '進得去' : '進不去'}）；檔案：${files2.via}（${files2.ok ? '進得去' : '進不去'}）；返回：${back10.via}（${back10.ok ? '回到寫作' : '回不來'}）`,
      });
    }
    if (!sNav3.ok) await R(L, '10f', '重開後：寫作紀錄不串稿', 'failed', { expected: '可觀察統計頁', actual: '找不到統計入口' });
    else await R(L, '10f', '重開後：寫作紀錄不串稿', leak2 ? 'failed' : 'passed', { issue: leak2 ? 'WO-69' : null, expected: '紀錄只有今天', actual: stats2.slice(0, 220), note: 'WO-69 後改為必須通過（原標待修後必須通過）' });
    // 10i（WO-69 新增）：重開後達成次數、連續天數、最長連續、有寫天數、時數與另存前一致（今日字數另見 10d／10h）
    const afterParsed = parseStats(stats2);
    meta.afterParsed = afterParsed;
    if (sNav3.ok && sNav2.ok) {
      const keys = ['achieved', 'streak', 'longest', 'activeDays', 'hours'];
      const diff = keys.filter((k) => afterParsed[k] === null || String(afterParsed[k]) !== String(preParsed[k]));
      await R(L, '10i', '重開後：達成次數、連續天數、最長連續、有寫天數、時數與另存前一致', diff.length ? 'failed' : 'passed', {
        issue: diff.length ? 'WO-69' : null, expected: `另存前：${fmtStats(preParsed)}`, actual: `重開後：${fmtStats(afterParsed)}${diff.length ? `；不一致：${diff.join('、')}` : ''}`,
        note: '今日字數與近七日受字數算法影響，分別由 10d、10h 記錄（WO-76／WO-77），不在本項比較',
      });
    } else {
      await R(L, '10i', '重開後：統計與另存前一致', 'failed', { issue: 'WO-69', expected: '可觀察統計頁', actual: `另存前統計入口 ${sNav2.ok ? '有' : '無'}、重開後 ${sNav3.ok ? '有' : '無'}` });
    }
    // 10h 今日字數在另存前、下載檔內、重開後三處一致
    {
      const trio = [typedToday, dbToday, num2];
      const allKnown = trio.every((v) => v !== null && v !== undefined);
      const same = allKnown && trio.every((v) => v === trio[0]);
      let st10h = same ? 'passed' : 'failed';
      let issue10h = null;
      if (!same) issue10h = (allKnown && num2 < dbToday) || num2 === null ? 'WO-77' : 'WO-76';
      await R(L, '10h', '今日字數三處一致：另存前＝下載檔寫作紀錄＝重開後', st10h, {
        issue: issue10h, expected: '三者相同', actual: `另存前 ${typedToday}／下載檔 ${taipeiDate()} 的 word_count ${dbToday}／重開後 ${num2}`,
        note: same ? '' : '不一致照實列失敗；算法差異屬 WO-76，重開後遺失屬 WO-77，不代修',
      });
    }
    const ach = (t) => (String(t).match(/已達成\s*(\d+)\s*次/) || [])[1];
    meta.statsCompare = { 建立時: initStats.slice(0, 300), 另存前: preStats.slice(0, 300), 重開後: stats2.slice(0, 300), 達成次數: [ach(initStats), ach(preStats), ach(stats2)] };
    const lastSave = (t) => ((String(t).match(/上次另存：([^｜]*?)(?:\s*$|\s+上次|\s+目前)/) || String(t).match(/上次另存：(\S+(?:\s\S+)?)/) || [])[1] || '').trim();
    const lsAfterSave = lastSave(meta.filesStatusAfterSave);
    const lsReload = lastSave(afterReloadFiles);
    const lsReopen = lastSave(filesText2);
    const lostOnReload = /今天|\d/.test(lsAfterSave) && /還沒/.test(lsReload);
    await R(L, '10e', '上次另存紀錄：重新整理後仍在', lostOnReload ? 'failed' : 'passed', {
      issue: lostOnReload ? 'WO-77' : null, expected: '另存後「上次另存」顯示今天時間，重新整理後仍保留',
      actual: `另存前「${lastSave(meta.filesStatusBefore)}」→ 另存後「${lsAfterSave}」→ 重新整理後「${lsReload}」→ 選回檔案後「${lsReopen}」`,
      note: lostOnReload ? '與已知 WO-77 相符，仍記失敗；選回檔案成為新開稿子，其另存紀錄是否沿用另列觀察（見實際欄）' : '',
    });
    seenText.filesAfter = files2.ok ? await page.locator('[data-testid="files-screen"]').innerText().catch(() => '') : '';
  } catch (err) {
    if (err.message !== 'blocked') {
      fatal = `例外：${String(err.message).slice(0, 200)}`;
      await R(L, 'X', '測試程式例外（已隔離）', 'failed', { expected: '流程順利', actual: fatal, screenshot: await shot(page, L, '例外') });
    }
    const done = new Set(results.filter((r) => r.layoutId === L.id).map((r) => r.step));
    const blockShot = await shot(page, L, '受阻當下');
    skipSteps(L, done, blockedBy, fatal, blockShot);
  }

  // 按鈕與用字檢查（以前面看過的畫面文字）
  try {
    const joined = Object.values(seenText).join('\n');
    const bad = ['場景', '您'].filter((w) => joined.includes(w));
    if (L.phone && /AI\s*對話/.test(joined)) bad.push('AI 對話紀錄（手機不應顯示）');
    await R(L, '11', '用字檢查（無「場景」「您」，手機無 AI 對話紀錄）', bad.length ? 'failed' : 'passed', { expected: '不出現', actual: bad.length ? `出現：${bad.join('、')}` : '首頁／統計／檔案頁未出現' });
  } catch { /* 略 */ }
  try {
    meta.buttonSizes = sizeBtns;
    const parse = (v) => { const m = String(v).match(/^(\d+)×(\d+)$/); return m ? [Number(m[1]), Number(m[2])] : null; };
    const small = Object.entries(sizeBtns).filter(([, v]) => { const d = parse(v); return d && (d[0] < 44 || d[1] < 44); });
    const notMeasured = ['開新稿子', '開啟稿子', '另存專案', '開啟別的稿子', '關閉稿子並回首頁'].filter((k) => !parse(sizeBtns[k]));
    await R(L, '12', '主要按鈕至少 44×44', small.length ? 'failed' : (notMeasured.length ? 'unverified' : 'passed'), {
      expected: '開新稿子、開啟稿子、另存專案、開啟別的稿子、關閉稿子並回首頁皆 ≥44×44',
      actual: `量測：${JSON.stringify(sizeBtns)}`, note: notMeasured.length ? `未量到：${notMeasured.join('、')}（流程提前結束）；其餘按鈕（目錄、資料集等）本張未測` : '其餘按鈕本張未測',
    });
  } catch { /* 略 */ }
  meta.pageErrors = pageErrors;
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  await context.close();
  await browser.close();
  return meta;
}

// ───────── 手機分享負載觀察（瀏覽器介面邊界） ─────────
async function runShareProbe(layout) {
  const { browser, engineName } = await launch(layout);
  const context = await newContext(browser, layout, engineName);
  // 在瀏覽器介面邊界攔截系統分享：只記錄 App 實際送出的負載，不代叫 App 內部函式。
  await context.addInitScript(() => {
    window.__shareLog = [];
    navigator.canShare = (d) => !!(d && d.files && d.files.length);
    navigator.share = async (d) => {
      window.__shareLog.push({
        keys: Object.keys(d || {}),
        files: (d.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size })),
        title: d.title ?? null, text: d.text ?? null, url: d.url ?? null,
      });
    };
  });
  const page = await context.newPage();
  const L = layout;
  const dls = [];
  page.on('download', (d) => dls.push(d.suggestedFilename()));
  try {
    await goHome(page);
    await act(L, page.getByRole('button', { name: '開新稿子' }).first());
    await page.locator('form.dialog input').first().fill(`【範例】分享觀察-${L.name}-${RUN_LABEL}`);
    await act(L, page.locator('form.dialog button[type="submit"]').first());
    await page.waitForURL(/\/p\/[^/]+\/write/, { timeout: 15000 });
    await ensureTree(page, L);
    await act(L, page.locator(sel.treeMain).first());
    await page.locator(sel.input).first().waitFor({ state: 'visible', timeout: 10000 });
    await act(L, page.locator(sel.input).first());
    await page.keyboard.type('分享觀察用的一小段。', { delay: 15 });
    await page.waitForTimeout(1200);
    const f = await gotoTab(page, L, 'files');
    if (!f.ok) {
      const blocked = false; // WO-68 後橫拿已有直排分頁，走不到檔案頁一律失敗
      rec(L, 'S', '手機分享：只帶 1 個 .db', blocked ? 'pending' : 'failed', { issue: blocked ? 'WO-68' : null, expected: '走到檔案頁並觸發分享', actual: '走不到檔案頁，分享尚未執行', screenshot: await shot(page, L, '分享觀察走不到檔案頁') });
    } else {
      await page.waitForSelector('[data-testid="save-as-project"]', { timeout: 8000 });
      await act(L, page.locator('[data-testid="save-as-project"]').first());
      await sleep(2500);
      const log = await page.evaluate(() => window.__shareLog); // 唯讀讀取攔截紀錄
      const one = log.length === 1 && log[0].files.length === 1 && /\.db$/i.test(log[0].files[0].name) && !log[0].title && !log[0].text && !log[0].url && JSON.stringify(log[0].keys) === '["files"]';
      rec(L, 'S', '手機分享：只帶 1 個 .db、無標題／文字／網址', one ? 'passed' : (log.length === 0 ? 'failed' : 'failed'), {
        expected: '分享請求 1 次、files 恰 1 個 .db、無 title／text／url', actual: `攔截到 ${log.length} 次；內容 ${JSON.stringify(log)}；同時下載事件 ${dls.length} 個`,
        note: '只驗證 App 送出的分享負載；iOS 真實分享面板未測', screenshot: one ? null : await shot(page, L, '分享負載不符'),
      });
    }
  } catch (e) {
    rec(L, 'S', '手機分享：只帶 1 個 .db', 'failed', { expected: '完成分享觀察', actual: `例外：${String(e.message).slice(0, 200)}`, screenshot: await shot(page, L, '分享觀察例外') });
  }
  await context.close();
  await browser.close();
}

// ───────── 報告 ─────────
const MARK = { passed: '通過', failed: '失敗', pending: '待修後必須通過', unverified: '無法驗證', info: '記錄' };
function summary() {
  const s = { total: 0, passed: 0, failed: 0, pending: 0, unverified: 0, info: 0, unknown: 0 };
  for (const r of results) {
    if (r.status === 'info') { s.info++; continue; }
    if (!(r.status in s)) { s.unknown++; continue; } // 未知代碼：不靜默吞掉，單獨計數並讓自我檢查失敗
    s.total++; s[r.status]++;
  }
  return s;
}
const esc = (t) => String(t ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

function toMarkdown(metas, startedAt) {
  const s = summary();
  const rel = (p) => `../qa/存檔再開/${p}`;
  let md = `# WO-67 測試結果（${RUN_LABEL}）\n\n`;
  md += `- 臺北執行時間：${startedAt} 開始，${taipeiTime()} 結束\n`;
  md += `- 目標 BASE：${BASE}\n`;
  md += `- 瀏覽器：${metas.map((m) => `${m.layout}＝${m.engine}`).join('；')}\n`;
  md += `- **本次以 Chromium 代測，無 WebKit 證據，WebKit 裝好後要補跑一次**（補跑：\`ENGINE=webkit node qa/存檔再開/run.mjs\`）。\n`;
  md += `- 版面：${LAYOUTS.map((l) => `${l.name} ${l.viewport.width}×${l.viewport.height}（${l.touch ? '觸控' : '滑鼠'}）`).join('；')}\n`;
  md += `- 產物資料夾：qa/存檔再開/${RUN_LABEL}/\n`;
  md += `- 總計：${s.total} 項｜通過：${s.passed}｜待修後必須通過：${s.pending}｜失敗：${s.failed}｜無法驗證：${s.unverified}（無法驗證＝App 沒有該回饋或環境無法觀察，不算通過；另有 ${s.info} 項僅記錄）\n\n`;
  md += `## 各版面測試書名與本次唯一輸出檔\n\n| 版面 | 測試書名 | 本次唯一輸出檔 | Playwright 下載暫存路徑 |\n|---|---|---|---|\n`;
  for (const m of metas) md += `| ${m.layout} | ${esc(m.title)} | ${m.outFile ? `qa/存檔再開/${path.relative(QA_DIR, m.outFile)}` : '（未取得）'} | ${esc(m.downloadTmpPath || '-')} |\n`;
  md += `\n## 逐項結果\n\n| 版面 | 步驟 | 項目 | 結果 | 對應工單 | 預期 | 實際觀察 | 截圖 |\n|---|---|---|---|---|---|---|---|\n`;
  for (const r of results) {
    md += `| ${r.layout} | ${r.step} | ${esc(r.item)} | ${MARK[r.status]} | ${r.issue || '-'} | ${esc(r.expected)} | ${esc(r.actual)}${r.note ? `<br>備註：${esc(r.note)}` : ''} | ${r.screenshot ? `[截圖](${rel(r.screenshot)})` : '-'} |\n`;
  }
  md += `\n## 未測／能力限制\n\n`;
  md += `- 系統存檔視窗、系統選檔視窗：未測。測試端移除了 \`showSaveFilePicker\`／\`showOpenFilePicker\`（等同無檔案存取 API 的瀏覽器），改驗下載與 \`<input type=file>\` 選檔；「儲存專案」存回原檔未測。\n`;
  md += `- 系統分享面板：未測；只在瀏覽器介面邊界攔截 App 送出的分享負載（手機直拿／橫拿）。\n`;
  md += `- 真注音選字、真鍵盤高度、主畫面與 Safari 空間、飛航模式、系統手勢、Safari 字級：不屬自動測試範圍，未測；本次不是 iPhone 實機驗證。\n`;
  md += `- 加卡片再開（WO-73 未修好前不列必須通過）：本次未執行。\n`;
  md += `- 各版面頁面錯誤（pageerror）：${metas.map((m) => `${m.layout} ${m.pageErrors?.length || 0} 筆`).join('；')}\n`;
  return md;
}

// ───────── 自我檢查：故意觸發受阻分支，確認統一代碼、計數與報告正確（不算正式結果） ─────────
function selfTest() {
  const lines = [];
  const check = (name, ok, detail = '') => { lines.push(`${ok ? '通過' : '失敗'}｜${name}${detail ? `｜${detail}` : ''}`); return ok; };
  results.length = 0;
  const A = { name: '自我檢查版面A（WO-68 受阻）', id: 'selftestA' };
  const B = { name: '自我檢查版面B（前置失敗）', id: 'selftestB' };
  const doneA = new Set(['2', '3']);
  skipSteps(A, doneA, { issue: 'WO-68', reason: '橫拿走不到檔案頁' }, '走不到檔案頁', '自我檢查/受阻當下.png');
  skipSteps(B, new Set(), null, '例外：自我檢查', null);
  rec(A, 'T1', '自我檢查：通過樣本', 'passed', {});
  rec(A, 'T2', '自我檢查：無法驗證樣本', 'unverified', {});
  const nA = STEP_NAMES.filter(([st]) => !doneA.has(st)).length;
  const nB = STEP_NAMES.length;
  const s = summary();
  let ok = true;
  ok = check('受阻分支只用 pending 代碼', results.filter((r) => r.layoutId === 'selftestA' && r.step.match(/^\d/)).every((r) => r.status === 'pending' && r.issue === 'WO-68')) && ok;
  ok = check('前置失敗分支只用 failed 代碼', results.filter((r) => r.layoutId === 'selftestB').every((r) => r.status === 'failed' && !r.issue)) && ok;
  ok = check('已完成步驟不重複列入', !results.some((r) => r.layoutId === 'selftestA' && (r.step === '2' || r.step === '3'))) ;
  ok = check(`計數：總計 ${nA + nB + 2}`, s.total === nA + nB + 2, `實際 ${s.total}`) && ok;
  ok = check(`計數：待修 ${nA}`, s.pending === nA, `實際 ${s.pending}`) && ok;
  ok = check(`計數：失敗 ${nB}`, s.failed === nB, `實際 ${s.failed}`) && ok;
  ok = check('計數：通過 1、無法驗證 1、未知代碼 0', s.passed === 1 && s.unverified === 1 && s.unknown === 0, JSON.stringify(s)) && ok;
  const md = toMarkdown([{ layout: A.name, engine: '-', title: '-', pageErrors: [] }], taipeiTime());
  const header = (md.match(/- 總計：[^\n]+/) || [''])[0];
  ok = check('報告表頭數字與計數一致', header.includes(`待修後必須通過：${nA}`) && header.includes(`失敗：${nB}`) && header.includes('無法驗證：1'), header) && ok;
  const rows = md.split('## 逐項結果')[1].split('\n').filter((l) => l.startsWith('| 自我檢查'));
  ok = check('報告每筆結果各佔一列', rows.length === results.length, `${rows.length}／${results.length}`) && ok;
  ok = check('受阻列明寫「尚未執行」與阻擋工單', rows.filter((l) => l.includes('尚未執行（WO-68 阻擋')).length === nA && rows.filter((l) => l.includes('尚未執行（前置步驟失敗')).length === nB) && ok;
  ok = check('受阻列結果欄是「待修後必須通過」而非其他字樣', rows.filter((l) => l.includes('| 待修後必須通過 | WO-68 |')).length === nA) && ok;
  fs.writeFileSync(path.join(RUN_DIR, '自我檢查結果.txt'), `WO-67 自我檢查（不算正式結果）\n${lines.join('\n')}\n總結：${ok ? '全部通過' : '有失敗'}\n`, 'utf8');
  console.log(lines.join('\n'));
  console.log(ok ? '自我檢查：全部通過' : '自我檢查：有失敗');
  process.exit(ok ? 0 : 1);
}
if (SELFTEST) selfTest();

// ───────── 主程式 ─────────
const startedAt = taipeiTime();
const only = process.env.LAYOUTS ? process.env.LAYOUTS.split(',') : null;
const metas = [];
for (const layout of LAYOUTS.filter((l) => !only || only.includes(l.id))) {
  console.log(`\n===== ${layout.name} =====`);
  try { metas.push(await runLayout(layout)); } catch (e) {
    rec(layout, 'X', '版面整體例外（已隔離）', 'failed', { expected: '流程順利', actual: String(e.message).slice(0, 200) });
    metas.push({ layout: layout.name, engine: '-', title: '-', pageErrors: [] });
  }
  if (layout.phone) await runShareProbe(layout);
}
const s = summary();
console.log(`\n總計 ${s.total}｜通過 ${s.passed}｜待修 ${s.pending}｜失敗 ${s.failed}`);
fs.writeFileSync(path.join(RUN_DIR, '結果.json'), JSON.stringify({ label: RUN_LABEL, base: BASE, engine: ENGINE, startedAt, summary: s, results, metas }, null, 2), 'utf8');
const md = toMarkdown(metas, startedAt);
fs.writeFileSync(path.join(RUN_DIR, '結果.md'), md, 'utf8');
if (OFFICIAL && WO67_DIR) {
  fs.mkdirSync(WO67_DIR, { recursive: true });
  fs.writeFileSync(path.join(WO67_DIR, `WO-67-測試結果-${RUN_LABEL}.md`), md, 'utf8');
}
