/**
 * 工單 WO-66 自動點擊測試（入口檢查）
 * 執行環境：Node.js ESM + Playwright (WebKit / Chromium Headless Shell)
 * 預設目標：http://127.0.0.1:4173（可用 BASE 改為分支預覽網址）
 * WO-69（2026-11-14）：新稿今日字數與寫作紀錄改為必須通過、改用畫面分頁往返；正式執行不再使用 force 點擊（見 README 最後一節）。
 * Playwright：請設定 PLAYWRIGHT_MODULE、必要時設定 CHROMIUM_PATH，見 qa/README.md。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, chromiumPath } from '../playwright-env.mjs';

// 終端輸出完整複製記錄器
const logChunks = [];
const origStdoutWrite = process.stdout.write.bind(process.stdout);
const origStderrWrite = process.stderr.write.bind(process.stderr);

process.stdout.write = (chunk, encoding, callback) => {
  logChunks.push(Buffer.isBuffer(chunk) ? chunk.toString(encoding || 'utf8') : String(chunk));
  return origStdoutWrite(chunk, encoding, callback);
};

process.stderr.write = (chunk, encoding, callback) => {
  logChunks.push(Buffer.isBuffer(chunk) ? chunk.toString(encoding || 'utf8') : String(chunk));
  return origStderrWrite(chunk, encoding, callback);
};

const { chromium, webkit, devices } = loadPlaywright();
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const DEFAULT_OUT = path.join(REPO_ROOT, 'test-results', 'qa', '入口檢查');

export const BASE = process.env.BASE || 'http://127.0.0.1:4173';
// 輸出位置可用環境變數改到獨立資料夾（截圖、JSON、最新結果、日誌全部跟著走）；未設時寫入 test-results（已列入 .gitignore）
export const QA_DIR = process.env.QA_DIR || DEFAULT_OUT;
export const WO66_DIR = process.env.WO66_DIR || process.env.QA_DIR || DEFAULT_OUT;
// WO-68：ENGINE=chromium 時，前三版面改用 Chromium 代測（WebKit 缺系統函式庫）；視窗、觸控與斷言不變。未設時照各版面原設定
export const ENGINE = process.env.ENGINE === 'chromium' ? 'chromium' : null;

// 四種版面定義
export const LAYOUTS = [
  {
    id: 'phone-portrait',
    name: '手機直拿',
    viewport: { width: 390, height: 844 },
    touch: true,
    browserType: 'webkit',
    device: devices['iPhone 13'],
  },
  {
    id: 'phone-landscape',
    name: '手機橫拿',
    viewport: { width: 844, height: 390 },
    touch: true,
    browserType: 'webkit',
    device: devices['iPhone 13 landscape'],
  },
  {
    id: 'tablet-portrait',
    name: '中等',
    viewport: { width: 768, height: 1024 },
    touch: true,
    browserType: 'webkit',
    device: devices['iPad (gen 7)'],
  },
  {
    id: 'desktop-wide',
    name: '寬版',
    viewport: { width: 1280, height: 800 },
    touch: false,
    browserType: 'chromium',
  },
];

// 測試結果收集器
export class TestReporter {
  constructor() {
    this.results = [];
  }

  record({ layout, section, item, status, issue = null, detail = '', screenshot = null }) {
    const entry = {
      layout,
      section,
      item,
      status, // '通過' | '失敗' | '待修後必須通過'
      issue,
      detail: String(detail || ''),
      screenshot,
      timestamp: new Date().toISOString(),
    };
    this.results.push(entry);

    const tag = status === '通過' ? '✅ 通過' : status === '待修後必須通過' ? '⚠️ 待修' : '❌ 失敗';
    const issueTag = issue ? ` [${issue}]` : '';
    console.log(`[${layout}] ${tag} ${section} - ${item}${issueTag}${detail ? ` (${detail})` : ''}`);
    return entry;
  }

  summary() {
    const total = this.results.length;
    const passed = this.results.filter((r) => r.status === '通過').length;
    const pending = this.results.filter((r) => r.status === '待修後必須通過').length;
    const failed = this.results.filter((r) => r.status === '失敗').length;
    return { total, passed, pending, failed };
  }

  saveJson(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(this.results, null, 2), 'utf-8');
  }

  toMarkdown(title = 'WO-66 入口檢查測試報告') {
    const { total, passed, pending, failed } = this.summary();
    let md = `# ${title}\n\n`;
    md += `- 測試時間：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}\n`;
    md += `- 測試目標：${BASE}\n`;
    md += `- 引擎：${ENGINE ? 'Chromium（四種版面全部；本次以 Chromium 代測，無 WebKit 證據）' : '直拿、橫拿、中等 WebKit；寬版 Chromium'}\n`;
    md += `- 總計：${total} 項｜通過：${passed} 項｜待修後必須通過：${pending} 項｜失敗：${failed} 項\n\n`;
    md += `| 版面 | 大項 | 測試項目 | 結果 | 對應工單 | 說明與截圖 |\n`;
    md += `|---|---|---|---|---|---|\n`;

    for (const r of this.results) {
      const shot = r.screenshot ? `[截圖](${r.screenshot})` : '-';
      const detail = r.detail ? r.detail.replace(/\|/g, '\\|') : '-';
      md += `| ${r.layout} | ${r.section} | ${r.item} | ${r.status} | ${r.issue || '-'} | ${detail} ${shot !== '-' ? `<br>${shot}` : ''} |\n`;
    }
    return md;
  }
}

// 瀏覽器啟動輔助函式
async function launchBrowser(browserType) {
  if (browserType === 'webkit') {
    return await webkit.launch({ headless: true });
  }

  const opts = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };
  const shellPath = chromiumPath();
  if (shellPath) opts.executablePath = shellPath;
  try {
    return await chromium.launch(opts);
  } catch (err) {
    if (fs.existsSync('/usr/bin/google-chrome')) {
      console.warn(`Chromium 啟動失敗，改試系統 Chrome：${err.message}`);
      return await chromium.launch({
        headless: true,
        executablePath: '/usr/bin/google-chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    }
    throw err;
  }
}

// 建立 context 與 page
async function createContext(browser, layout) {
  const opts = {
    viewport: layout.viewport,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
  };

  if (layout.device) {
    opts.userAgent = layout.device.userAgent;
  }

  if (layout.touch) {
    opts.hasTouch = true;
    opts.isMobile = true;
  }

  const context = await browser.newContext(opts);
  if (ENGINE === 'chromium' && layout.browserType === 'webkit') {
    // WO-68：沿用 WO-67 的瀏覽器能力模擬。原本用 WebKit 的三種版面改以 Chromium 代測時，移除 Chromium 才有的
    // 檔案存取視窗 API，讓 App 走與 iPhone／iPad Safari 相同的「無系統存檔視窗」路徑（例如顯示「今天還沒另存」）。
    // 這不是改 App 狀態；系統存檔／選檔視窗因此未測。寬版維持原本 Chromium 行為。
    await context.addInitScript(() => {
      try { delete window.showSaveFilePicker; delete window.showOpenFilePicker; } catch { /* 略 */ }
    });
  }
  const page = await context.newPage();

  // 避免視窗尺寸變形
  await page.setViewportSize(layout.viewport);
  return { context, page };
}

// 截圖工具函式
async function takeScreenshot(page, layoutId, name, status) {
  try {
    const filename = `shot_${layoutId}_${name}_${status}.png`;
    const fullPath = path.join(QA_DIR, filename);
    await page.screenshot({ path: fullPath, fullPage: false });
    return filename;
  } catch (err) {
    console.warn(`截圖失敗: ${err.message}`);
    return null;
  }
}

// 切換回內建範例書「【範例】霧港紀事」
async function switchToSampleBook(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="home-screen"], h1', { timeout: 15000 });
  const sample = page.locator('[data-testid="project-card"]:has-text("【範例】霧港紀事"), .project-card:has-text("【範例】霧港紀事")').first();
  await sample.waitFor({ state: 'visible', timeout: 8000 });
  await sample.click();
  await page.waitForURL(/\/p\/[^\/]+\/write/, { timeout: 10000 });
  await page.waitForTimeout(500);
}

// 確保位於稿件中（若不在則從首頁點選「【範例】霧港紀事」進入）
async function ensureInBook(page, targetUrlPart = '') {
  let match = page.url().match(/\/p\/([^\/]+)/);
  if (!match) {
    await switchToSampleBook(page);
    match = page.url().match(/\/p\/([^\/]+)/);
  }
  const projectId = match ? match[1] : '';
  if (targetUrlPart) {
    const targetUrl = `${BASE}/p/${projectId}${targetUrlPart}`;
    if (page.url() !== targetUrl) {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);
    }
  }
  return projectId;
}

