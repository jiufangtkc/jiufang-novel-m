/**
 * WO-74／WO-75：寫作頁「看卡片」讀本書卡片；「範例卡片，之後會換成這份稿子的卡片」只在內建範例書出現。
 *
 * 全程只從畫面正常操作（點、打字、讀畫面文字），不 force 點擊、不用 evaluate 改狀態或呼叫內部函式、不跳內部網址。
 * 只用內建【範例】霧港紀事與本次新開、書名含【範例】的測試稿；每個版面各開新的瀏覽器環境，不碰真書稿或 .db。
 * 另存再開：另存本次測試稿下載成 .db，再由「開啟稿子」選回。
 *
 * 情境（四種版面各跑一次）：
 *   S1 內建範例書：資料集與看卡片都有定案提示句、有範例卡片。
 *   S2 新稿（書名含【範例】）：資料集與看卡片都沒有卡片、有說明、沒有範例角色、沒有提示句。
 *   S3 在資料集新增一張卡片（標題、內容）→ 看卡片看得到同一張、張數一致、沒有範例卡片、沒有提示句。
 *   S4 另存再用「開啟稿子」開回：資料集與看卡片仍是這份卡片，沒有範例卡片、沒有提示句。
 *
 * 環境變數：BASE、RUN_LABEL、PLAYWRIGHT_MODULE、CHROMIUM_PATH、LAYOUTS、QA_DIR、SHOT_DIR。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromiumPath, loadPlaywright } from '../playwright-env.mjs';

const { chromium } = loadPlaywright();
const BASE = (process.env.BASE || 'http://127.0.0.1:4173').replace(/\/$/, '');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const QA_DIR = process.env.QA_DIR || path.join(REPO_ROOT, 'test-results', 'qa', '看卡片與範例提示');
const RUN_LABEL = process.env.RUN_LABEL || 'WO-74-75';
const RUN_DIR = path.join(QA_DIR, RUN_LABEL);
const SHOT_DIR = process.env.SHOT_DIR || RUN_DIR;
fs.mkdirSync(RUN_DIR, { recursive: true });
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ALL = [
  { id: 'phone-portrait', name: '手機直拿', viewport: { width: 390, height: 844 }, touch: true },
  { id: 'phone-landscape', name: '手機橫拿', viewport: { width: 844, height: 390 }, touch: true },
  { id: 'tablet-portrait', name: '平板直拿', viewport: { width: 768, height: 1024 }, touch: true },
  { id: 'desktop-wide', name: '寬版', viewport: { width: 1280, height: 800 }, touch: false },
];
const only = (process.env.LAYOUTS || '').split(',').filter(Boolean);
const LAYOUTS = only.length ? ALL.filter((l) => only.includes(l.id)) : ALL;

const NOTICE = '範例卡片，之後會換成這份稿子的卡片';
const EMPTY_HINT = '這份稿子還沒有卡片，可到資料集新增。';
const SAMPLE_BOOK = '【範例】霧港紀事';
const SAMPLE_ROLE = '沈雨晴';
const CARD_TITLE = '【範例】測試稿角色卡甲';
const CARD_BODY = '這張卡片只存在這份測試稿';

const vis = (loc) => loc.first().isVisible().catch(() => false);
const act = (L, loc) => (L.touch ? loc.first().tap({ timeout: 8000 }) : loc.first().click({ timeout: 8000 }));
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const bodyText = async (page) => ((await page.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');

const results = [];
function rec(L, step, item, ok, actual) {
  results.push({ layout: L.name, step, item, status: ok ? 'passed' : 'failed', actual: String(actual) });
  console.log(`[${L.name}] ${ok ? '通過' : '失敗'} ${step} ${item} :: ${actual}`);
}

async function shot(page, L, name) {
  const f = path.join(SHOT_DIR, `${L.id}-${name}.png`);
  await page.screenshot({ path: f }).catch(() => {});
  return f;
}

async function gotoTab(page, L, tab) {
  const nav = L.id === 'desktop-wide' || L.id === 'phone-landscape' ? '[data-testid="nav-rail"]' : '[data-testid="bottom-nav"]';
  const btn = page.locator(`${nav} [data-testid="nav-${tab}"]`).first();
  await btn.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
  if (!(await vis(btn))) {
    for (const s of ['[data-testid="back-button"]', '[data-testid="toggle-tree-floating"]']) {
      const b = page.locator(s).first();
      if (await vis(b)) {
        await act(L, b);
        await page.waitForTimeout(600);
        if (await vis(btn)) break;
      }
    }
  }
  if (!(await vis(btn))) return false;
  await act(L, btn);
  await page.waitForTimeout(700);
  return page.url().includes(`/${tab}`);
}

const CARDS_BTNS = ['toggle-cards-topbar', 'toggle-cards-landscape', 'thumb-cards-button'];
async function cardsButton(page) {
  for (const id of CARDS_BTNS) {
    const b = tid(page, id).first();
    if (await vis(b)) return b;
  }
  return null;
}

/** 到寫作頁並讓正文編輯畫面出現（開章）。 */
async function openEditor(page, L, chapterTitle) {
  if (!page.url().includes('/write')) await gotoTab(page, L, 'write');
  if (await cardsButton(page)) return true;
  const rowSel = chapterTitle
    ? page.locator('.tree-row[data-node-id] .tree-main', { hasText: chapterTitle })
    : page.locator('.tree-row[data-node-id] .tree-main');
  for (const s of ['[data-testid="back-button"]', '[data-testid="toggle-tree-topbar"]', '[data-testid="toggle-tree-floating"]']) {
    if (await vis(rowSel)) break;
    const b = page.locator(s).first();
    if (await vis(b)) {
      await act(L, b).catch(() => {});
      await page.waitForTimeout(600);
    }
  }
  if (await vis(rowSel)) await act(L, rowSel);
  await tid(page, 'writing-input').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  const close = tid(page, 'close-tree-pane').first();
  if (L.id !== 'desktop-wide' && (await vis(close))) {
    await act(L, close);
    await page.waitForTimeout(500);
  }
  return !!(await cardsButton(page));
}

