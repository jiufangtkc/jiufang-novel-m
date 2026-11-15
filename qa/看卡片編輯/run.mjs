/**
 * WO-64：寫作時「看卡片」也能編輯（四種版面）。
 *
 * 全程只從畫面正常操作（點、打字、滑），不 force 點擊、不用 evaluate 改狀態或呼叫內部函式、不跳內部網址。
 * 只用本次新開、書名含【範例】的測試稿；每個版面各開新的瀏覽器環境，不碰真書稿或 .db。
 *
 * 每個版面的情境：
 *   A 在資料集建立一張測試卡片，回寫作頁打一行正文（記下正文）。
 *   B 看卡片內容層：沒有「只能看」、有「編輯」「⋯」。
 *   C 按「編輯」：面板尺寸、位置提示（手機直拿）、正文唯讀。
 *   D 改標題與內容 → 按「完成」：去處、存好提示、正文沒變、游標與鍵盤回正文（手機直拿面板收起）。
 *   E 再編輯並清空標題，離開路徑：手機直拿「往下滑收起」，其餘「點正文」；都要先存卡片。
 *   F 回資料集：同一張卡片已更新；回正文：與編輯前相同。
 *
 * 環境變數：BASE、RUN_LABEL、PLAYWRIGHT_MODULE、CHROMIUM_PATH、LAYOUTS、QA_DIR、SHOT_DIR。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumPath, loadPlaywright } from '../playwright-env.mjs';

const { chromium } = loadPlaywright();
const BASE = (process.env.BASE || 'http://127.0.0.1:4173').replace(/\/$/, '');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const QA_DIR = process.env.QA_DIR || path.join(REPO_ROOT, 'test-results', 'qa', '看卡片編輯');
const RUN_LABEL = process.env.RUN_LABEL || 'WO-64';
const RUN_DIR = path.join(QA_DIR, RUN_LABEL);
const SHOT_DIR = process.env.SHOT_DIR || RUN_DIR;
fs.mkdirSync(RUN_DIR, { recursive: true });
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ALL = [
  { id: 'phone-portrait', name: '手機直拿', viewport: { width: 390, height: 844 }, touch: true },
  { id: 'phone-landscape', name: '手機橫拿', viewport: { width: 844, height: 390 }, touch: true },
  { id: 'tablet-portrait', name: '中等', viewport: { width: 768, height: 1024 }, touch: true },
  { id: 'desktop-wide', name: '寬版', viewport: { width: 1280, height: 800 }, touch: false },
];
const only = (process.env.LAYOUTS || '').split(',').filter(Boolean);
const LAYOUTS = only.length ? ALL.filter((l) => only.includes(l.id)) : ALL;

const CARD_TITLE = '【範例】編輯測試卡';
const CARD_BODY = '這張測試卡的原本內容';
const NEW_TITLE = '【範例】編輯後的卡片標題';
const NEW_BODY = '編輯後的卡片內容，只在卡片裡';
const BODY_TEXT = '【範例】測試正文：他推開門，風從背後灌進來。';

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
  await page.screenshot({ path: path.join(SHOT_DIR, `${L.name}-${name}.png`) }).catch(() => {});
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

async function openEditor(page, L) {
  if (!page.url().includes('/write')) await gotoTab(page, L, 'write');
  if (await cardsButton(page)) return true;
  const row = page.locator('.tree-row[data-node-id] .tree-main');
  for (const s of ['[data-testid="back-button"]', '[data-testid="toggle-tree-topbar"]', '[data-testid="toggle-tree-floating"]']) {
    if (await vis(row)) break;
    const b = page.locator(s).first();
    if (await vis(b)) {
      await act(L, b).catch(() => {});
      await page.waitForTimeout(600);
    }
  }
  if (await vis(row)) await act(L, row);
  await tid(page, 'writing-input').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  const close = tid(page, 'close-tree-pane').first();
  if (L.id !== 'desktop-wide' && (await vis(close))) {
    await act(L, close);
    await page.waitForTimeout(500);
  }
  return !!(await cardsButton(page));
}

/** 打開看卡片，一路點到這張測試卡的內容層。 */
async function openCardLayer(page, L) {
  const drawer = tid(page, 'writing-cards-drawer').first();
  if (!(await vis(drawer))) {
    // 手機直拿完成後面板會收起；其他版面面板仍開著，再按「看卡片」會把它關掉，所以只在沒開時才按
    const b = await cardsButton(page);
    if (!b) return null;
    await act(L, b);
  }
  await drawer.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  if (!(await vis(drawer))) return null;
  for (let i = 0; i < 3 && !(await vis(tid(page, 'category-list'))) && !(await vis(tid(page, 'card-editor-pane'))); i += 1) {
    const back = drawer.locator('button[aria-label*="返回"]').first();
    if (!(await vis(back))) break;
    await act(L, back);
    await page.waitForTimeout(300);
  }
  if (await vis(tid(page, 'category-row-character'))) {
    await act(L, tid(page, 'category-row-character'));
    await page.waitForTimeout(400);
  }
  const row = drawer.locator('[data-testid^="card-select-"]').first();
  if (await vis(row)) {
    await act(L, row);
    await page.waitForTimeout(400);
  }
  return drawer;
}