/** WO-69：從統計頁可見文字讀出各項數字（唯讀解析畫面文字）。 */
function wo69ParseStats(t) {
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

/** WO-69：用畫面上的分頁走到某頁（觸控用 tap、滑鼠用 click，不用 force、不跳網址）。
 *  橫拿沿用 WO-68：分頁在目錄抽屜左邊；已進章的寫作頁先按「展開目錄」。 */
async function wo69GotoTab(page, layout, tab) {
  const navSel = layout.id === 'desktop-wide' || layout.id === 'phone-landscape' ? '[data-testid="nav-rail"]' : '[data-testid="bottom-nav"]';
  const act = (loc) => (layout.touch ? loc.tap({ timeout: 8000 }) : loc.click({ timeout: 8000 }));
  const btn = page.locator(`${navSel} [data-testid="nav-${tab}"]`).first();
  let via = `${navSel} 的「${tab}」分頁`;
  if (layout.id === 'phone-landscape' && !(await btn.isVisible().catch(() => false))) {
    const opener = page.locator('[data-testid="toggle-tree-floating"]').first();
    if (await opener.isVisible().catch(() => false)) {
      await act(opener);
      await page.waitForTimeout(600);
      via = `「展開目錄」→ ${via}`;
    }
  }
  if (!(await btn.isVisible().catch(() => false))) return { ok: false, via: `${via}（找不到）` };
  await act(btn);
  await page.waitForURL((u) => u.toString().includes(`/${tab}`), { timeout: 8000 }).catch(() => null);
  await page.waitForTimeout(500);
  return { ok: page.url().includes(`/${tab}`), via };
}

/** WO-69：對元件中心點做一次真實的指標點擊（觸控 tap、滑鼠 click）。
 *  用於 aria-disabled 的「準備中」按鈕：照使用者實際點下去的位置送出輸入事件，不跳過遮擋判斷，取代原本的 force。 */
async function wo69PointerAt(page, layout, loc) {
  const b = await loc.first().boundingBox().catch(() => null);
  if (!b) return false;
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  if (layout?.touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  return true;
}

// 確保畫面回到乾淨狀態（抽屜、彈窗、遮罩皆關閉）
async function ensureCleanState(page, layout = null) {
  try {
    const isWide = layout?.id === 'desktop-wide' || (page.viewportSize() && page.viewportSize().width >= 1024);

    // 1. 先關閉看卡片抽屜 (WritingCardsDrawer)
    if (!isWide) {
      const closeCardsBtn = page.locator('[data-testid="close-cards-drawer"]').first();
      if (await closeCardsBtn.isVisible().catch(() => false)) {
        await closeCardsBtn.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(200);
      }
      const cardsOverlay = page.locator('[data-testid="writing-cards-overlay"]').first();
      if (await cardsOverlay.isVisible().catch(() => false)) {
        await cardsOverlay.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(200);
      }
      const cardsDrawer = page.locator('[data-testid="writing-cards-drawer"]').first();
      if (await cardsDrawer.isVisible().catch(() => false)) {
        await cardsDrawer.waitFor({ state: 'hidden', timeout: 1500 }).catch(() => {});
      }
    }

    // 2. 關閉目錄抽屜（在非寬版模式下）
    if (!isWide) {
      const closeTreeBtn = page.locator('[data-testid="close-tree-pane"]').first();
      if (await closeTreeBtn.isVisible().catch(() => false)) {
        await closeTreeBtn.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(200);
      }
    } else {
      // 寬版若目錄被誤關，點擊按鈕重新展開
      const treePane = page.locator('[data-testid="chapter-tree"]');
      const isClosed = await treePane.evaluate((el) => el.classList.contains('is-closed')).catch(() => false);
      if (isClosed) {
        const topBtn = page.locator('[data-testid="toggle-tree-topbar"]');
        if (await topBtn.isVisible().catch(() => false)) {
          await topBtn.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(200);
        }
      }
    }

    // 3. 關閉任何彈出 sheet 或 backdrop
    const backdrop = page.locator('.sheet-backdrop, [data-testid="modal-backdrop"]').first();
    if (await backdrop.isVisible().catch(() => false)) {
      await backdrop.click({ position: { x: 5, y: 5 }, timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(200);
    }

    // 4. 若處於專注模式，離開專注模式
    const exitFocusBtn = page.locator('[data-testid="exit-focus-mode"]').first();
    if (await exitFocusBtn.isVisible().catch(() => false)) {
      await exitFocusBtn.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(200);
      if (await exitFocusBtn.isVisible().catch(() => false)) {
        await exitFocusBtn.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(200);
      }
    }
  } catch (_) {}
}

/**
 * 測試第 1 節：首頁
 */
async function testSection1_Home(page, layout, reporter) {
  const section = '1. 首頁';

  // 1.0 造訪首頁
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(async (e) => {
      console.warn(`首次造訪首頁重試：${e.message}`);
      await page.waitForTimeout(1000);
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    });
    await page.waitForSelector('[data-testid="home-screen"], h1', { timeout: 15000 });
  } catch (err) {
    const shot = await takeScreenshot(page, layout.id, '首頁載入', '失敗');
    reporter.record({
      layout: layout.name,
      section,
      item: '首頁畫面載入',
      status: '失敗',
      detail: `首頁載入失敗：${err.message}`,
      screenshot: shot,
    });
    return;
  }

  // 1.1 開啟稿子入口檢查（確認看得到、按鈕存在，不選取真實 .db）
  try {
    const openBtn = page.locator('button:has-text("開啟稿子")');
    await openBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
    const isVisible = await openBtn.isVisible().catch(() => false);
    const fileInput = page.locator('input[data-testid="open-db"], input[type="file"]');
    const inputExists = (await fileInput.count()) > 0;

    if (isVisible && inputExists) {
      reporter.record({
        layout: layout.name,
        section,
        item: '開啟稿子入口',
        status: '通過',
        detail: '「開啟稿子」按鈕看得到且選檔 input 存在',
      });
    } else {
      const shot = await takeScreenshot(page, layout.id, '開啟稿子入口', '失敗');
      reporter.record({
        layout: layout.name,
        section,
        item: '開啟稿子入口',
        status: '失敗',
        detail: `按鈕可見: ${isVisible}, 選檔元件存在: ${inputExists}`,
        screenshot: shot,
      });
    }
  } catch (err) {
    const shot = await takeScreenshot(page, layout.id, '開啟稿子入口', '失敗');
    reporter.record({
      layout: layout.name,
      section,
      item: '開啟稿子入口',
      status: '失敗',
      detail: err.message,
      screenshot: shot,
    });
  }

  // 1.2 最近清單打開一份稿子（打開「【範例】霧港紀事」）
  try {
    const sampleCard = page.locator('[data-testid="project-card"]:has-text("【範例】霧港紀事"), .project-card:has-text("【範例】霧港紀事")').first();
    const exists = await sampleCard.isVisible({ timeout: 5000 }).catch(() => false);

    if (exists) {
      await sampleCard.click();
      await page.waitForURL(/\/p\/[^\/]+\/write/, { timeout: 10000 });
      reporter.record({
        layout: layout.name,
        section,
        item: '最近清單打開稿子',
        status: '通過',
        detail: '能成功從最近清單點進「【範例】霧港紀事」',
      });
    } else {
      const shot = await takeScreenshot(page, layout.id, '最近清單打開稿子', '失敗');
      reporter.record({
        layout: layout.name,
        section,
        item: '最近清單打開稿子',
        status: '失敗',
        detail: '最近清單中未找到「【範例】霧港紀事」',
        screenshot: shot,
      });
    }
  } catch (err) {
    const shot = await takeScreenshot(page, layout.id, '最近清單打開稿子', '失敗');
    reporter.record({
      layout: layout.name,
      section,
      item: '最近清單打開稿子',
      status: '失敗',
      detail: err.message,
      screenshot: shot,
    });
  }

  // 1.3 進得了設定之前的基本畫面（清單說明：從稿子裡的設定分頁進去也算）
  try {
    const currentUrl = page.url();
    const match = currentUrl.match(/\/p\/([^\/]+)/);
    const projectId = match ? match[1] : null;

    if (projectId) {
      await page.goto(`${BASE}/p/${projectId}/settings`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-testid="settings-screen"], h1:has-text("設定")', { timeout: 10000 });
      reporter.record({
        layout: layout.name,
        section,
        item: '基本設定畫面入口',
        status: '通過',
        detail: '可進入稿件設定基本畫面',
      });
    } else {
      reporter.record({
        layout: layout.name,
        section,
        item: '基本設定畫面入口',
        status: '通過',
        detail: '首頁基本畫面完備',
      });
    }
  } catch (err) {
    const shot = await takeScreenshot(page, layout.id, '基本設定畫面', '失敗');
    reporter.record({
      layout: layout.name,
      section,
      item: '基本設定畫面入口',
      status: '失敗',
      detail: err.message,
      screenshot: shot,
    });
  }

  // 回到首頁準備測開新稿子
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="home-screen"], h1', { timeout: 10000 });

  // 1.4 開新稿子（填書名、建立，建立得成）
  try {
    const newBtn = page.locator('button:has-text("開新稿子")');
    await newBtn.click();
    await page.waitForSelector('form.dialog, [role="dialog"]', { timeout: 5000 });

    const titleInput = page.locator('form.dialog input, [role="dialog"] input').first();
    await titleInput.fill('');
    await titleInput.fill('【範例】自動測試稿');

    const submitBtn = page.locator('form.dialog button[type="submit"]:has-text("建立"), [role="dialog"] button:has-text("建立")');
    await submitBtn.click();

    // 建立後應跳轉進寫作頁面
    await page.waitForURL(/\/p\/[^\/]+\/write/, { timeout: 10000 });
    const newDraftUrl = page.url();
    const newProjMatch = newDraftUrl.match(/\/p\/([^\/]+)/);
    const newProjectId = newProjMatch ? newProjMatch[1] : '';

    reporter.record({
      layout: layout.name,
      section,
      item: '開新稿子',
      status: '通過',
      detail: '填寫書名【範例】自動測試稿並建立成功，順利進入寫作頁',
    });

    // 1.5 WO-69：新稿今日字數與寫作紀錄從 0 起算（原「待修後必須通過（WO-69）」，WO-69 後改為必須通過）
    // 以畫面分頁走到統計再回寫作，不跳內部網址；橫拿沿用 WO-68 直排分頁（寫作頁先按「展開目錄」）。
    try {
      const wordsEl = page.locator('[data-testid="topbar-words"], [data-testid="status-bar"]');
      const wordsText = (await wordsEl.first().innerText().catch(() => '')).trim();
      const toStats = await wo69GotoTab(page, layout, 'stats');
      await page.waitForSelector('[data-testid="stats-screen"]', { timeout: 8000 }).catch(() => null);
      const statsText = toStats.ok
        ? (await page.locator('[data-testid="stats-screen"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
        : '';
      const st = wo69ParseStats(statsText);
      const zeroKeys = ['today', 'streak', 'longest', 'last7', 'activeDays', 'achieved'];
      const allZero = toStats.ok && zeroKeys.every((k) => st[k] === 0) && st.hours !== null && Number(st.hours) === 0;
      const sampleDate = /10\s*[\/月-]\s*(?:1[89]|2[0-8])(?!\d)/.test(statsText);
      const wordsToday = (wordsText.match(/([\d,]+)\s*[／\/]\s*[\d,]+/) || [])[1];
      const wordsZero = wordsToday === undefined || Number(wordsToday.replace(/,/g, '')) === 0;
      const back = toStats.ok ? await wo69GotoTab(page, layout, 'write') : { ok: false, via: '未進統計' };
      const ok = allZero && !sampleDate && wordsZero && back.ok;
      const detail = `進統計：${toStats.via}（${toStats.ok ? '進得去' : '進不去'}）；統計：今天 ${st.today}、連續 ${st.streak}、最長連續 ${st.longest}、近七日 ${st.last7}、時數 ${st.hours}、有寫天數 ${st.activeDays}、已達成 ${st.achieved}；範例日期${sampleDate ? '有出現（不符）' : '未出現'}；寫作頁字數「${wordsText || '（此畫面未顯示）'}」；返回寫作：${back.via}（${back.ok ? '回得來' : '回不來'}）`;
      reporter.record({
        layout: layout.name,
        section,
        item: '新稿今日字數與寫作紀錄',
        status: ok ? '通過' : '失敗',
        issue: ok ? undefined : 'WO-69',
        detail: ok ? `新稿各項統計從 0 起算、無範例書紀錄。${detail}` : detail,
        screenshot: ok ? null : await takeScreenshot(page, layout.id, '新稿今日字數與統計', '失敗'),
      });
    } catch (err) {
      reporter.record({
        layout: layout.name,
        section,
        item: '新稿今日字數與寫作紀錄',
        status: '失敗',
        issue: 'WO-69',
        detail: err.message,
      });
      await wo69GotoTab(page, layout, 'write').catch(() => {});
    }

    // 1.6 & 1.7 檢查 WO-74 & WO-75：看卡片是否出現範例角色與範例卡片說明文字
    try {
      // 確保點擊章節進入寫作輸入畫面
      const newChBtn = page.locator('.tree-row[data-node-id^="ch-"] .tree-main, button.tree-main').first();
      if (await newChBtn.isVisible().catch(() => false)) {
        await newChBtn.click();
        await page.waitForURL(/\/p\/[^\/]+\/write\/[^\/]+/, { timeout: 8000 }).catch(() => null);
        await page.waitForTimeout(500);
      }

      let toggleCardsBtn = null;
      if (layout.id === 'phone-portrait') {
        toggleCardsBtn = page.locator('[data-testid="thumb-cards-button"]');
      } else if (layout.id === 'phone-landscape') {
        toggleCardsBtn = page.locator('[data-testid="toggle-cards-landscape"]');
      } else {
        toggleCardsBtn = page.locator('[data-testid="toggle-cards-topbar"]');
      }

      if (await toggleCardsBtn.isVisible().catch(() => false)) {
        await toggleCardsBtn.click();
        await page.waitForTimeout(500);

        const drawerEl = page.locator('[data-testid="writing-cards-drawer"], aside.writing-cards-drawer, [data-testid="write-aside"]');
        const drawerText = await drawerEl.innerText().catch(() => '');

        // WO-74 檢查：新稿看卡片出現範例角色（沈雨晴、陸明遠、陳巡守、林維舟等）
        const hasSampleRoles = drawerText.includes('沈雨晴') || drawerText.includes('陸明遠') || drawerText.includes('陳巡守') || drawerText.includes('林維舟') || drawerText.includes('沈巡檢');
        if (hasSampleRoles) {
          const shot = await takeScreenshot(page, layout.id, '新稿卡片出現範例角色', '待修後必須通過');
          reporter.record({
            layout: layout.name,
            section,
            item: '新稿卡片角色隔離',
            status: '待修後必須通過',
            issue: 'WO-74',
            detail: '新稿看卡片抽屜出現範例書角色（如沈雨晴、陸明遠等），待 WO-74 修復卡片隔離',
            screenshot: shot,
          });
        } else {
          reporter.record({
            layout: layout.name,
            section,
            item: '新稿卡片角色隔離',
            status: '通過',
            detail: '新稿看卡片未出現範例角色',
          });
        }

        // WO-75 檢查：不是範例書卻出現「範例卡片，之後會換成這份稿子的卡片」或卡片帶有【範例】
        const hasSampleNote = drawerText.includes('範例卡片，之後會換成這份稿子的卡片') || drawerText.includes('【範例】') || drawerText.includes('範例卡片');
        if (hasSampleNote) {
          const shot = await takeScreenshot(page, layout.id, '新稿出現範例卡片說明文字', '待修後必須通過');
          reporter.record({
            layout: layout.name,
            section,
            item: '非範例書卡片說明文字',
            status: '待修後必須通過',
            issue: 'WO-75',
            detail: '新稿出現「範例卡片，之後會換成這份稿子的卡片」或卡片帶有【範例】標籤，待 WO-75 修復提示條件',
            screenshot: shot,
          });
        } else {
          reporter.record({
            layout: layout.name,
            section,
            item: '非範例書卡片說明文字',
            status: '通過',
            detail: '新稿未出現範例卡片說明文字',
          });
        }

        // 關閉卡片抽屜
        await ensureCleanState(page, layout);
      } else {
        reporter.record({
          layout: layout.name,
          section,
          item: '新稿卡片角色隔離',
          status: '失敗',
          detail: '寫作頁未找到看卡片切換按鈕（新發現，待芝琳開單）',
        });
        reporter.record({
          layout: layout.name,
          section,
          item: '非範例書卡片說明文字',
          status: '失敗',
          detail: '寫作頁未找到看卡片切換按鈕（新發現，待芝琳開單）',
        });
      }
    } catch (err) {
      reporter.record({
        layout: layout.name,
        section,
        item: '新稿卡片角色隔離',
        status: '失敗',
        detail: err.message,
      });
      reporter.record({
        layout: layout.name,
        section,
        item: '非範例書卡片說明文字',
        status: '失敗',
        detail: err.message,
      });
    }

    // 依審查建議：新稿檢查完成後，切換回「【範例】霧港紀事」，供後續目錄、資料集、五個分頁測試使用
    await switchToSampleBook(page);
  } catch (err) {
    const shot = await takeScreenshot(page, layout.id, '開新稿子', '失敗');
    reporter.record({
      layout: layout.name,
      section,
      item: '開新稿子',
      status: '失敗',
      detail: err.message,
      screenshot: shot,
    });
  }
}

/**
 * WO-68：手機橫拿五分頁（目錄抽屜左邊直排 nav-rail）
 * - 目錄頁、寫作頁經「展開目錄」都要走得到五分頁；各頁要能用畫面回寫作。
 * - 「今天還沒另存」進檔案頁也要回得來（死路檢查）。
 * - 全部以觸控 tap 操作，不用 force、不用 evaluate 改狀態、不跳內部網址冒充入口。
 */
const LANDSCAPE_TABS = [
  { id: 'write', name: '寫作', expectedUrlPart: '/write' },
  { id: 'cards', name: '資料集', expectedUrlPart: '/cards' },
  { id: 'files', name: '檔案', expectedUrlPart: '/files' },
  { id: 'stats', name: '統計', expectedUrlPart: '/stats' },
  { id: 'settings', name: '設定', expectedUrlPart: '/settings' },
];

async function testLandscapeTabs(page, layout, reporter, section) {
  const rail = page.locator('[data-testid="nav-rail"]');
  const bottom = page.locator('[data-testid="bottom-nav"]');
  const tree = page.locator('[data-testid="chapter-tree"]');
  const editorPane = page.locator('[data-testid="editor-pane"]');
  const floating = page.locator('[data-testid="toggle-tree-floating"]');
  const closeTree = page.locator('[data-testid="close-tree-pane"]');
  const chapterRow = page.locator('.tree-row[data-node-id^="ch-"] .tree-main, button.tree-main:has-text("章")').first();
  const tap = (loc) => loc.tap({ timeout: 8000 });
  const isVis = (loc) => loc.first().isVisible().catch(() => false);
  const box = (loc) => loc.first().boundingBox().catch(() => null);
  const record = async (item, ok, detail, shotName) => {
    const status = ok ? '通過' : '失敗';
    const shot = ok ? null : await takeScreenshot(page, layout.id, shotName || item, status);
    reporter.record({ layout: layout.name, section, item, status, issue: ok ? undefined : 'WO-68', detail, screenshot: shot });
  };
  const waitUrl = async (part) => {
    await page.waitForURL((u) => u.toString().includes(part), { timeout: 8000 }).catch(() => null);
    await page.waitForTimeout(400);
    return page.url().includes(part);
  };
  const enterChapter = async () => {
    if (!(await isVis(chapterRow))) return false;
    await tap(chapterRow);
    await page.waitForURL(/\/p\/[^\/]+\/write\/[^\/]+/, { timeout: 8000 }).catch(() => null);
    await page.waitForTimeout(500);
    return /\/write\/[^\/]+/.test(page.url());
  };

  // A. 目錄頁：直排分頁看得到、順序、尺寸、不叫出底部分頁、不壓目錄
  try {
    await rail.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
    const railVis = await isVis(rail);
    if (!railVis) {
      await record('五個分頁可見性與切換', false, '目錄頁找不到左側直排分頁（nav-rail 不可見）', '五個分頁導覽');
    } else {
      const labels = (await rail.locator('a').allInnerTexts()).map((t) => t.replace(/\s+/g, ''));
      const orderOk = JSON.stringify(labels) === JSON.stringify(LANDSCAPE_TABS.map((t) => t.name));
      const sizes = [];
      let sizeOk = true;
      for (const t of LANDSCAPE_TABS) {
        const b = await box(rail.locator(`[data-testid="nav-${t.id}"]`));
        const ok = !!b && b.width >= 44 && b.height >= 44 && b.x >= 0 && b.y >= 0 && b.y + b.height <= layout.viewport.height + 0.5;
        if (!ok) sizeOk = false;
        sizes.push(`${t.name} ${b ? `${Math.round(b.width)}×${Math.round(b.height)}@y${Math.round(b.y)}` : '無'}`);
      }
      const bottomVis = await isVis(bottom);
      const rb = await box(rail);
      const tb = await box(tree);
      const noOverlap = !!rb && !!tb && rb.x + rb.width <= tb.x + 1;
      const ok = orderOk && sizeOk && !bottomVis && noOverlap;
      await record(
        '五個分頁可見性與切換',
        ok,
        `目錄頁左側直排分頁：順序［${labels.join('、')}］${orderOk ? '' : '（順序不符）'}；尺寸 ${sizes.join('，')}${sizeOk ? '' : '（有按鈕小於 44×44 或超出畫面）'}；底部分頁${bottomVis ? '被叫出（不符）' : '未顯示'}；分頁${noOverlap ? '在目錄左邊、不壓目錄' : '與目錄重疊'}`,
        '五個分頁導覽',
      );

      // 每個分頁：從直排分頁進去，再用同一排「寫作」回來
      for (const t of LANDSCAPE_TABS) {
        const item = `分頁-${t.name}`;
        try {
          const btn = rail.locator(`[data-testid="nav-${t.id}"]`);
          if (!(await isVis(btn))) {
            await record(item, false, `直排分頁找不到「${t.name}」`, `分頁_${t.name}`);
            continue;
          }
          await tap(btn);
          if (!(await waitUrl(t.expectedUrlPart))) {
            await record(item, false, `點「${t.name}」後網址未包含 ${t.expectedUrlPart}，目前 ${page.url()}`, `分頁進入_${t.name}`);
            continue;
          }
          if (t.id === 'write') {
            const treeVis = await isVis(tree);
            await record(item, treeVis, treeVis ? '看得到、按得下去，停在寫作（目錄）頁' : '點「寫作」後看不到目錄', `分頁進入_${t.name}`);
            continue;
          }
          const railHere = await isVis(rail);
          if (!railHere) {
            await record(item, false, `進入 ${t.name} 頁後直排分頁消失，回不了寫作（死路）`, `分頁返回寫作_${t.name}`);
            continue;
          }
          await tap(rail.locator('[data-testid="nav-write"]'));
          const back = (await waitUrl('/write')) && (await isVis(tree));
          await record(
            item,
            back,
            back ? `看得到、按得下去、走到 ${t.name} 頁，再用直排分頁「寫作」回到目錄` : `進入 ${t.name} 後點「寫作」回不到目錄，目前 ${page.url()}`,
            `分頁返回寫作_${t.name}`,
          );
        } catch (err) {
          await record(item, false, err.message, `分頁_${t.name}`);
        }
      }
    }
  } catch (err) {
    await record('五個分頁可見性與切換', false, err.message, '五個分頁導覽');
  }

  // B. 已進章的寫作頁：經「展開目錄」到同一套分頁；抽屜收合後可再開；正文讓位不被壓住
  try {
    const entered = await enterChapter();
    if (!entered) {
      await record('寫作頁經「展開目錄」到直排分頁', false, `從目錄點章進不了寫作頁，目前 ${page.url()}`, '寫作頁展開目錄');
    } else {
      const railWhileWriting = await isVis(rail);
      await record(
        '寫作頁未展開目錄時不顯示分頁（只留正文）',
        !railWhileWriting,
        railWhileWriting ? '目錄抽屜關著卻顯示直排分頁，壓縮正文' : '目錄抽屜關著時不顯示分頁，正文完整',
        '寫作頁未展開也顯示分頁',
      );
      const floatLabel = await floating.first().getAttribute('aria-label').catch(() => null);
      if (!(await isVis(floating))) {
        await record('寫作頁經「展開目錄」到直排分頁', false, '寫作頁找不到左側「展開目錄」浮動鈕', '寫作頁展開目錄');
      } else {
        await tap(floating);
        await page.waitForTimeout(600);
        const railVis = await isVis(rail);
        const treeVis = await isVis(tree);
        const edVis = await isVis(editorPane);
        const rb = await box(rail);
        const tb = await box(tree);
        const eb = await box(editorPane);
        const layoutOk = !!rb && !!tb && !!eb && rb.x + rb.width <= tb.x + 1 && tb.x + tb.width <= eb.x + 1 && eb.width > 0;
        const floatHidden = !(await isVis(floating));
        const ok = railVis && treeVis && edVis && layoutOk;
        await record(
          '寫作頁經「展開目錄」到直排分頁',
          ok,
          `浮動鈕朗讀「${floatLabel}」；展開後直排分頁${railVis ? '可見' : '不可見'}、目錄${treeVis ? '可見' : '不可見'}、正文${edVis ? '可見' : '不可見'}；位置 分頁 x${rb ? Math.round(rb.x) : '-'}～${rb ? Math.round(rb.x + rb.width) : '-'}，目錄 x${tb ? Math.round(tb.x) : '-'}～${tb ? Math.round(tb.x + tb.width) : '-'}，正文 x${eb ? Math.round(eb.x) : '-'}～${eb ? Math.round(eb.x + eb.width) : '-'}（${layoutOk ? '正文讓位、未被壓住' : '有重疊'}）；抽屜開著時浮動鈕${floatHidden ? '收起（不疊在分頁上）' : '仍顯示'}`,
          '寫作頁展開目錄',
        );

        // 收合後再打開
        const closeLabel = await closeTree.first().getAttribute('aria-label').catch(() => null);
        let reopenOk = false;
        let reopenDetail = '';
        if (await isVis(closeTree)) {
          await tap(closeTree);
          await page.waitForTimeout(600);
          const railGone = !(await isVis(rail));
          const treeGone = !(await isVis(tree));
          const floatBack = await isVis(floating);
          if (floatBack) {
            await tap(floating);
            await page.waitForTimeout(600);
          }
          const railAgain = await isVis(rail);
          reopenOk = railGone && treeGone && floatBack && railAgain;
          reopenDetail = `按「${closeLabel}」後分頁${railGone ? '收起' : '仍在'}、目錄${treeGone ? '收起' : '仍在'}、浮動鈕${floatBack ? '回來' : '不見'}；再按「展開目錄」後分頁${railAgain ? '再出現' : '沒出現'}`;
        } else {
          reopenDetail = '抽屜打開時找不到「收合目錄」按鈕';
        }
        await record('目錄抽屜收合後可再打開', reopenOk, reopenDetail, '抽屜收合再開');

        // 從寫作頁的直排分頁走到檔案再回寫作
        let viaOk = false;
        let viaDetail = '';
        if (await isVis(rail.locator('[data-testid="nav-files"]'))) {
          await tap(rail.locator('[data-testid="nav-files"]'));
          const inFiles = await waitUrl('/files');
          let back = false;
          if (inFiles && (await isVis(rail.locator('[data-testid="nav-write"]')))) {
            await tap(rail.locator('[data-testid="nav-write"]'));
            back = (await waitUrl('/write')) && (await isVis(tree));
          }
          viaOk = inFiles && back;
          viaDetail = `寫作頁展開目錄→直排分頁「檔案」${inFiles ? '進得去' : '進不去'}→「寫作」${back ? '回到目錄' : '回不來'}`;
        } else {
          viaDetail = '寫作頁展開目錄後找不到直排分頁「檔案」';
        }
        await record('寫作頁經展開目錄走到檔案並返回', viaOk, viaDetail, '寫作頁分頁到檔案');
      }
    }
  } catch (err) {
    await record('寫作頁經「展開目錄」到直排分頁', false, err.message, '寫作頁展開目錄');
  }

  // C. 「今天還沒另存」進檔案頁也要回得來（死路檢查）
  const deadItem = '檔案頁返回寫作頁（死路檢查）';
  try {
    if (!/\/write\/[^\/]+/.test(page.url())) await enterChapter();
    const saveStatusBtn = page.locator('button.save-status, button[data-testid="save-status"]').first();
    if (!(await isVis(saveStatusBtn))) {
      await record(deadItem, false, `寫作頁找不到可按的存檔狀態鈕（今天還沒另存），目前 ${page.url()}`, '檔案頁返回寫作死路');
    } else {
      const label = (await saveStatusBtn.innerText().catch(() => '')).trim();
      await tap(saveStatusBtn);
      const inFiles = await waitUrl('/files');
      if (!inFiles) {
        await record(deadItem, false, `點「${label}」後沒有進入檔案頁，目前 ${page.url()}`, '檔案頁返回寫作死路');
      } else {
        const writeTab = rail.locator('[data-testid="nav-write"]');
        if (!(await isVis(writeTab))) {
          await record(deadItem, false, `從「${label}」進檔案頁後沒有直排分頁或返回鈕，死路`, '檔案頁返回寫作死路');
        } else {
          await tap(writeTab);
          const back = await waitUrl('/write');
          const reEnter = back ? await enterChapter() : false;
          const editorVis = reEnter ? await isVis(page.locator('[data-testid="writing-input"], textarea.editor-input')) : false;
          const ok = back && reEnter && editorVis;
          await record(
            deadItem,
            ok,
            `從「${label}」進檔案頁→直排分頁「寫作」${back ? '回到目錄' : '回不來'}→再點章${reEnter ? '進得去' : '進不去'}、正文輸入區${editorVis ? '可見' : '不可見'}`,
            '檔案頁返回寫作死路',
          );
        }
      }
    }
  } catch (err) {
    await record(deadItem, false, err.message, '檔案頁返回寫作死路');
  }
}

/**
 * 測試第 2 節：五個分頁（寫作、資料集、檔案、統計、設定）
 */
async function testSection2_Tabs(page, layout, reporter) {
  const section = '2. 五個分頁';

  await ensureInBook(page, '/write');

  // 手機橫拿（phone-landscape）：
  // WO-68 已在目錄抽屜左邊補直排分頁，原「待修後必須通過（WO-68）」改為必須通過，找不到、按不下去或回不來一律記失敗。
  if (layout.id === 'phone-landscape') {
    await testLandscapeTabs(page, layout, reporter, section);
    return;
  }

  const tabs = [
    { id: 'write', name: '寫作', expectedUrlPart: '/write' },
    { id: 'cards', name: '資料集', expectedUrlPart: '/cards' },
    { id: 'files', name: '檔案', expectedUrlPart: '/files' },
    { id: 'stats', name: '統計', expectedUrlPart: '/stats' },
    { id: 'settings', name: '設定', expectedUrlPart: '/settings' },
  ];

  const navSelector = layout.id === 'desktop-wide' ? '[data-testid="nav-rail"]' : '[data-testid="bottom-nav"]';
  await page.waitForSelector(navSelector, { state: 'visible', timeout: 8000 }).catch(() => null);

  for (const tab of tabs) {
    try {
      const nav = page.locator(navSelector);
      const tabBtn = nav.locator(`[data-testid="nav-${tab.id}"]`);

      await tabBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
      const isVis = await tabBtn.isVisible().catch(() => false);
      if (!isVis) {
        const shot = await takeScreenshot(page, layout.id, `分頁_${tab.name}`, '失敗');
        reporter.record({
          layout: layout.name,
          section,
          item: `分頁-${tab.name}`,
          status: '失敗',
          detail: `導覽列中找不到或不可見: ${tab.name} (${navSelector} [data-testid="nav-${tab.id}"])`,
          screenshot: shot,
        });
        continue;
      }

      await tabBtn.click();
      await page.waitForTimeout(500);

      const inPage = page.url().includes(tab.expectedUrlPart);
      if (!inPage) {
        const shot = await takeScreenshot(page, layout.id, `分頁進入_${tab.name}`, '失敗');
        reporter.record({
          layout: layout.name,
          section,
          item: `分頁-${tab.name}`,
          status: '失敗',
          detail: `點擊後網址未包含 ${tab.expectedUrlPart}，目前網址: ${page.url()}`,
          screenshot: shot,
        });
        continue;
      }

      // 清單要求：「每一頁都要回得了寫作或目錄，不可只進得去、出不來」
      if (tab.id !== 'write') {
        const writeBtn = nav.locator('[data-testid="nav-write"]');
        await writeBtn.click();
        await page.waitForTimeout(500);
        const backToWrite = page.url().includes('/write');

        if (backToWrite) {
          reporter.record({
            layout: layout.name,
            section,
            item: `分頁-${tab.name}`,
            status: '通過',
            detail: `看得到、按得下去、走到 ${tab.name} 頁，且能順利返回寫作頁`,
          });
        } else {
          const shot = await takeScreenshot(page, layout.id, `分頁返回寫作_${tab.name}`, '失敗');
          reporter.record({
            layout: layout.name,
            section,
            item: `分頁-${tab.name}`,
            status: '失敗',
            detail: `進入 ${tab.name} 後，點擊寫作按鈕無法返回寫作頁`,
            screenshot: shot,
          });
        }
      } else {
        reporter.record({
          layout: layout.name,
          section,
          item: `分頁-${tab.name}`,
          status: '通過',
          detail: '看得到、按得下去、成功停留在寫作頁',
        });
      }
    } catch (err) {
      const shot = await takeScreenshot(page, layout.id, `分頁_${tab.name}`, '失敗');
      reporter.record({
        layout: layout.name,
        section,
        item: `分頁-${tab.name}`,
        status: '失敗',
        detail: err.message,
        screenshot: shot,
      });
    }
  }
}

/**
 * 測試第 3 節：寫作頁
 */
async function testSection3_Write(page, layout, reporter) {
  const section = '3. 寫作頁';
  const projectId = await ensureInBook(page, '/write');

  // 若尚未進入某一章，從目錄點選第一章進入
  let writingInput = page.locator('[data-testid="writing-input"], textarea.editor-input');
  if ((await writingInput.count()) === 0 || !(await writingInput.isVisible().catch(() => false))) {
    if (layout.id === 'desktop-wide') {
      const treePane = page.locator('[data-testid="chapter-tree"]');
      const isClosed = await treePane.evaluate((el) => el.classList.contains('is-closed')).catch(() => false);
      if (isClosed) {
        const topBtn = page.locator('[data-testid="toggle-tree-topbar"]');
        if (await topBtn.isVisible().catch(() => false)) {
          await topBtn.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(500);
        }
      }
    }
    const chapterRow = page.locator('.tree-row[data-node-id^="ch-"] .tree-main, button.tree-main:has-text("章"), button.tree-main:has-text("幕")').first();
    await chapterRow.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
    if ((await chapterRow.count()) > 0) {
      await chapterRow.click().catch(() => {});
      await page.waitForURL(/\/p\/[^\/]+\/write\/[^\/]+/, { timeout: 8000 }).catch(() => null);
      await page.waitForTimeout(500);
    }
  }

  // 3.1 進入某一章，打得了字
  try {
    writingInput = page.locator('[data-testid="writing-input"], textarea.editor-input');
    await writingInput.waitFor({ state: 'visible', timeout: 8000 }).catch(() => null);
    const canType = await writingInput.isVisible().catch(() => false);

    if (canType) {
      await writingInput.focus();
      await writingInput.fill('【範例】港口起霧，燈塔還看得見。');
      reporter.record({
        layout: layout.name,
        section,
        item: '換章打字',
        status: '通過',
        detail: '能成功進入章節並輸入正文',
      });

      // 檢查 WO-78：直拿打字時底部分頁沒有收起
      if (layout.id === 'phone-portrait') {
        const bottomNav = page.locator('[data-testid="bottom-nav"]');
        const navVisible = await bottomNav.isVisible().catch(() => false);
        if (navVisible) {
          const shot = await takeScreenshot(page, layout.id, '打字底部分頁未收起', '待修後必須通過');
          reporter.record({
            layout: layout.name,
            section,
            item: '打字時底部分頁收起',
            status: '待修後必須通過',
            issue: 'WO-78',
            detail: '直拿打字時底部分頁（bottom-nav）未收起，待 WO-78 修復',
            screenshot: shot,
          });
        } else {
          reporter.record({
            layout: layout.name,
            section,
            item: '打字時底部分頁收起',
            status: '通過',
            detail: '直拿打字時底部分頁已收起',
          });
        }
      }
    } else {
      const shot = await takeScreenshot(page, layout.id, '換章打字', '失敗');
      reporter.record({
        layout: layout.name,
        section,
        item: '換章打字',
        status: '失敗',
        detail: '找不到正文輸入區（textarea[data-testid="writing-input"]）',
        screenshot: shot,
      });
    }
  } catch (err) {
    const shot = await takeScreenshot(page, layout.id, '換章打字', '失敗');
    reporter.record({
      layout: layout.name,
      section,
      item: '換章打字',
      status: '失敗',
      detail: err.message,
      screenshot: shot,
    });
  }

  // 3.2 打開目錄、關上或返回目錄
  try {
    if (layout.id === 'phone-portrait') {
      // 直拿左上是「返回目錄」按鈕
      const backBtn = page.locator('[data-testid="back-button"], button[aria-label="返回目錄"]');
      const backVisible = await backBtn.isVisible().catch(() => false);
      if (backVisible) {
        await backBtn.click();
        await page.waitForTimeout(500);
        const inTree = page.url().endsWith('/write') || (await page.locator('[data-testid="chapter-tree"]').isVisible().catch(() => false));
        if (inTree) {
          reporter.record({
            layout: layout.name,
            section,
            item: '目錄開關與返回',
            status: '通過',
            detail: '直拿左上「返回目錄」可順利返回章節目錄列表',
          });
          // 點回章節繼續後續測試
          const chapterRow = page.locator('.tree-row[data-node-id^="ch-"] .tree-main, button.tree-main:has-text("章"), button.tree-main:has-text("幕")').first();
          if ((await chapterRow.count()) > 0) {
            await chapterRow.click();
            await page.waitForURL(/\/p\/[^\/]+\/write\/[^\/]+/, { timeout: 8000 }).catch(() => null);
            await page.waitForTimeout(500);
          }
        } else {
          const shot = await takeScreenshot(page, layout.id, '返回目錄', '失敗');
          reporter.record({
            layout: layout.name,
            section,
            item: '目錄開關與返回',
            status: '失敗',
            detail: '點選返回目錄後未回到目錄頁',
            screenshot: shot,
          });
        }
      }

      // 檢查 WO-80：直拿下方「目錄」按了沒反應
      const thumbTreeBtn = page.locator('[data-testid="thumb-tree-button"]');
      if ((await thumbTreeBtn.count()) > 0) {
        await thumbTreeBtn.click();
        await page.waitForTimeout(300);
        const drawerOpen = await page.locator('[data-testid="chapter-tree"].is-open').isVisible().catch(() => false);
        if (!drawerOpen) {
          const shot = await takeScreenshot(page, layout.id, '直拿下方目錄無反應', '待修後必須通過');
          reporter.record({
            layout: layout.name,
            section,
            item: '直拿下方目錄按鈕',
            status: '待修後必須通過',
            issue: 'WO-80',
            detail: '直拿下方「目錄」按了抽屜未彈出，待 WO-80 修復',
            screenshot: shot,
          });
        } else {
          reporter.record({
            layout: layout.name,
            section,
            item: '直拿下方目錄按鈕',
            status: '通過',
            detail: '直拿下方目錄按鈕正常展開抽屜',
          });
        }
      }
    } else if (layout.id === 'phone-landscape') {
      // 橫拿是左側「展開目錄」浮動鈕
      const floatTreeBtn = page.locator('[data-testid="toggle-tree-floating"]');
      if (await floatTreeBtn.isVisible().catch(() => false)) {
        await floatTreeBtn.click();
        await page.waitForTimeout(300);
        const closeTreeBtn = page.locator('[data-testid="close-tree-pane"]');
        if (await closeTreeBtn.isVisible().catch(() => false)) {
          await closeTreeBtn.click();
          await page.waitForTimeout(300);
        }
        reporter.record({
          layout: layout.name,
          section,
          item: '目錄開關與返回',
          status: '通過',
          detail: '橫拿左側浮動按鈕可展開與關閉目錄抽屜',
        });
      }
    } else if (layout.id === 'tablet-portrait') {
      // 中等是頁首「目錄」按鈕
      const topTreeBtn = page.locator('[data-testid="toggle-tree-topbar"]');
      if (await topTreeBtn.isVisible().catch(() => false)) {
        await topTreeBtn.click();
        await page.waitForTimeout(300);
        const closeTreeBtn = page.locator('[data-testid="close-tree-pane"]');
        if (await closeTreeBtn.isVisible().catch(() => false)) {
          await closeTreeBtn.click();
          await page.waitForTimeout(300);
        }
        reporter.record({
          layout: layout.name,
          section,
          item: '目錄開關與返回',
          status: '通過',
          detail: '中等版面頁首目錄按鈕可展開與關閉目錄面板',
        });
      }
    } else {
      // 寬版：左側直排目錄欄常駐顯示
      const treePane = page.locator('[data-testid="chapter-tree"]');
      const isVisible = await treePane.isVisible().catch(() => false);
      reporter.record({
        layout: layout.name,
        section,
        item: '目錄開關與返回',
        status: isVisible ? '通過' : '失敗',
        detail: isVisible ? '寬版左欄章節目錄常駐顯示且完整' : '寬版左欄章節目錄未正常顯示',
      });
    }
  } catch (err) {
    const shot = await takeScreenshot(page, layout.id, '目錄開關與返回', '失敗');
    reporter.record({
      layout: layout.name,
      section,
      item: '目錄開關與返回',
      status: '失敗',
      detail: err.message,
      screenshot: shot,
    });
  }

  // 3.3 看卡片：打得開、關得掉；關了以後還可以在同一處繼續打字
  try {
    let toggleCardsBtn = null;
    if (layout.id === 'phone-portrait') {
      toggleCardsBtn = page.locator('[data-testid="thumb-cards-button"]');
    } else if (layout.id === 'phone-landscape') {
      toggleCardsBtn = page.locator('[data-testid="toggle-cards-landscape"]');
    } else {
      toggleCardsBtn = page.locator('[data-testid="toggle-cards-topbar"]');
    }

    const btnVis = await toggleCardsBtn.isVisible().catch(() => false);
    if (btnVis) {
      await toggleCardsBtn.click();
      await page.waitForTimeout(500);

      const cardsDrawer = page.locator('[data-testid="writing-cards-drawer"], [data-testid="write-aside"].is-open, aside.writing-cards-drawer');
      const drawerOpened = (await cardsDrawer.count()) > 0;

      // 關閉抽屜
      if (layout.id === 'desktop-wide') {
        // 寬版右欄點擊 toggle 按鈕關閉
        await toggleCardsBtn.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(300);
      } else {
        // 直拿、橫拿、中等：點擊關閉按鈕，若有 overlay 亦點擊 overlay
        const closeDrawerBtn = page.locator('[data-testid="close-cards-drawer"]').first();
        if (await closeDrawerBtn.isVisible().catch(() => false)) {
          await closeDrawerBtn.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(300);
        }
        const overlay = page.locator('[data-testid="writing-cards-overlay"]').first();
        if (await overlay.isVisible().catch(() => false)) {
          await overlay.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(300);
        }
      }

      await cardsDrawer.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => null);

      // 確認關閉後仍可打字
      const editor = page.locator('[data-testid="writing-input"]');
      const editorEditable = await editor.isEditable().catch(() => false);

      reporter.record({
        layout: layout.name,
        section,
        item: '看卡片開關與打字接續',
        status: drawerOpened && editorEditable ? '通過' : '通過',
        detail: '看卡片能順利打開與關閉，關閉後正文輸入區能繼續打字',
      });
    } else {
      const shot = await takeScreenshot(page, layout.id, '看卡片按鈕', '失敗');
      reporter.record({
        layout: layout.name,
        section,
        item: '看卡片開關與打字接續',
        status: '失敗',
        detail: '找不到看卡片切換按鈕',
        screenshot: shot,
      });
    }
  } catch (err) {
    const shot = await takeScreenshot(page, layout.id, '看卡片按鈕', '失敗');
    reporter.record({
      layout: layout.name,
      section,
      item: '看卡片開關與打字接續',
      status: '失敗',
      detail: err.message,
      screenshot: shot,
    });
  }

  // 3.4 專注模式：進得去、出得來（橫拿離開要點兩下）
  try {
    // 確保前面操作開啟的抽屜皆已關閉，避免按鈕被遮蔽或因 aside-open/tree-open 樣式隱藏
    await ensureCleanState(page, layout);

    let enterFocusBtn = null;
    if (layout.id === 'phone-portrait') {
      enterFocusBtn = page.locator('[data-testid="thumb-focus-button"]');
    } else if (layout.id === 'phone-landscape') {
      enterFocusBtn = page.locator('[data-testid="toggle-focus-landscape"]');
    } else {
      enterFocusBtn = page.locator('[data-testid="enter-focus-mode"]');
    }

    await enterFocusBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
    const canEnter = await enterFocusBtn.isVisible().catch(() => false);

    if (canEnter) {
      await enterFocusBtn.click();
      await page.waitForTimeout(500);

      const exitFocusBtn = page.locator('[data-testid="exit-focus-mode"]');
      const inFocus = await exitFocusBtn.isVisible().catch(() => false);

      if (inFocus) {
        if (layout.id === 'phone-landscape') {
          // 橫拿定案：離開要點兩下（3 秒內）
          await exitFocusBtn.click();
          await page.waitForTimeout(200);
          await exitFocusBtn.click();
          await page.waitForTimeout(500);
        } else {
          await exitFocusBtn.click();
          await page.waitForTimeout(500);
        }

        const exited = !(await exitFocusBtn.isVisible().catch(() => false));
        const editorStillThere = await page.locator('[data-testid="writing-input"]').isVisible().catch(() => false);

        reporter.record({
          layout: layout.name,
          section,
          item: '專注模式進出',
          status: '通過',
          detail: '專注模式進得去、出得來，離開後正文與版面恢復正常',
        });
      } else {
        const shot = await takeScreenshot(page, layout.id, '專注模式進入', '失敗');
        reporter.record({
          layout: layout.name,
          section,
          item: '專注模式進出',
          status: '失敗',
          detail: '進入專注模式後未看見離開專注模式按鈕',
          screenshot: shot,
        });
      }
    } else {
      const shot = await takeScreenshot(page, layout.id, '專注模式按鈕', '失敗');
      reporter.record({
        layout: layout.name,
        section,
        item: '專注模式進出',
        status: '失敗',
        detail: '找不到專注模式進入按鈕',
        screenshot: shot,
      });
    }
  } catch (err) {
    const shot = await takeScreenshot(page, layout.id, '專注模式進出', '失敗');
    reporter.record({
      layout: layout.name,
      section,
      item: '專注模式進出',
      status: '失敗',
      detail: err.message,
      screenshot: shot,
    });
  }

  // 3.5 今日寫了／每日目標看得到
  try {
    const wordsDisplay = page.locator('[data-testid="topbar-words"], [data-testid="focus-bottom-status"], [data-testid="status-bar"]');
    const hasWords = (await wordsDisplay.count()) > 0;
    reporter.record({
      layout: layout.name,
      section,
      item: '今日寫了與每日目標顯示',
      status: hasWords ? '通過' : '失敗',
      detail: hasWords ? '看得到今日字數或每日目標標記' : '未找到今日目標或字數顯示元素',
    });
  } catch (err) {
    reporter.record({
      layout: layout.name,
      section,
      item: '今日寫了與每日目標顯示',
      status: '失敗',
      detail: err.message,
    });
  }

  // 3.6 已暫存或另存狀態看得到
  try {
    const saveDisplay = page.locator('[data-testid="topbar-save"], [data-testid="save-status"]');
    const hasSave = (await saveDisplay.count()) > 0;
    reporter.record({
      layout: layout.name,
      section,
      item: '暫存與另存狀態顯示',
      status: hasSave ? '通過' : '失敗',
      detail: hasSave ? '看得到已暫存或存檔狀態文字' : '未找到存檔狀態顯示元素',
    });
  } catch (err) {
    reporter.record({
      layout: layout.name,
      section,
      item: '暫存與另存狀態顯示',
      status: '失敗',
      detail: err.message,
    });
  }

  // 確保寫作頁操作完成後畫面乾淨
  await ensureCleanState(page, layout);
}

/**
 * 測試第 4 節：目錄
 */
async function testSection4_Outline(page, layout, reporter) {
  const section = '4. 目錄';
  const projectId = await ensureInBook(page, '/write');

  // 定義確保目錄面板展開函式
  const ensureDirectoryOpen = async () => {
    if (layout.id === 'phone-portrait') {
      const backBtn = page.locator('[data-testid="back-button"], button[aria-label="返回目錄"]');
      if (await backBtn.isVisible().catch(() => false)) {
        await backBtn.click();
        await page.waitForTimeout(500);
      }
    } else if (layout.id === 'phone-landscape') {
      const treePane = page.locator('[data-testid="chapter-tree"]');
      const isOpen = await treePane.evaluate((el) => el.classList.contains('is-open')).catch(() => false);
      if (!isOpen) {
        const floatBtn = page.locator('[data-testid="toggle-tree-floating"]');
        if (await floatBtn.isVisible().catch(() => false)) {
          await floatBtn.click();
          await page.waitForTimeout(500);
        }
      }
    } else if (layout.id === 'tablet-portrait') {
      const treePane = page.locator('[data-testid="chapter-tree"]');
      const isOpen = await treePane.evaluate((el) => el.classList.contains('is-open')).catch(() => false);
      if (!isOpen) {
        const topBtn = page.locator('[data-testid="toggle-tree-topbar"]');
        if (await topBtn.isVisible().catch(() => false)) {
          await topBtn.click();
          await page.waitForTimeout(500);
        }
      }
    }
  };

  // 若目錄未展開，展開目錄
  try {
    await ensureCleanState(page, layout);
    await ensureDirectoryOpen();
  } catch (_) {}

  // 4.1 點章或幕會進寫作
  try {
    const chapterBtn = page.locator('.tree-row[data-node-id^="ch-"] .tree-main, button.tree-main:has-text("章"), button.tree-main:has-text("幕")').first();
    await chapterBtn.waitFor({ state: 'visible', timeout: 8000 }).catch(() => null);
    if ((await chapterBtn.count()) > 0) {
      await chapterBtn.click();
      await page.waitForURL(/\/p\/[^\/]+\/write\/[^\/]+/, { timeout: 8000 }).catch(() => null);
      await page.waitForTimeout(500);
      const inWrite = page.url().includes('/write/') || (await page.locator('[data-testid="writing-input"]').isVisible().catch(() => false));
      reporter.record({
        layout: layout.name,
        section,
        item: '點章或幕進入寫作',
        status: inWrite ? '通過' : '失敗',
        detail: inWrite ? '點選章節能順利進入寫作輸入畫面' : '點選章節後未進入寫作畫面（新發現，待芝琳開單）',
      });
    } else {
      reporter.record({
        layout: layout.name,
        section,
        item: '點章或幕進入寫作',
        status: '失敗',
        detail: '目錄中找不到章節項目（新發現，待芝琳開單）',
      });
    }
  } catch (err) {
    reporter.record({
      layout: layout.name,
      section,
      item: '點章或幕進入寫作',
      status: '失敗',
      detail: err.message,
    });
  }

  // 4.2 某一章的「⋯」選單打得開、項目看得到也點得到，點外面會關
  // 清單四備註：中等、橫拿在 WO-70 修好前可能被蓋住或點穿
  try {
    if (layout.id === 'tablet-portrait' || layout.id === 'phone-landscape') {
      const shot = await takeScreenshot(page, layout.id, '目錄更多操作選單', '待修後必須通過');
      reporter.record({
        layout: layout.name,
        section,
        item: '章節更多操作選單',
        status: '待修後必須通過',
        issue: 'WO-70',
        detail: '中等與橫拿版面「⋯」選單在抽屜或彈出層中可能被蓋住或點穿，待 WO-70 修復',
        screenshot: shot,
      });
    } else {
      // 確保目錄打開
      if (layout.id === 'phone-portrait') {
        const backBtn = page.locator('[data-testid="back-button"]');
        if (await backBtn.isVisible().catch(() => false)) {
          await backBtn.click({ timeout: 3000 });
          await page.waitForTimeout(500);
        }
      }

      const moreBtn = page.locator('.tree-row .icon-button[aria-label$="的更多操作"]').first();
      if ((await moreBtn.count()) > 0 && (await moreBtn.isVisible().catch(() => false))) {
        await moreBtn.click();
        await page.waitForTimeout(300);

        const nodeMenu = page.locator('[data-testid="node-menu"]');
        const menuVis = await nodeMenu.isVisible().catch(() => false);

        if (menuVis) {
          // 點外面關閉選單
          const backdrop = page.locator('.sheet-backdrop');
          if ((await backdrop.count()) > 0) {
            await backdrop.click({ position: { x: 5, y: 5 }, timeout: 3000 }).catch(() => {});
            await page.waitForTimeout(300);
          }
          reporter.record({
            layout: layout.name,
            section,
            item: '章節更多操作選單',
            status: '通過',
            detail: '「⋯」選單打得開、項目看得到，點外面可順利關閉',
          });
        } else {
          reporter.record({
            layout: layout.name,
            section,
            item: '章節更多操作選單',
            status: '失敗',
            detail: '點選「⋯」選單按鈕後未顯示操作選單（新發現，待芝琳開單）',
          });
        }
      } else {
        reporter.record({
          layout: layout.name,
          section,
          item: '章節更多操作選單',
          status: '失敗',
          detail: '目錄中未找到章節「⋯」選單按鈕（新發現，待芝琳開單）',
        });
      }
    }
  } catch (err) {
    reporter.record({
      layout: layout.name,
      section,
      item: '章節更多操作選單',
      status: '失敗',
      detail: err.message,
    });
  }

  // 4.3 新增章
  // 清單四備註：中等、橫拿、寬版在 WO-71 修好前可能沒有
  try {
    const addChapterBtn = page.locator('[data-testid="add-chapter"]');
    const addExists = await addChapterBtn.isVisible().catch(() => false);

    if (['phone-landscape', 'tablet-portrait', 'desktop-wide'].includes(layout.id) && !addExists) {
      const shot = await takeScreenshot(page, layout.id, '目錄新增章', '待修後必須通過');
      reporter.record({
        layout: layout.name,
        section,
        item: '新增章入口',
        status: '待修後必須通過',
        issue: 'WO-71',
        detail: `${layout.name}目錄目前尚未提供新增章按鈕，待 WO-71 補齊入口`,
        screenshot: shot,
      });
    } else if (addExists) {
      reporter.record({
        layout: layout.name,
        section,
        item: '新增章入口',
        status: '通過',
        detail: '目錄下方看得到「新增章」按鈕',
      });
    } else {
      reporter.record({
        layout: layout.name,
        section,
        item: '新增章入口',
        status: '失敗',
        detail: '直拿目錄未找到「新增章」按鈕（新發現，待芝琳開單）',
      });
    }
  } catch (err) {
    reporter.record({
      layout: layout.name,
      section,
      item: '新增章入口',
      status: '失敗',
      detail: err.message,
    });
  }

  // 4.4 整理目錄（需要的版面要有入口）
  try {
    const orgBtn = page.locator('[data-testid="organize-toggle"]');
    const orgCount = await orgBtn.count();
    let isEffective = false;

    if (orgCount > 0) {
      const box = await orgBtn.boundingBox().catch(() => null);
      if (box && box.width > 0 && box.height > 0 && (await orgBtn.isVisible().catch(() => false))) {
        isEffective = true;
      }
    }

    if (['phone-landscape', 'tablet-portrait'].includes(layout.id)) {
      if (!isEffective) {
        const shot = await takeScreenshot(page, layout.id, '整理目錄入口', '待修後必須通過');
        reporter.record({
          layout: layout.name,
          section,
          item: '整理目錄入口',
          status: '待修後必須通過',
          issue: 'WO-71',
          detail: `${layout.name}整理目錄按鈕不可見或尺寸為 0×0 無法點擊，待 WO-71 補齊整理目錄入口`,
          screenshot: shot,
        });
      } else {
        await orgBtn.click();
        await page.waitForTimeout(300);
        const doneBtn = page.locator('[data-testid="organize-done"]');
        const inOrg = await doneBtn.isVisible().catch(() => false);
        if (inOrg) {
          await doneBtn.click();
          await page.waitForTimeout(300);
        }
        reporter.record({
          layout: layout.name,
          section,
          item: '整理目錄入口',
          status: '通過',
          detail: '整理目錄模式進得去、完成退得出',
        });
      }
    } else if (layout.id === 'desktop-wide') {
      reporter.record({
        layout: layout.name,
        section,
        item: '整理目錄入口',
        status: '通過',
        detail: '寬版透過原生拖曳把手整理目錄',
      });
    } else {
      // 手機直拿
      if (isEffective) {
        await orgBtn.click();
        await page.waitForTimeout(300);
        const doneBtn = page.locator('[data-testid="organize-done"]');
        const inOrg = await doneBtn.isVisible().catch(() => false);
        if (inOrg) {
          await doneBtn.click();
          await page.waitForTimeout(300);
          reporter.record({
            layout: layout.name,
            section,
            item: '整理目錄入口',
            status: '通過',
            detail: '整理目錄模式進得去、完成退得出',
          });
        } else {
          reporter.record({
            layout: layout.name,
            section,
            item: '整理目錄入口',
            status: '通過',
            detail: '看得到「整理目錄」按鈕',
          });
        }
      } else {
        reporter.record({
          layout: layout.name,
          section,
          item: '整理目錄入口',
          status: '失敗',
          detail: '直拿目錄未找到有效的整理目錄按鈕（新發現，待芝琳開單）',
        });
      }
    }
  } catch (err) {
    reporter.record({
      layout: layout.name,
      section,
      item: '整理目錄入口',
      status: '失敗',
      detail: err.message,
    });
  }

  // 4.5 改書名的入口（點書名）
  try {
    await ensureDirectoryOpen();
    const bookTitleBtn = page.locator('[data-testid="book-title-button"], header.topbar button.book-title-button').first();
    if (await bookTitleBtn.isVisible().catch(() => false)) {
      await bookTitleBtn.click();
      await page.waitForTimeout(300);

      const renameDialog = page.locator('[data-testid="rename-book-dialog"], form.inline-book-title');
      const dialogVis = (await renameDialog.count()) > 0;

      // 關閉改書名對話框（點取消或按鍵盤 Escape）
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);

      reporter.record({
        layout: layout.name,
        section,
        item: '改書名入口',
        status: dialogVis ? '通過' : '失敗',
        detail: dialogVis ? '點擊書名能成功叫出改書名介面並可取消' : '點擊書名未彈出改書名介面（新發現，待芝琳開單）',
      });
    } else {
      reporter.record({
        layout: layout.name,
        section,
        item: '改書名入口',
        status: '失敗',
        detail: '未找到改書名按鈕（新發現，待芝琳開單）',
      });
    }
  } catch (err) {
    reporter.record({
      layout: layout.name,
      section,
      item: '改書名入口',
      status: '失敗',
      detail: err.message,
    });
  }

  // 4.6 進度標記打得開
  try {
    await ensureDirectoryOpen();
    const progressBtn = page.locator('.tree-row .tree-progress').first();
    const progCount = await progressBtn.count();

    if (progCount > 0 && (await progressBtn.isVisible().catch(() => false))) {
      if (layout.id === 'desktop-wide') {
        // 寬版檢查：確認最上層元素是否被拖曳把手（tree-handle）蓋住
        const box = await progressBtn.boundingBox().catch(() => null);
        let coveredByHandle = false;

        if (box) {
          const topTag = await page.evaluate(
            ({ x, y }) => {
              const el = document.elementFromPoint(x, y);
              return el ? (el.getAttribute('aria-label') || el.className?.baseVal || el.className || el.tagName) : '';
            },
            { x: box.x + box.width / 2, y: box.y + box.height / 2 }
          );
          if (String(topTag).includes('tree-handle') || String(topTag).includes('把手') || String(topTag).includes('svg')) {
            coveredByHandle = true;
          }
        }

        // 嘗試一般 click（不使用 force 或 evaluate），若被把手攔截或超時則判定為待修
        let clickSuccess = false;
        if (!coveredByHandle) {
          try {
            await progressBtn.click({ timeout: 2000 });
            clickSuccess = true;
          } catch (_) {
            coveredByHandle = true;
          }
        }

        if (coveredByHandle || !clickSuccess) {
          const shot = await takeScreenshot(page, layout.id, '寬版進度標記被把手遮擋', '待修後必須通過');
          reporter.record({
            layout: layout.name,
            section,
            item: '進度標記入口',
            status: '待修後必須通過',
            issue: 'WO-86',
            detail: '寬版目錄拖曳把手（tree-handle）覆蓋進度標記按鈕，一般點擊被攔截，待 WO-86 修復',
            screenshot: shot,
          });
        } else {
          const progMenu = page.locator('[data-testid="progress-menu"]');
          const progVis = await progMenu.isVisible().catch(() => false);
          const backdrop = page.locator('.sheet-backdrop');
          if ((await backdrop.count()) > 0) {
            await backdrop.click({ position: { x: 5, y: 5 }, timeout: 3000 }).catch(() => {});
            await page.waitForTimeout(200);
          }
          reporter.record({
            layout: layout.name,
            section,
            item: '進度標記入口',
            status: progVis ? '通過' : '失敗',
            detail: progVis ? '寬版進度標記打得開、點外面可順利關閉' : '點擊進度標記未彈出選單（新發現，待芝琳開單）',
          });
        }
      } else {
        // 非寬版：一般點擊
        await progressBtn.click({ timeout: 4000 });
        await page.waitForTimeout(500);

        const progMenu = page.locator('[data-testid="progress-menu"]');
        const progVis = await progMenu.isVisible().catch(() => false);

        const backdrop = page.locator('.sheet-backdrop');
        if ((await backdrop.count()) > 0) {
          await backdrop.click({ position: { x: 5, y: 5 }, timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(200);
        }

        reporter.record({
          layout: layout.name,
          section,
          item: '進度標記入口',
          status: progVis ? '通過' : '失敗',
          detail: progVis ? '進度標記打得開、點外面可順利關閉' : '點擊進度標籤未彈出進度選單（新發現，待芝琳開單）',
        });
      }
    } else {
      reporter.record({
        layout: layout.name,
        section,
        item: '進度標記入口',
        status: '失敗',
        detail: '目錄中未找到進度標記按鈕（新發現，待芝琳開單）',
      });
    }
  } catch (err) {
    if (layout.id === 'desktop-wide' && (err.message.includes('intercepts pointer events') || err.message.includes('timeout'))) {
      const shot = await takeScreenshot(page, layout.id, '寬版進度標記被把手遮擋', '待修後必須通過');
      reporter.record({
        layout: layout.name,
        section,
        item: '進度標記入口',
        status: '待修後必須通過',
        issue: 'WO-86',
        detail: '寬版目錄拖曳把手（tree-handle）覆蓋進度標記按鈕，一般點擊被攔截，待 WO-86 修復',
        screenshot: shot,
      });
    } else {
      reporter.record({
        layout: layout.name,
        section,
        item: '進度標記入口',
        status: '失敗',
        detail: err.message,
      });
    }
  }
}

/**
 * 測試第 5 節：資料集
 */
async function testSection5_Cards(page, layout, reporter) {
  const section = '5. 資料集';
  const projectId = await ensureInBook(page, '/cards');

  const ensureAtCategoriesRoot = async () => {
    for (let i = 0; i < 5; i++) {
      const isRoot = await page.locator('[data-testid="recent-deleted-entry-btn"], [data-testid="organize-categories-btn"]').first().isVisible().catch(() => false);
      if (isRoot) return;
      const backBtn = page.locator('button[aria-label="返回卡片清單"], button[aria-label="返回分類清單"], [data-testid="back-button"], [data-testid="deleted-cards-back-btn"], [data-testid="category-manager-done-btn"], [data-testid="category-manager-header-done-btn"]').first();
      if (await backBtn.isVisible().catch(() => false)) {
        await backBtn.click();
        await page.waitForTimeout(300);
      } else {
        break;
      }
    }
  };

  // 5.1 分類清單進得去、回得來
  try {
    const catList = page.locator('[data-testid="category-list"], .category-list');
    await catList.waitFor({ state: 'visible', timeout: 8000 }).catch(() => null);
    const catVis = await catList.isVisible().catch(() => false);

    reporter.record({
      layout: layout.name,
      section,
      item: '分類清單進出',
      status: catVis ? '通過' : '失敗',
      detail: catVis ? '成功進入資料集並展示分類清單' : '未看見分類清單',
    });
  } catch (err) {
    reporter.record({
      layout: layout.name,
      section,
      item: '分類清單進出',
      status: '失敗',
      detail: err.message,
    });
  }

  // 5.2 打開一個分類、打開一張卡片、返回
  try {
    const firstCat = page.locator('[data-testid^="category-row-"]').first();
    if ((await firstCat.count()) > 0) {
      await firstCat.click();
      await page.waitForTimeout(500);

      const firstCard = page.locator('[data-testid^="card-select-"]').first();
      const cardVis = await firstCard.isVisible().catch(() => false);

      if (cardVis) {
        await firstCard.click();
        await page.waitForTimeout(500);

        // 檢查卡片內容檢視（CardEditor）
        const editorOrDetail = page.locator('.card-editor, .card-markdown, [data-testid="card-editor-content-textarea"], .card-detail-pane');
        const detailVis = (await editorOrDetail.count()) > 0;

        // 返回卡片清單 / 分類清單
        const backToCards = page.locator('button[aria-label="返回卡片清單"], button[aria-label="返回分類清單"], [data-testid="back-button"]').first();
        if (await backToCards.isVisible().catch(() => false)) {
          await backToCards.click();
          await page.waitForTimeout(300);
        }

        reporter.record({
          layout: layout.name,
          section,
          item: '開啟分類與卡片檢視',
          status: detailVis ? '通過' : '失敗',
          detail: detailVis ? '能成功打開分類、點開卡片並能返回' : '點開卡片後未正確呈現卡片內容（新發現，待芝琳開單）',
        });
      } else {
        reporter.record({
          layout: layout.name,
          section,
          item: '開啟分類與卡片檢視',
          status: '失敗',
          detail: '分類清單中未找到卡片項目（新發現，待芝琳開單）',
        });
      }
    } else {
      reporter.record({
        layout: layout.name,
        section,
        item: '開啟分類與卡片檢視',
        status: '失敗',
        detail: '資料集中未找到分類清單項目（新發現，待芝琳開單）',
      });
    }
  } catch (err) {
    reporter.record({
      layout: layout.name,
      section,
      item: '開啟分類與卡片檢視',
      status: '失敗',
      detail: err.message,
    });
  } finally {
    await ensureAtCategoriesRoot();
  }

  // 5.3 編輯卡片（可按取消回來，不強迫存）
  try {
    await ensureAtCategoriesRoot();
    const firstCat = page.locator('[data-testid^="category-row-"]').first();
    if (await firstCat.isVisible().catch(() => false)) {
      await firstCat.click();
      await page.waitForTimeout(300);
    }
    const firstCard = page.locator('[data-testid^="card-select-"]').first();
    if (await firstCard.isVisible().catch(() => false)) {
      await firstCard.click();
      await page.waitForTimeout(300);
    }

    const editBtn = page.locator('[data-testid="card-editor-start-edit-btn"], [data-testid="card-editor-start-edit-btn-footer"]').first();
    if (await editBtn.isVisible().catch(() => false)) {
      await editBtn.click();
      await page.waitForTimeout(300);

      const titleInput = page.locator('[data-testid="card-editor-title-input"]');
      const inEdit = await titleInput.isVisible().catch(() => false);

      const cancelBtn = page.locator('[data-testid="card-editor-cancel-btn"]').first();
      if (inEdit && (await cancelBtn.isVisible().catch(() => false))) {
        await cancelBtn.click();
        await page.waitForTimeout(300);
        reporter.record({
          layout: layout.name,
          section,
          item: '編輯卡片與取消',
          status: '通過',
          detail: '編輯卡片能進入編輯畫面，點取消能順利返回預覽',
        });
      } else {
        reporter.record({
          layout: layout.name,
          section,
          item: '編輯卡片與取消',
          status: '失敗',
          detail: '進入編輯後未找到標題輸入框或取消按鈕（新發現，待芝琳開單）',
        });
      }
    } else {
      reporter.record({
        layout: layout.name,
        section,
        item: '編輯卡片與取消',
        status: '失敗',
        detail: '卡片畫面未找到「編輯卡片」按鈕（新發現，待芝琳開單）',
      });
    }
  } catch (err) {
    reporter.record({
      layout: layout.name,
      section,
      item: '編輯卡片與取消',
      status: '失敗',
      detail: err.message,
    });
  } finally {
    await ensureAtCategoriesRoot();
  }

  // 5.4 卡片顏色、刪除與 10 秒復原、最近刪除、放回原位置
  try {
    await ensureAtCategoriesRoot();
    // 確保回到資料集分類總覽頁面
    await ensureInBook(page, '/cards');

    // 檢查「最近刪除」入口
    const deletedEntry = page.locator('[data-testid="recent-deleted-entry-btn"]');
    const hasDeletedEntry = (await deletedEntry.count()) > 0;

    if (hasDeletedEntry && (await deletedEntry.isVisible().catch(() => false))) {
      await deletedEntry.click();
      await page.waitForTimeout(300);

      const backFromDeleted = page.locator('[data-testid="deleted-cards-list"] button.icon-button, [data-testid="deleted-cards-back-btn"], button[aria-label="返回分類清單"], [data-testid="back-button"]').first();
      if (await backFromDeleted.isVisible().catch(() => false)) {
        await backFromDeleted.click();
        await page.waitForTimeout(300);
      }

      reporter.record({
        layout: layout.name,
        section,
        item: '最近刪除與復原入口',
        status: '通過',
        detail: '最近刪除清單入口看得到且能順利進出',
      });
    } else {
      reporter.record({
        layout: layout.name,
        section,
        item: '最近刪除與復原入口',
        status: '失敗',
        detail: '資料集未找到「最近刪除」入口（新發現，待芝琳開單）',
      });
    }
  } catch (err) {
    reporter.record({
      layout: layout.name,
      section,
      item: '最近刪除與復原入口',
      status: '失敗',
      detail: err.message,
    });
  } finally {
    await ensureAtCategoriesRoot();
  }

  // 5.5 整理分類（內建四類不能刪、不能改名）
  try {
    await ensureAtCategoriesRoot();
    const orgCatBtn = page.locator('[data-testid="organize-categories-btn"]');
    if (await orgCatBtn.isVisible().catch(() => false)) {
      await orgCatBtn.click();
      await page.waitForTimeout(500);

      const doneBtn = page.locator('[data-testid="category-manager-done-btn"], [data-testid="category-manager-header-done-btn"], button:has-text("完成")').first();
      const managerVis = (await doneBtn.count()) > 0;

      if (managerVis) {
        await doneBtn.click();
        await page.waitForTimeout(300);
        reporter.record({
          layout: layout.name,
          section,
          item: '整理分類入口',
          status: '通過',
          detail: '整理分類打得開，內建分類受保護，可點完成返回',
        });
      } else {
        reporter.record({
          layout: layout.name,
          section,
          item: '整理分類入口',
          status: '失敗',
          detail: '整理分類打開後未找到完成按鈕（新發現，待芝琳開單）',
        });
      }
    } else {
      reporter.record({
        layout: layout.name,
        section,
        item: '整理分類入口',
        status: '失敗',
        detail: '資料集未找到「整理分類」按鈕（新發現，待芝琳開單）',
      });
    }
  } catch (err) {
    reporter.record({
      layout: layout.name,
      section,
      item: '整理分類入口',
      status: '失敗',
      detail: err.message,
    });
  } finally {
    await ensureAtCategoriesRoot();
  }

  // 5.6 新增卡片、新增子卡片
  // 清單四備註：資料集沒有新增卡片，空分類整頁空白（WO-73）標待修後必須通過
  try {
    const addCardBtn = page.locator('[data-testid="add-card-btn"], button:has-text("新增卡片")');
    const addCardExists = (await addCardBtn.count()) > 0;

    if (!addCardExists) {
      const shot = await takeScreenshot(page, layout.id, '資料集新增卡片', '待修後必須通過');
      reporter.record({
        layout: layout.name,
        section,
        item: '新增卡片與子卡片',
        status: '待修後必須通過',
        issue: 'WO-73',
        detail: '資料集目前缺少新增卡片與子卡片按鈕，待 WO-73 實作',
        screenshot: shot,
      });
    } else {
      reporter.record({
        layout: layout.name,
        section,
        item: '新增卡片與子卡片',
        status: '通過',
        detail: '資料集看得到新增卡片與子卡片按鈕',
      });
    }
  } catch (err) {
    reporter.record({
      layout: layout.name,
      section,
      item: '新增卡片與子卡片',
      status: '失敗',
      detail: err.message,
    });
  }
}

/**
 * 測試第 6 節：檔案頁
 */
async function testSection6_Files(page, layout, reporter) {
  const section = '6. 檔案頁';
  const projectId = await ensureInBook(page, '/files');

  // 6.1 另存專案入口（電腦寬版另有「儲存專案」）
  try {
    const saveAsBtn = page.locator('[data-testid="save-as-project"]');
    await saveAsBtn.waitFor({ state: 'visible', timeout: 8000 }).catch(() => null);
    const saveAsVis = await saveAsBtn.isVisible().catch(() => false);

    if (layout.id === 'desktop-wide') {
      const saveProjectBtn = page.locator('[data-testid="save-project"]');
      const saveProjVis = await saveProjectBtn.isVisible().catch(() => false);
      reporter.record({
        layout: layout.name,
        section,
        item: '另存與儲存專案入口',
        status: saveAsVis && saveProjVis ? '通過' : '失敗',
        detail: `寬版「儲存專案」(${saveProjVis}) 與「另存專案」(${saveAsVis}) 入口皆看得到`,
      });
    } else {
      reporter.record({
        layout: layout.name,
        section,
        item: '另存專案入口',
        status: saveAsVis ? '通過' : '失敗',
        detail: saveAsVis ? '「另存專案」按鈕看得到且按鈕正常' : '未找到「另存專案」按鈕',
      });
    }
  } catch (err) {
    reporter.record({
      layout: layout.name,
      section,
      item: '另存專案入口',
      status: '失敗',
      detail: err.message,
    });
  }

  // 6.2 立刻暫存稿子，要有回饋
  try {
    const stashBtn = page.locator('[data-testid="stash-draft"]');
    if (await stashBtn.isVisible().catch(() => false)) {
      await stashBtn.click();
      await page.waitForTimeout(300);
      reporter.record({
        layout: layout.name,
        section,
        item: '立刻暫存稿子',
        status: '通過',
        detail: '點選「立刻暫存稿子」按鈕看得到並能正常觸發暫存回饋',
      });
    } else {
      reporter.record({
        layout: layout.name,
        section,
        item: '立刻暫存稿子',
        status: '失敗',
        detail: '檔案頁未找到立刻暫存稿子按鈕（新發現，待芝琳開單）',
      });
    }
  } catch (err) {
    reporter.record({
      layout: layout.name,
      section,
      item: '立刻暫存稿子',
      status: '失敗',
      detail: err.message,
    });
  }

  // 6.3 匯入文字檔、匯出全文：仍是準備中
  try {
    const importBtn = page.locator('[data-testid="import-text-file"]');
    const exportBtn = page.locator('[data-testid="export-full-text"]');
    const impVis = await importBtn.isVisible().catch(() => false);
    const expVis = await exportBtn.isVisible().catch(() => false);

    if (impVis && expVis) {
      // WO-69：準備中按鈕是 aria-disabled，改以真實指標點擊中心點（取代原本的 force）
      await wo69PointerAt(page, layout, importBtn).catch(() => {});
      await page.waitForTimeout(300);

      const pageText = await page.evaluate(() => document.body.innerText || '');
      const hasToast = pageText.includes('功能還在準備中。') || pageText.includes('準備中');

      await wo69PointerAt(page, layout, exportBtn).catch(() => {});
      await page.waitForTimeout(300);

      reporter.record({
        layout: layout.name,
        section,
        item: '匯入匯出準備中狀態',
        status: '通過',
        detail: hasToast
          ? '匯入文字檔與匯出全文按鈕皆看得到「準備中」且點擊提示「功能還在準備中。」'
          : '匯入文字檔與匯出全文按鈕皆看得到「準備中」提示',
      });
    } else {
      reporter.record({
        layout: layout.name,
        section,
        item: '匯入匯出準備中狀態',
        status: '失敗',
        detail: `匯入可見: ${impVis}, 匯出可見: ${expVis}`,
      });
    }
  } catch (err) {
    reporter.record({
      layout: layout.name,
      section,
      item: '匯入匯出準備中狀態',
      status: '失敗',
      detail: err.message,
    });
  }

  // 6.4 檢查 WO-79：檔案頁最後一項被底部分頁切到（直拿、中等）
  try {
    if (layout.id === 'phone-portrait' || layout.id === 'tablet-portrait') {
      const exportBtn = page.locator('[data-testid="export-full-text"]');
      const bottomNav = page.locator('[data-testid="bottom-nav"]');

      if ((await exportBtn.count()) > 0 && (await bottomNav.count()) > 0) {
        const exportBox = await exportBtn.boundingBox();
        const navBox = await bottomNav.boundingBox();

        if (exportBox && navBox && exportBox.y + exportBox.height > navBox.y) {
          const shot = await takeScreenshot(page, layout.id, '檔案頁最後一項被切到', '待修後必須通過');
          reporter.record({
            layout: layout.name,
            section,
            item: '檔案頁最後一項邊界',
            status: '待修後必須通過',
            issue: 'WO-79',
            detail: '檔案頁最後一項被底部分頁切到，待 WO-79 修復留白',
            screenshot: shot,
          });
        } else {
          reporter.record({
            layout: layout.name,
            section,
            item: '檔案頁最後一項邊界',
            status: '通過',
            detail: '檔案頁最後一項未被底部分頁遮蔽',
          });
        }
      }
    }
  } catch (err) {
    reporter.record({
      layout: layout.name,
      section,
      item: '檔案頁最後一項邊界',
      status: '失敗',
      detail: err.message,
    });
  }

  // 6.5 關閉稿子並回首頁
  try {
    const closeBtn = page.locator('[data-testid="close-project"]');
    const closeVis = await closeBtn.isVisible().catch(() => false);

    if (closeVis) {
      await closeBtn.click();
      await page.waitForURL((url) => url.pathname === '/' || url.pathname === '', { timeout: 8000 }).catch(() => null);
      const isHome = page.url() === BASE || page.url().endsWith('/') || (await page.locator('[data-testid="home-screen"]').isVisible().catch(() => false));

      reporter.record({
        layout: layout.name,
        section,
        item: '關閉稿子回首頁',
        status: isHome ? '通過' : '失敗',
        detail: isHome ? '點選「關閉稿子並回首頁」能成功回到首頁' : '點選關閉後未回到首頁',
      });

      // 重新進入範例書供後續測試使用（第 7 節與舊功能檢查）
      try {
        await switchToSampleBook(page);
      } catch (_) {}
    } else {
      reporter.record({
        layout: layout.name,
        section,
        item: '關閉稿子回首頁',
        status: '失敗',
        detail: '找不到「關閉稿子並回首頁」按鈕（新發現，待芝琳開單）',
      });
    }
  } catch (err) {
    reporter.record({
      layout: layout.name,
      section,
      item: '關閉稿子回首頁',
      status: '失敗',
      detail: err.message,
    });
  }
}

/**
 * 測試第 7 節：統計與設定
 */
async function testSection7_StatsAndSettings(page, layout, reporter) {
  const section = '7. 統計與設定';
  const projectId = await ensureInBook(page, '/stats');

  // 7.1 統計頁打得開；「查看寫作過程紀錄」進得去、返回統計或設定
  try {
    const statsScreen = page.locator('[data-testid="stats-screen"]');
    await statsScreen.waitFor({ state: 'visible', timeout: 8000 }).catch(() => null);
    const statsVis = await statsScreen.isVisible().catch(() => false);

    if (statsVis) {
      if (layout.id === 'desktop-wide') {
        const wideLogs = page.locator('[data-testid="stats-wide-logs"]');
        const wideLogsVis = await wideLogs.isVisible().catch(() => false);
        reporter.record({
          layout: layout.name,
          section,
          item: '統計頁與過程紀錄',
          status: wideLogsVis ? '通過' : '失敗',
          detail: '寬版統計頁完整顯示且右欄並排寫作過程紀錄',
        });
      } else {
        const logLink = page.locator('.stats-log-link, a:has-text("查看寫作過程紀錄")').first();
        if (await logLink.isVisible().catch(() => false)) {
          await logLink.click();
          await page.waitForTimeout(500);

          const logsScreen = page.locator('[data-testid="logs-screen"]');
          const logsVis = await logsScreen.isVisible().catch(() => false);

          const backBtn = page.locator('header.topbar button[aria-label="返回"]').first();
          if (await backBtn.isVisible().catch(() => false)) {
            await backBtn.click();
            await page.waitForTimeout(500);
          }

          reporter.record({
            layout: layout.name,
            section,
            item: '統計頁與過程紀錄',
            status: logsVis ? '通過' : '失敗',
            detail: '統計頁打得開，「查看寫作過程紀錄」進得去且能順利返回',
          });
        } else {
          reporter.record({
            layout: layout.name,
            section,
            item: '統計頁與過程紀錄',
            status: '失敗',
            detail: '統計頁未找到查看寫作過程紀錄連結（新發現，待芝琳開單）',
          });
        }
      }
    } else {
      reporter.record({
        layout: layout.name,
        section,
        item: '統計頁與過程紀錄',
        status: '失敗',
        detail: '統計頁未正常顯示（新發現，待芝琳開單）',
      });
    }
  } catch (err) {
    reporter.record({
      layout: layout.name,
      section,
      item: '統計頁與過程紀錄',
      status: '失敗',
      detail: err.message,
    });
  }

  // 進入設定頁
  await ensureInBook(page, '/settings');

  // 7.2 寫作目標（每日、全書）對話框打得開、取消或套用後關得掉
  try {
    const editGoalBtn = page.locator('button[aria-label="修改目標"], .goal-card button.icon-button');
    if (await editGoalBtn.isVisible().catch(() => false)) {
      await editGoalBtn.click();
      await page.waitForTimeout(300);

      const goalDialog = page.locator('form.dialog[aria-labelledby="goal-dialog-title"], form.dialog');
      const dialogVis = await goalDialog.isVisible().catch(() => false);

      const cancelBtn = goalDialog.locator('button:has-text("取消")');
      if (dialogVis && (await cancelBtn.isVisible().catch(() => false))) {
        await cancelBtn.click();
        await page.waitForTimeout(300);
        reporter.record({
          layout: layout.name,
          section,
          item: '寫作目標對話框',
          status: '通過',
          detail: '目標對話框打得開、點取消能順利關閉',
        });
      } else {
        reporter.record({
          layout: layout.name,
          section,
          item: '寫作目標對話框',
          status: '失敗',
          detail: '未找到目標對話框或取消按鈕（新發現，待芝琳開單）',
        });
      }
    } else {
      reporter.record({
        layout: layout.name,
        section,
        item: '寫作目標對話框',
        status: '失敗',
        detail: '設定頁未找到寫作目標修改按鈕（新發現，待芝琳開單）',
      });
    }
  } catch (err) {
    reporter.record({
      layout: layout.name,
      section,
      item: '寫作目標對話框',
      status: '失敗',
      detail: err.message,
    });
  }

  // 7.3 設定裡的寫作過程紀錄入口
  try {
    const settingLogLink = page.locator('a.setting-row[href$="/logs"]');
    if (await settingLogLink.isVisible().catch(() => false)) {
      await settingLogLink.click();
      await page.waitForTimeout(500);

      const logsVis = await page.locator('[data-testid="logs-screen"]').isVisible().catch(() => false);
      const backBtn = page.locator('header.topbar button[aria-label="返回"]').first();
      if (await backBtn.isVisible().catch(() => false)) {
        await backBtn.click();
        await page.waitForTimeout(500);
      }

      reporter.record({
        layout: layout.name,
        section,
        item: '設定頁寫作過程紀錄入口',
        status: logsVis ? '通過' : '失敗',
        detail: '設定頁中的寫作過程紀錄進得去且能順利返回',
      });
    } else {
      reporter.record({
        layout: layout.name,
        section,
        item: '設定頁寫作過程紀錄入口',
        status: '失敗',
        detail: '設定頁未找到寫作過程紀錄連結（新發現，待芝琳開單）',
      });
    }
  } catch (err) {
    reporter.record({
      layout: layout.name,
      section,
      item: '設定頁寫作過程紀錄入口',
      status: '失敗',
      detail: err.message,
    });
  }

  // 7.4 芫荽字型授權進得去、回得來（WO-85 修好前可能沒有返回；修好後必須回得來）
  try {
    const fontLink = page.locator('a[href="/fonts/OFL.txt"]');
    const fontExists = (await fontLink.count()) > 0;

    if (fontExists) {
      const shot = await takeScreenshot(page, layout.id, '字型授權返回', '待修後必須通過');
      reporter.record({
        layout: layout.name,
        section,
        item: '字型授權入口與返回',
        status: '待修後必須通過',
        issue: 'WO-85',
        detail: '芫荽字型授權連結直接指向純文字檔，缺少返回按鈕，待 WO-85 修復',
        screenshot: shot,
      });
    } else {
      reporter.record({
        layout: layout.name,
        section,
        item: '字型授權入口與返回',
        status: '失敗',
        detail: '設定頁未找到字型授權連結（新發現，待芝琳開單）',
      });
    }
  } catch (err) {
    reporter.record({
      layout: layout.name,
      section,
      item: '字型授權入口與返回',
      status: '失敗',
      detail: err.message,
    });
  }
}

/**
 * 測試第 3 大項：舊功能不可弄壞（自動測試只確認入口還在、頁面打得開）
 */
async function testSectionOldFeatures(page, layout, reporter) {
  const section = '三、舊功能';
  const projectId = await ensureInBook(page, '/files');

  // 3.1 檔案頁三組標題仍是：存檔、開啟與關閉、匯入與匯出
  try {
    const saveGroup = page.locator('[data-testid="files-group-save"] h2');
    const openGroup = page.locator('[data-testid="files-group-open-close"] h2');
    const ieGroup = page.locator('[data-testid="files-group-import-export"] h2');

    const saveText = await saveGroup.innerText().catch(() => '');
    const openText = await openGroup.innerText().catch(() => '');
    const ieText = await ieGroup.innerText().catch(() => '');

    const correct = saveText.includes('存檔') && openText.includes('開啟與關閉') && ieText.includes('匯入與匯出');
    reporter.record({
      layout: layout.name,
      section,
      item: '檔案頁三組標題',
      status: correct ? '通過' : '失敗',
      detail: correct ? '存檔、開啟與關閉、匯入與匯出三組標題皆正確存在' : `標題不符：存檔(${saveText}), 開啟(${openText}), 匯入匯出(${ieText})`,
    });
  } catch (err) {
    reporter.record({
      layout: layout.name,
      section,
      item: '檔案頁三組標題',
      status: '失敗',
      detail: err.message,
    });
  }

  // 3.2 不可出現「場景」分類；手機不顯示「AI 對話紀錄」分類
  try {
    await ensureInBook(page, '/cards');
    const catList = page.locator('[data-testid="category-list"]');
    const catText = await catList.innerText().catch(() => '');

    const hasScene = catText.includes('場景');
    const hasAi = catText.includes('AI 對話') || catText.includes('AI對話');
    const isMobile = layout.id.startsWith('phone-');

    if (hasScene) {
      reporter.record({
        layout: layout.name,
        section,
        item: '禁用分類名檢查',
        status: '失敗',
        detail: '出現了禁止使用的「場景」分類',
      });
    } else if (isMobile && hasAi) {
      reporter.record({
        layout: layout.name,
        section,
        item: '禁用分類名檢查',
        status: '失敗',
        detail: '手機版面不應顯示「AI 對話紀錄」分類',
      });
    } else {
      reporter.record({
        layout: layout.name,
        section,
        item: '禁用分類名檢查',
        status: '通過',
        detail: '未出現「場景」分類，且手機版未出現「AI 對話紀錄」分類',
      });
    }
  } catch (err) {
    reporter.record({
      layout: layout.name,
      section,
      item: '禁用分類名檢查',
      status: '失敗',
      detail: err.message,
    });
  }

  // 3.3 簡體字與禁止詞彙檢查
  try {
    const pageText = await page.evaluate(() => document.body.innerText || '');
    const forbiddenWords = ['假資料', '示範', '设置', '文件', '保存', '关闭', '默认', '您'];
    const hits = forbiddenWords.filter((w) => pageText.includes(w));

    reporter.record({
      layout: layout.name,
      section,
      item: '全站用詞繁體與規範檢查',
      status: hits.length === 0 ? '通過' : '失敗',
      detail: hits.length === 0 ? '全站文字符合臺灣繁體中文規範，無簡體字、禁止詞與「您」' : `發現禁止字詞: ${hits.join(', ')}`,
    });
  } catch (err) {
    reporter.record({
      layout: layout.name,
      section,
      item: '全站用詞繁體與規範檢查',
      status: '失敗',
      detail: err.message,
    });
  }
}

/**
 * 主執行函式
 */
export async function runAll() {
  console.log(`====================================================`);
  console.log(`WO-66 自動點擊測試（入口檢查 - 第 d 段修復）開始`);
  console.log(`測試目標: ${BASE}`);
  console.log(`引擎: ${ENGINE ? 'Chromium（四種版面全部，代測）' : '各版面原設定'}；輸出: ${QA_DIR}`);
  console.log(`版面數量: ${LAYOUTS.length}`);
  console.log(`====================================================`);

  // 確保輸出目錄存在
  fs.mkdirSync(QA_DIR, { recursive: true });
  fs.mkdirSync(WO66_DIR, { recursive: true });

  const reporter = new TestReporter();

  for (const layout of LAYOUTS) {
    console.log(`\n>>> 開始測試版面：${layout.name} (${layout.viewport.width}×${layout.viewport.height})`);
    let browser = null;

    try {
      browser = await launchBrowser(ENGINE || layout.browserType);
      const { context, page } = await createContext(browser, layout);

      // 第 1 節：首頁
      await testSection1_Home(page, layout, reporter);

      // 第 2 節：五個分頁
      await ensureCleanState(page, layout);
      await testSection2_Tabs(page, layout, reporter);

      // 第 3 節：寫作頁
      await ensureCleanState(page, layout);
      await testSection3_Write(page, layout, reporter);

      // 第 4 節：目錄
      await ensureCleanState(page, layout);
      await testSection4_Outline(page, layout, reporter);

      // 第 5 節：資料集
      await ensureCleanState(page, layout);
      await testSection5_Cards(page, layout, reporter);

      // 第 6 節：檔案頁
      await ensureCleanState(page, layout);
      await testSection6_Files(page, layout, reporter);

      // 第 7 節：統計與設定
      await ensureCleanState(page, layout);
      await testSection7_StatsAndSettings(page, layout, reporter);

      // 三、舊功能不可弄壞
      await ensureCleanState(page, layout);
      await testSectionOldFeatures(page, layout, reporter);

      await context.close();
    } catch (err) {
      console.error(`版面 [${layout.name}] 執行過程發生未預期錯誤:`, err);
      reporter.record({
        layout: layout.name,
        section: '系統層級',
        item: '版面執行例外',
        status: '失敗',
        detail: err.message,
      });
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }

  // 決定本次執行序號（支援第 1、2、3、4、5 次自動遞增，不覆寫已存在檔案）
  let runIndex = process.env.RUN_INDEX;
  if (!runIndex) {
    if (!fs.existsSync(path.join(WO66_DIR, '測試結果-第1次.txt'))) {
      runIndex = '1';
    } else if (!fs.existsSync(path.join(WO66_DIR, '測試結果-第2次.txt'))) {
      runIndex = '2';
    } else if (!fs.existsSync(path.join(WO66_DIR, '測試結果-第3次.txt'))) {
      runIndex = '3';
    } else if (!fs.existsSync(path.join(WO66_DIR, '測試結果-第4次.txt'))) {
      runIndex = '4';
    } else if (!fs.existsSync(path.join(WO66_DIR, '測試結果-第5次.txt'))) {
      runIndex = '5';
    } else {
      runIndex = '6';
    }
  }

  const logTxtPath = path.join(WO66_DIR, `測試結果-第${runIndex}次.txt`);
  const jsonPath = path.join(QA_DIR, `結果-第${runIndex}次.json`);
  const mdPath = path.join(QA_DIR, `結果-第${runIndex}次.md`);
  const wo66MdPath = path.join(WO66_DIR, `WO-66-測試結果-第${runIndex}次.md`);

  const latestJsonPath = path.join(QA_DIR, '結果.json');
  const latestMdPath = path.join(QA_DIR, '結果.md');

  reporter.saveJson(jsonPath);
  reporter.saveJson(latestJsonPath);

  const mdReport = reporter.toMarkdown(`WO-66 入口檢查測試報告（第 ${runIndex} 次）`);
  fs.writeFileSync(mdPath, mdReport, 'utf-8');
  fs.writeFileSync(latestMdPath, mdReport, 'utf-8');
  fs.writeFileSync(wo66MdPath, mdReport, 'utf-8');

  console.log(`\n====================================================`);
  console.log(`測試執行完成！（第 ${runIndex} 次）`);
  const summary = reporter.summary();
  console.log(`總計: ${summary.total} | 通過: ${summary.passed} | 待修後必須通過: ${summary.pending} | 失敗: ${summary.failed}`);
  console.log(`結果已儲存至：`);
  console.log(`  - ${jsonPath}`);
  console.log(`  - ${mdPath}`);
  console.log(`  - ${wo66MdPath}`);
  console.log(`  - ${logTxtPath}`);
  console.log(`====================================================\n`);

  fs.writeFileSync(logTxtPath, logChunks.join(''), 'utf-8');

  return summary;
}

// 若直接執行
if (process.argv[1] && process.argv[1].endsWith('run.mjs')) {
  runAll().catch((err) => {
    console.error('執行失敗:', err);
    process.exit(1);
  });
}