async function openDrawer(page, L) {
  const b = await cardsButton(page);
  if (!b) return null;
  await act(L, b);
  const drawer = tid(page, 'writing-cards-drawer').first();
  await drawer.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  if (!(await vis(drawer))) return null;
  // 看卡片會記住上次讀到哪一層（既有行為）；一律先回到分類清單再驗
  for (let i = 0; i < 3 && !(await vis(tid(page, 'category-list'))); i += 1) {
    const back = drawer.locator('button[aria-label*="返回"]').first();
    if (!(await vis(back))) break;
    await act(L, back);
    await page.waitForTimeout(300);
  }
  return drawer;
}

async function closeDrawer(page, L) {
  const c = tid(page, 'close-cards-drawer').first();
  if (await vis(c)) {
    await act(L, c);
    await page.waitForTimeout(500);
  }
}

const drawerText = async (drawer) => ((await drawer.innerText().catch(() => '')) || '').replace(/\s+/g, ' ');

/** 資料集分頁：看第一層分類畫面上的字（不含卡片內容）。 */
async function datasetText(page, L) {
  if (!(await gotoTab(page, L, 'cards'))) return null;
  await tid(page, 'cards-screen').first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  return bodyText(page);
}

async function createDraft(page, L, title) {
  await act(L, page.getByRole('button', { name: '開新稿子' }).first());
  await page.locator('form.dialog input').first().fill(title);
  await act(L, page.locator('form.dialog button[type="submit"]').first());
  await page.waitForURL(/\/p\/[^/]+\/write/, { timeout: 15000 });
  await page.waitForTimeout(700);
}

async function openFromRecent(page, L, title) {
  const link = page.locator('[data-testid="project-card"] a.project-main', { hasText: title }).first();
  if (!(await vis(link))) return false;
  await act(L, link);
  await page.waitForURL(/\/p\/[^/]+\/write/, { timeout: 10000 }).catch(() => null);
  await page.waitForTimeout(600);
  return /\/p\/[^/]+\/write/.test(page.url());
}