async function startEdit(page, L, drawer) {
  await act(L, drawer.locator('[data-testid="card-editor-start-edit-btn"]'));
  await page.waitForTimeout(500);
}

async function createDraft(page, L, title) {
  await act(L, page.getByRole('button', { name: '開新稿子' }).first());
  await page.locator('form.dialog input').first().fill(title);
  await act(L, page.locator('form.dialog button[type="submit"]').first());
  await page.waitForURL(/\/p\/[^/]+\/write/, { timeout: 15000 });
  await page.waitForTimeout(700);
}

async function datasetCardText(page, L) {
  // 看卡片還開著就先關（手機橫拿開著時導覽列會讓位）
  const closeBtn = tid(page, 'close-cards-drawer').first();
  if (await vis(closeBtn)) {
    await act(L, closeBtn);
    await page.waitForTimeout(500);
  }
  if (!(await gotoTab(page, L, 'cards'))) return null;
  await tid(page, 'cards-screen').first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  const cat = tid(page, 'category-row-character').first();
  if (await vis(cat)) {
    await act(L, cat);
    await page.waitForTimeout(400);
  }
  const row = page.locator('[data-testid^="card-select-"]').first();
  if (await vis(row)) {
    await act(L, row);
    await page.waitForTimeout(400);
  }
  return bodyText(page);
}

const box = async (loc) => loc.first().boundingBox().catch(() => null);