async function closeToHome(page, L) {
  if (!(await gotoTab(page, L, 'files'))) return false;
  const close = tid(page, 'close-project').first();
  if (!(await vis(close))) return false;
  await act(L, close);
  return page.waitForSelector('[data-testid="home-screen"]', { timeout: 10000 }).then(() => true).catch(() => false);
}

async function runLayout(L) {
  const opts = { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] };
  const exe = chromiumPath();
  const browser = await chromium.launch(exe && fs.existsSync(exe) ? { ...opts, executablePath: exe } : opts);
  const ctxOpts = { viewport: L.viewport, locale: 'zh-TW', timezoneId: 'Asia/Taipei', acceptDownloads: true };
  if (L.touch) { ctxOpts.hasTouch = true; ctxOpts.isMobile = true; }
  const context = await browser.newContext(ctxOpts);
  // 與 qa/存檔再開 相同：模擬沒有「檔案存取 API」的瀏覽器，另存走下載、開啟走一般選檔（瀏覽器能力模擬，不改 App 狀態）
  await context.addInitScript(() => {
    try { delete window.showSaveFilePicker; delete window.showOpenFilePicker; } catch { /* 略 */ }
  });
  const page = await context.newPage();
  const BOOK = `【範例】看卡片測試稿-${L.name}-${RUN_LABEL}`;
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="home-screen"]', { timeout: 20000 });

    // ── S1 內建範例書 ──
    const okS = await openFromRecent(page, L, SAMPLE_BOOK);
    rec(L, 'S1-0', '開啟內建範例書', okS, page.url());
    let ds = await datasetText(page, L);
    rec(L, 'S1-1', '範例書資料集：有定案提示句', !!ds && ds.includes(NOTICE), NOTICE);
    await shot(page, L, 'S1-內建範例書-資料集有提示');
    const sampleEditor = await openEditor(page, L, '第一章　來信');
    let drawer = sampleEditor ? await openDrawer(page, L) : null;
    let dt = drawer ? await drawerText(drawer) : '';
    rec(L, 'S1-2', '範例書看卡片：有定案提示句、有範例卡片分類與張數', !!drawer && dt.includes(NOTICE) && dt.includes('角色') && (await tid(page, 'category-row-character').first().getAttribute('aria-label').catch(() => '')) === '角色，5 張卡片', dt.slice(0, 120));
    if (drawer) {
      await act(L, tid(page, 'category-row-character'));
      await page.waitForTimeout(400);
      dt = await drawerText(drawer);
      rec(L, 'S1-3', '範例書看卡片第二層：仍有提示句與範例角色', dt.includes(NOTICE) && dt.includes(SAMPLE_ROLE), dt.slice(0, 120));
      await shot(page, L, 'S1-內建範例書-看卡片有提示');
      await closeDrawer(page, L);
    }
    await closeToHome(page, L);

    // ── S2 新稿 ──
    await createDraft(page, L, BOOK);
    ds = await datasetText(page, L);
    rec(L, 'S2-1', '新稿資料集：沒有提示句、沒有範例角色', !!ds && !ds.includes(NOTICE) && !ds.includes(SAMPLE_ROLE), (ds || '無').slice(0, 100));
    await shot(page, L, 'S2-新稿-資料集');
    const newEditor = await openEditor(page, L, null);
    drawer = newEditor ? await openDrawer(page, L) : null;
    dt = drawer ? await drawerText(drawer) : '';
    rec(L, 'S2-2', '新稿看卡片：是空的、有說明、沒有範例角色、沒有提示句', !!drawer && dt.includes(EMPTY_HINT) && !dt.includes(SAMPLE_ROLE) && !dt.includes(NOTICE) && !dt.includes('【範例】'), dt.slice(0, 140));
    await shot(page, L, 'S2-新稿-看卡片空狀態');
    await closeDrawer(page, L);
    // 檔案頁會寫「目前的稿子：書名」，留一張證明上面是這份測試稿
    if (await gotoTab(page, L, 'files')) {
      rec(L, 'S2-3', '檔案頁看得到目前的稿子是這份測試稿', (await bodyText(page)).includes(BOOK), BOOK);
      await shot(page, L, 'S2-新稿-稿名（檔案頁）');
    }

    // ── S3 在資料集新增一張卡片 ──
    await gotoTab(page, L, 'cards');
    const cat = tid(page, 'category-row-character').first();
    if (await vis(cat)) { await act(L, cat); await page.waitForTimeout(400); }
    const addBtn = page.getByRole('button', { name: '新增卡片' }).first();
    const hasAdd = await vis(addBtn);
    rec(L, 'S3-0', '資料集有「新增卡片」入口', hasAdd, hasAdd ? '有' : '找不到');
    if (hasAdd) {
      await act(L, addBtn);
      await page.waitForTimeout(500);
      const start = tid(page, 'card-editor-start-edit-btn').first();
      if (await vis(start)) { await act(L, start); await page.waitForTimeout(400); }
      const titleIn = tid(page, 'card-editor-title-input').first();
      const bodyIn = tid(page, 'card-editor-content-textarea').first();
      if (await vis(titleIn)) await titleIn.fill(CARD_TITLE);
      if (await vis(bodyIn)) await bodyIn.fill(CARD_BODY);
      const done = tid(page, 'card-editor-done-btn').first();
      if (await vis(done)) { await act(L, done); await page.waitForTimeout(500); }
    }
    ds = await bodyText(page);
    rec(L, 'S3-1', '資料集看得到新增的卡片、沒有提示句與範例角色', ds.includes(CARD_TITLE) && !ds.includes(NOTICE) && !ds.includes(SAMPLE_ROLE), ds.slice(0, 120));
    await shot(page, L, 'S3-自己的卡片-資料集');
    const ed3 = await openEditor(page, L, null);
    drawer = ed3 ? await openDrawer(page, L) : null;
    dt = drawer ? await drawerText(drawer) : '';
    const label = drawer ? (await tid(page, 'category-row-character').first().getAttribute('aria-label').catch(() => '')) : '';
    rec(L, 'S3-2', '看卡片：角色 1 張、沒有空狀態說明、沒有提示句', !!drawer && label === '角色，1 張卡片' && !dt.includes(EMPTY_HINT) && !dt.includes(NOTICE), `${label}｜${dt.slice(0, 100)}`);
    if (drawer) {
      await act(L, tid(page, 'category-row-character'));
      await page.waitForTimeout(400);
      dt = await drawerText(drawer);
      rec(L, 'S3-3', '看卡片分類內看得到同一張卡片標題', dt.includes(CARD_TITLE) && !dt.includes(SAMPLE_ROLE) && !dt.includes(NOTICE), dt.slice(0, 120));
      const row = drawer.locator('[data-testid^="card-select-"]').first();
      if (await vis(row)) {
        await act(L, row);
        await page.waitForTimeout(400);
        dt = await drawerText(drawer);
        rec(L, 'S3-4', '看卡片內容層：看得到同一張的內容、不再有「只能看」（WO-64 改定案）', dt.includes(CARD_BODY) && !dt.includes('只能看') && !dt.includes(NOTICE), dt.slice(0, 120));
        await shot(page, L, 'S3-自己的卡片-看卡片內容');
      }
      const back2 = drawer.locator('button[aria-label*="返回"]').first();
      if (await vis(back2)) { await act(L, back2); await page.waitForTimeout(300); }
      await shot(page, L, 'S3-自己的卡片-看卡片清單');
      await closeDrawer(page, L);
      rec(L, 'S3-5', '看卡片可關閉', !(await vis(tid(page, 'writing-cards-drawer'))), '關閉後面板不可見');
    }

    // ── S4 另存再用「開啟稿子」開回 ──
    await gotoTab(page, L, 'files');
    const saveAs = tid(page, 'save-as-project').first();
    const dlWait = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
    if (await vis(saveAs)) await act(L, saveAs);
    const dl = await dlWait;
    rec(L, 'S4-0', '另存測試稿取得 .db 下載', !!dl, dl ? dl.suggestedFilename() : `沒有下載（另存鈕可見：${await vis(saveAs)}）`);
    if (!dl) await shot(page, L, 'S4-0-另存無下載');
    if (dl) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo7475-'));
      const out = path.join(tmpDir, `看卡片測試-${L.id}.db`);
      await dl.saveAs(out);
      await page.waitForTimeout(1500);
      await closeToHome(page, L);
      const chooserWait = page.waitForEvent('filechooser', { timeout: 10000 }).catch(() => null);
      await act(L, page.getByRole('button', { name: '開啟稿子' }));
      const chooser = await chooserWait;
      if (chooser) {
        await chooser.setFiles(out);
        await page.waitForURL(/\/p\/[^/]+\/write/, { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(1200);
      }
      rec(L, 'S4-1', '用「開啟稿子」選回檔案並進入寫作頁', !!chooser && /\/p\/[^/]+\/write/.test(page.url()), page.url().replace(BASE, ''));
      ds = await datasetText(page, L);
      const cat4 = tid(page, 'category-row-character').first();
      if (await vis(cat4)) { await act(L, cat4); await page.waitForTimeout(400); ds = await bodyText(page); }
      rec(L, 'S4-2', '另存再開：資料集仍是這份卡片，沒有範例卡片、沒有提示句', !!ds && ds.includes(CARD_TITLE) && !ds.includes(NOTICE) && !ds.includes(SAMPLE_ROLE), (ds || '無').slice(0, 120));
      if (await gotoTab(page, L, 'files')) {
        rec(L, 'S4-1b', '另存再開：檔案頁看得到目前的稿子是這份測試稿', (await bodyText(page)).includes(BOOK), BOOK);
        await shot(page, L, 'S4-另存再開-稿名（檔案頁）');
      }
      ds = await datasetText(page, L);
      if (await vis(tid(page, 'category-row-character'))) { await act(L, tid(page, 'category-row-character')); await page.waitForTimeout(400); }
      await shot(page, L, 'S4-另存再開-資料集無提示');
      const ed4 = await openEditor(page, L, null);
      drawer = ed4 ? await openDrawer(page, L) : null;
      dt = drawer ? await drawerText(drawer) : '';
      const label4 = drawer ? (await tid(page, 'category-row-character').first().getAttribute('aria-label').catch(() => '')) : '';
      rec(L, 'S4-3', '另存再開：看卡片角色 1 張、沒有提示句、沒有範例卡片', !!drawer && label4 === '角色，1 張卡片' && !dt.includes(NOTICE) && !dt.includes(SAMPLE_ROLE) && !dt.includes(EMPTY_HINT), `${label4}｜${dt.slice(0, 100)}`);
      if (drawer) {
        await act(L, tid(page, 'category-row-character'));
        await page.waitForTimeout(400);
        dt = await drawerText(drawer);
        rec(L, 'S4-4', '另存再開：看卡片分類內是同一張卡片、沒有提示句', dt.includes(CARD_TITLE) && !dt.includes(NOTICE), dt.slice(0, 120));
        await shot(page, L, 'S4-另存再開-看卡片無提示');
        await closeDrawer(page, L);
      }
    }
  } catch (err) {
    rec(L, 'ERR', '執行中斷', false, err.message);
    await shot(page, L, 'ERR-中斷');
  } finally {
    await browser.close();
  }
}

for (const L of LAYOUTS) await runLayout(L);

const failed = results.filter((r) => r.status === 'failed');
fs.writeFileSync(path.join(RUN_DIR, 'results.json'), JSON.stringify(results, null, 2));
console.log(`\n共 ${results.length} 項，通過 ${results.length - failed.length}，失敗 ${failed.length}`);
process.exit(failed.length ? 1 : 0);