async function runLayout(L) {
  const opts = { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] };
  const exe = chromiumPath();
  const browser = await chromium.launch(exe && fs.existsSync(exe) ? { ...opts, executablePath: exe } : opts);
  const ctxOpts = { viewport: L.viewport, locale: 'zh-TW', timezoneId: 'Asia/Taipei' };
  if (L.touch) { ctxOpts.hasTouch = true; ctxOpts.isMobile = true; }
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  const BOOK = `【範例】看卡片編輯測試稿-${L.name}-${RUN_LABEL}`;
  const portrait = L.id === 'phone-portrait';
  const wide = L.id === 'desktop-wide';
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="home-screen"]', { timeout: 20000 });
    await createDraft(page, L, BOOK);

    // ── A 資料集建立測試卡片 ──
    await gotoTab(page, L, 'cards');
    const cat = tid(page, 'category-row-character').first();
    if (await vis(cat)) { await act(L, cat); await page.waitForTimeout(400); }
    await act(L, page.getByRole('button', { name: '新增卡片' }));
    await page.waitForTimeout(500);
    const start0 = tid(page, 'card-editor-start-edit-btn').first();
    if (await vis(start0)) { await act(L, start0); await page.waitForTimeout(400); }
    await tid(page, 'card-editor-title-input').first().fill(CARD_TITLE);
    await tid(page, 'card-editor-content-textarea').first().fill(CARD_BODY);
    await act(L, tid(page, 'card-editor-done-btn'));
    await page.waitForTimeout(500);
    rec(L, 'A-1', '資料集已建立測試卡片', (await bodyText(page)).includes(CARD_TITLE), CARD_TITLE);

    // 回寫作頁，打一行正文並記下
    const ed = await openEditor(page, L);
    rec(L, 'A-2', '進得了寫作頁', ed, page.url().replace(BASE, ''));
    const input = tid(page, 'writing-input').first();
    await input.fill(BODY_TEXT);
    const baseline = await input.inputValue();
    await page.waitForTimeout(300);

    // ── B 內容層：沒有只能看，有編輯與 ⋯ ──
    let drawer = await openCardLayer(page, L);
    rec(L, 'B-0', '看卡片打開並進到卡片內容層', !!drawer && (await vis(tid(page, 'card-editor-pane'))), '');
    if (!drawer) throw new Error('看卡片沒有打開');
    const preview = await drawer.innerText();
    rec(L, 'B-1', '內容層沒有「只能看」、看得到同一張卡片', !preview.includes('只能看') && preview.includes(CARD_TITLE) && preview.includes(CARD_BODY), preview.replace(/\s+/g, ' ').slice(0, 80));
    rec(L, 'B-2', '內容層有可按的「編輯」「⋯」', (await vis(drawer.locator('[data-testid="card-editor-start-edit-btn"]'))) && (await vis(drawer.locator('[data-testid="card-editor-more-btn"]'))), '');
    const eb = await box(drawer.locator('[data-testid="card-editor-start-edit-btn"]'));
    const mb = await box(drawer.locator('[data-testid="card-editor-more-btn"]'));
    rec(L, 'B-3', '「編輯」「⋯」至少 44×44', !!eb && !!mb && eb.width >= 44 && eb.height >= 44 && mb.width >= 44 && mb.height >= 44, `${eb && Math.round(eb.width)}×${eb && Math.round(eb.height)}、${mb && Math.round(mb.width)}×${mb && Math.round(mb.height)}`);
    const previewBox = await box(wide ? tid(page, 'write-aside') : drawer);
    await shot(page, L, '1-看卡片預覽有編輯與更多');

    // ── C 按編輯 ──
    await startEdit(page, L, drawer);
    const editing = await vis(drawer.locator('[data-testid="card-editor-title-input"]'));
    rec(L, 'C-1', '按「編輯」進入既有的卡片編輯（標題、顏色、內容）', editing && (await vis(drawer.locator('[data-testid="card-editor-color-btn"], [data-testid="card-editor-thumb-color-btn"]'))) && (await vis(drawer.locator('[data-testid="card-editor-content-textarea"]'))), '');
    rec(L, 'C-2', '編輯中面板標記為編輯中、正文唯讀', (await drawer.getAttribute('data-card-editing')) === 'true' && (await input.getAttribute('readonly')) !== null, '');
    const eBox = await box(wide ? tid(page, 'write-aside') : drawer);
    if (portrait) {
      rec(L, 'C-3', '手機直拿：面板拉到全高', !!eBox && eBox.height >= L.viewport.height - 2 && eBox.y <= 1, `${Math.round(eBox.height)}／${L.viewport.height}`);
      const place = ((await tid(page, 'writing-card-place').first().innerText().catch(() => '')) || '').trim();
      rec(L, 'C-4', '手機直拿：頂端「寫作位置已記住：章名・…那行」', /^寫作位置已記住：.+・.+那行$/.test(place) && place.includes('灌進來'), place);
      const aria = await tid(page, 'writing-card-place').first().getAttribute('aria-label');
      rec(L, 'C-5', '朗讀文字把「・」換成「，」', !!aria && !aria.includes('・') && aria.startsWith('寫作位置已記住：') && aria.includes('，'), aria);
    } else if (L.id === 'phone-landscape') {
      rec(L, 'C-3', '手機橫拿：面板放寬到約 350', !!eBox && eBox.width >= 340 && eBox.width <= 360 && eBox.width > previewBox.width + 30, `${Math.round(previewBox.width)}→${Math.round(eBox.width)}`);
    } else if (L.id === 'tablet-portrait') {
      rec(L, 'C-3', '中等：面板仍在右側、高度不超過畫面（鍵盤上方）', !!eBox && eBox.height <= L.viewport.height + 1 && eBox.x + eBox.width >= L.viewport.width - 1, `${Math.round(eBox.width)}×${Math.round(eBox.height)}`);
    } else {
      rec(L, 'C-3', '寬版：右欄原地放寬到 360', !!eBox && Math.round(eBox.width) === 360 && Math.round(previewBox.width) === 320, `${Math.round(previewBox.width)}→${Math.round(eBox.width)}`);
      const ib = await box(input);
      rec(L, 'C-4', '寬版：正文仍有位置、沒有被右欄擠掉', !!ib && ib.width > 300, ib ? String(Math.round(ib.width)) : '無');
    }
    await shot(page, L, '2-編輯中');

    // ── D 改標題與內容 → 完成 ──
    await tid(page, 'card-editor-title-input').first().fill(NEW_TITLE);
    await tid(page, 'card-editor-content-textarea').first().fill(NEW_BODY);
    const bodyDuring = await input.inputValue().catch(() => null);
    rec(L, 'D-0', '編輯期間正文沒有被改、卡片的字沒貼進正文', bodyDuring === baseline && !bodyDuring.includes(NEW_BODY) && !bodyDuring.includes(NEW_TITLE), String(bodyDuring).slice(0, 40));
    await act(L, tid(page, 'card-editor-done-btn'));
    await page.waitForTimeout(700);
    const savedMsg = `已存好「${NEW_TITLE}」`;
    if (portrait) {
      rec(L, 'D-1', '手機直拿「完成」：面板收起回正文', !(await vis(tid(page, 'writing-cards-drawer'))), '');
      const toast = ((await page.locator('.toast').first().innerText().catch(() => '')) || '').trim();
      rec(L, 'D-2', '手機直拿收起後仍看得到「已存好「○○」」', toast === savedMsg, toast || '看不到提示');
      await shot(page, L, '3-完成後-面板收起且有存好提示');
    } else {
      const still = await vis(tid(page, 'writing-cards-drawer'));
      const previewAgain = await vis(drawer.locator('[data-testid="card-editor-start-edit-btn"]'));
      rec(L, 'D-1', '「完成」後回卡片預覽（面板不收）', still && previewAgain, '');
      const hint = ((await tid(page, 'card-editor-saved-hint').first().innerText().catch(() => '')) || '').trim();
      rec(L, 'D-2', '看得到「已存好「○○」」', hint === savedMsg, hint || '看不到提示');
      const afterBox = await box(wide ? tid(page, 'write-aside') : drawer);
      rec(L, 'D-3', '面板回預覽寬度', !!afterBox && Math.abs(afterBox.width - previewBox.width) <= 2, `${Math.round(afterBox.width)}／${Math.round(previewBox.width)}`);
      await shot(page, L, '3-完成後-回預覽且有存好提示');
    }
    // D-6 完成後預覽標頭：標題不直排、提示獨立一列、內容區可見（只看畫面上元素的位置與尺寸）
    if (!portrait) {
      const root = wide ? tid(page, 'write-aside') : drawer;
      const panel = await box(root);
      const hdr = await box(drawer.locator('.card-preview-header'));
      const ttl = await box(drawer.locator('.card-preview-body .card-detail-heading'));
      const hnt = await box(drawer.locator('[data-testid="card-editor-saved-hint"]'));
      const edb = await box(drawer.locator('[data-testid="card-editor-start-edit-btn"]'));
      const mob = await box(drawer.locator('[data-testid="card-editor-more-btn"]'));
      const cont = await box(drawer.locator('.card-preview-body'));
      const lh = await drawer.locator('.card-preview-body .card-detail-heading').evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.3);
      const lines = ttl ? Math.round(ttl.height / lh) : 99;
      const notVertical = !!ttl && ttl.width >= 100 && lines <= 3;
      rec(L, 'D-6a', '完成後標題（內容區大標）不直排（寬度≥100、最多三行）', notVertical, ttl ? `${Math.round(ttl.width)}×${Math.round(ttl.height)}，約 ${lines} 行` : '無');
      rec(L, 'D-6b', '完成後標頭高度合理（≤ 面板一半且 ≤ 150）', !!hdr && !!panel && hdr.height <= panel.height / 2 && hdr.height <= 150, hdr ? `${Math.round(hdr.height)}／${Math.round(panel.height)}` : '無');
      rec(L, 'D-6c', '「已存好」提示獨立一列（在按鈕列下、標題上）、寬度足夠', !!hnt && !!ttl && !!edb && hnt.y >= edb.y + edb.height - 1 && hnt.y + hnt.height <= ttl.y + 1 && hnt.width >= 100, hnt ? `${Math.round(hnt.width)}×${Math.round(hnt.height)}` : '無');
      rec(L, 'D-6d', '「編輯」「⋯」仍在標頭內、未被擠出且仍 ≥44×44', !!edb && !!mob && !!hdr && edb.width >= 44 && edb.height >= 44 && mob.width >= 44 && mob.height >= 44 && edb.x + edb.width <= hdr.x + hdr.width + 1 && mob.x + mob.width <= hdr.x + hdr.width + 1, '');
      const contOk = !!cont && !!panel && cont.height >= 80 && cont.y + Math.min(cont.height, 80) <= panel.y + panel.height + 1 && cont.height >= panel.height / 3 - 1;
      rec(L, 'D-6e', '完成後內容區（標頭以下可捲動區）可見（高度≥80 且 ≥ 面板三分之一）', contOk, cont ? `${Math.round(cont.height)}／${Math.round(panel.height)}` : '無');
      const txt = ((await drawer.locator('[data-testid="card-editor-preview-content"]').innerText().catch(() => '')) || '').trim();
      rec(L, 'D-6f', '完成後讀得到卡片內容文字', txt.includes(NEW_BODY.slice(0, 6)), txt.slice(0, 30));
      await shot(page, L, '3b-完成後-標頭與內容區檢查');
    }
    const afterDone = await input.inputValue();
    rec(L, 'D-4', '完成後正文與編輯前相同', afterDone === baseline, afterDone.slice(0, 40));
    rec(L, 'D-5', '完成後游標與鍵盤回到正文（正文取得焦點、不再唯讀）', (await page.locator('[data-testid="writing-input"]:focus').count()) === 1 && (await input.getAttribute('readonly')) === null, '');

    // ── E 再編輯並清空標題；離開路徑 ──
    drawer = await openCardLayer(page, L);
    if (!drawer) throw new Error('第二次打開看卡片失敗');
    const reopened = await drawer.innerText();
    rec(L, 'E-0', '重新打開看卡片：已是更新後的同一張卡片', reopened.includes(NEW_TITLE) && reopened.includes(NEW_BODY), reopened.replace(/\s+/g, ' ').slice(0, 60));
    await startEdit(page, L, drawer);
    await tid(page, 'card-editor-title-input').first().fill('');
    await tid(page, 'card-editor-content-textarea').first().fill(`${NEW_BODY}（第二次）`);
    const blankMsg = '已存好「未命名卡片」';
    if (portrait) {
      // 往下滑收起：從頂端位置列往下拖
      const place = tid(page, 'writing-card-place').first();
      const pb = await box(place);
      await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
      await page.mouse.down();
      await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2 + 140, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(700);
      rec(L, 'E-1', '往下滑收起：面板收起', !(await vis(tid(page, 'writing-cards-drawer'))), '');
      const toast = ((await page.locator('.toast').first().innerText().catch(() => '')) || '').trim();
      rec(L, 'E-2', '往下滑收起前先存卡片：標題空白顯示「已存好「未命名卡片」」', toast === blankMsg, toast || '看不到提示');
      await shot(page, L, '4-往下滑收起-先存卡片');
    } else {
      const ib = await box(input);
      const pos = { x: Math.min(60, Math.max(10, ib.width / 4)), y: 40 };
      await (L.touch ? input.tap({ position: pos, timeout: 8000 }) : input.click({ position: pos, timeout: 8000 }));
      await page.waitForTimeout(700);
      rec(L, 'E-1', '點正文：結束編輯', (await drawer.getAttribute('data-card-editing')) === null && (await input.getAttribute('readonly')) === null, '');
      const hint = ((await tid(page, 'card-editor-saved-hint').first().innerText().catch(() => '')) || '').trim();
      rec(L, 'E-2', '點正文前先存卡片：標題空白顯示「已存好「未命名卡片」」', hint === blankMsg, hint || '看不到提示');
      rec(L, 'E-3', '點正文後游標落在剛點的位置（正文取得焦點）', (await page.locator('[data-testid="writing-input"]:focus').count()) === 1, '');
      const afterBody = await input.inputValue();
      rec(L, 'E-4', '點正文後正文與編輯前相同', afterBody === baseline, afterBody.slice(0, 40));
      await shot(page, L, '4-點正文-先存卡片並結束編輯');
    }

    // ── F 回資料集，同一張卡片已更新 ──
    const ds = await datasetCardText(page, L);
    rec(L, 'F-1', '資料集看得到同一張卡片的更新（未命名卡片＋第二次內容）', !!ds && ds.includes('未命名卡片') && ds.includes(`${NEW_BODY}（第二次）`) && !ds.includes(CARD_BODY), (ds || '無').slice(0, 80));
    await shot(page, L, '5-資料集看到更新後的卡片');
    const cardsInDataset = await page.locator('[data-testid^="card-select-"]').count();
    rec(L, 'F-2', '資料集沒有因編輯多出第二張卡片', cardsInDataset <= 1, String(cardsInDataset));
    await openEditor(page, L);
    const finalBody = await tid(page, 'writing-input').first().inputValue();
    rec(L, 'F-3', '回到正文：與編輯前完全相同、沒有任何卡片文字', finalBody === baseline && !finalBody.includes('編輯後') && !finalBody.includes('未命名'), finalBody.slice(0, 40));
    await shot(page, L, '6-回正文-內容未變');
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
