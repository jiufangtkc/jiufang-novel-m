/**
 * WO-63：全書搜尋與找與取代，四種版面從畫面正常操作驗證。
 *
 * 只從畫面操作（點、打字、讀可見文字與元素位置），不 force 點擊、不用 evaluate 改狀態或呼叫 App 內部函式、
 * 不跳內部網址：一律從首頁點【範例】霧港紀事，再從目錄點章、從放大鏡（或寬版「目錄｜搜尋」切換）進搜尋。
 * 唯一用到 evaluate 的地方是唯讀讀取正文框游標位置與清單捲動位置。
 * 組字以 Chromium CDP Input.imeSetComposition／Input.insertText 送出（瀏覽器層級的組字事件，非實機注音）。
 * 只用內建【範例】書；每個版面各開新的瀏覽器環境，不寫入任何真書稿或 .db。
 *
 * 環境變數：BASE、RUN_LABEL、PLAYWRIGHT_MODULE、CHROMIUM_PATH、LAYOUTS（除錯用）、QA_DIR、SHOT_DIR。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumPath, loadPlaywright } from '../playwright-env.mjs';

const { chromium } = loadPlaywright();
const BASE = (process.env.BASE || 'http://127.0.0.1:4173').replace(/\/$/, '');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const QA_DIR = process.env.QA_DIR || path.join(REPO_ROOT, 'test-results', 'qa', '全書搜尋');
const RUN_LABEL = process.env.RUN_LABEL || 'WO-63';
const RUN_DIR = path.join(QA_DIR, RUN_LABEL);
const SHOT_DIR = process.env.SHOT_DIR || RUN_DIR;
fs.mkdirSync(RUN_DIR, { recursive: true });
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ALL = [
  { id: 'phone-portrait', name: '手機直拿', short: '直拿390x844', viewport: { width: 390, height: 844 }, touch: true },
  { id: 'phone-landscape', name: '手機橫拿', short: '橫拿844x390', viewport: { width: 844, height: 390 }, touch: true },
  { id: 'tablet-portrait', name: '中等', short: '中等768x1024', viewport: { width: 768, height: 1024 }, touch: true },
  { id: 'desktop-wide', name: '寬版', short: '寬版1280x800', viewport: { width: 1280, height: 800 }, touch: false },
];
const only = (process.env.LAYOUTS || '').split(',').filter(Boolean);
const LAYOUTS = only.length ? ALL.filter((l) => only.includes(l.id)) : ALL;
const SAMPLE = '【範例】霧港紀事';
const Q = '燈塔';
const R = '燈臺';
const CORE_CARD = '10000000-0000-4000-8000-000000000001';
const CORE_TITLE = '【範例】核心主線：燈塔熄滅之夜';

const vis = (loc) => loc.first().isVisible().catch(() => false);
const act = (L, loc) => (L.touch ? loc.first().tap({ timeout: 8000 }) : loc.first().click({ timeout: 8000 }));
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const text = async (loc) => ((await loc.first().textContent().catch(() => '')) || '').trim();

const results = [];
function rec(L, step, item, ok, expected, actual) {
  results.push({ layout: L.name, step, item, status: ok ? 'passed' : 'failed', expected, actual: String(actual) });
  console.log(`[${L.name}] ${ok ? '通過' : '失敗'} ${step} ${item} :: ${actual}`);
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

async function openChapter(page, L, title) {
  if (!(await gotoTab(page, L, 'write')) && !page.url().includes('/write')) return null;
  const row = page.locator('.tree-row[data-node-id] .tree-main', { hasText: title }).first();
  if (!(await vis(row))) {
    for (const s of ['[data-testid="back-button"]', '[data-testid="toggle-tree-topbar"]', '[data-testid="toggle-tree-floating"]']) {
      const b = page.locator(s).first();
      if (await vis(b)) {
        await act(L, b);
        await page.waitForTimeout(600);
        if (await vis(row)) break;
      }
    }
  }
  if (!(await vis(row))) return null;
  await act(L, row);
  const input = tid(page, 'writing-input').first();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(500);
  const close = tid(page, 'close-tree-pane').first();
  if (L.id !== 'desktop-wide' && (await vis(close))) {
    await act(L, close);
    await page.waitForTimeout(500);
  }
  return input;
}

/** 從資料集分頁讀「核心主線」卡片標題與內容（畫面上看得到的字）。 */
async function readCoreCard(page, L) {
  if (!(await gotoTab(page, L, 'cards'))) return null;
  const cat = tid(page, 'category-row-summary').first();
  if (await vis(cat)) {
    await act(L, cat);
    await page.waitForTimeout(400);
  }
  const card = tid(page, `card-select-${CORE_CARD}`).first();
  if (!(await vis(card))) return null;
  const title = await text(card);
  await act(L, card);
  await page.waitForTimeout(500);
  const raw = tid(page, 'card-raw-content').first();
  if (!(await vis(raw))) return null;
  return { title, content: await text(raw) };
}

async function caret(input) {
  return input.evaluate((el) => ({ start: el.selectionStart, end: el.selectionEnd }));
}

function nthIndexEnd(value, q, ordinal) {
  let at = -1;
  for (let i = 0; i <= ordinal; i += 1) {
    at = value.indexOf(q, at + (i === 0 ? 0 : q.length));
    if (at === -1) return -1;
  }
  return at + q.length;
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, name) });
}

/** 搜尋畫面裡看得到的按鈕都要至少 44×44。 */
async function smallButtons(page, scope) {
  const btns = page.locator(`${scope} button`);
  const bad = [];
  for (let i = 0; i < (await btns.count()); i += 1) {
    const b = btns.nth(i);
    if (!(await b.isVisible().catch(() => false))) continue;
    const box = await b.boundingBox();
    if (box && (box.width < 43.5 || box.height < 43.5)) bad.push(`${(await b.getAttribute('aria-label')) || (await text(b))} ${Math.round(box.width)}×${Math.round(box.height)}`);
  }
  return bad;
}

async function openSearch(page, L, via = 'entry') {
  const sel =
    via === 'tab' ? 'tree-tab-search' : L.id === 'phone-landscape' ? 'search-open-landscape' : 'search-open-topbar';
  const btn = tid(page, sel).first();
  const box = await btn.boundingBox().catch(() => null);
  const shown = await vis(btn);
  if (shown) await act(L, btn);
  await page.waitForTimeout(500);
  return { shown, box };
}

async function runLayout(L) {
  const opts = { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] };
  const exe = chromiumPath();
  const browser = await chromium.launch(exe ? { ...opts, executablePath: exe } : opts);
  const ctxOpts = { viewport: L.viewport, locale: 'zh-TW', timezoneId: 'Asia/Taipei' };
  if (L.touch) Object.assign(ctxOpts, { hasTouch: true, isMobile: true });
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const panel = () => tid(page, 'book-search-panel').first();
  const summary = () => text(tid(page, 'search-summary'));
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="home-screen"]', { timeout: 20000 });
    await act(L, page.locator('[data-testid="project-card"] a', { hasText: SAMPLE }).first());
    await page.waitForURL(/\/p\/[^/]+\//, { timeout: 15000 });

    // 0. 取代前先記下卡片原文
    const card0 = await readCoreCard(page, L);
    rec(L, 'S0', '取代前：資料集「核心主線」卡片含「燈塔」', Boolean(card0) && card0.content.includes(Q) && card0.title.includes(Q), `標題與內容含「${Q}」`, card0 ? `${card0.title}／${card0.content.slice(0, 20)}…` : '讀不到');

    let input = await openChapter(page, L, '第一章');
    if (!input) throw new Error('走不到第一章');

    // 1. 專注模式原入口仍在
    const focusSel = L.id === 'phone-portrait' ? 'thumb-focus-button' : L.id === 'phone-landscape' ? 'toggle-focus-landscape' : 'enter-focus-mode';
    rec(L, 'S1', '專注模式原入口仍在（直拿為拇指區第三顆）', await vis(tid(page, focusSel)), focusSel, (await vis(tid(page, focusSel))) ? '看得到' : '看不到');

    // 2. 從定案入口進搜尋
    const focusBox = L.id === 'tablet-portrait' || L.id === 'desktop-wide' ? await tid(page, 'enter-focus-mode').boundingBox() : null;
    const entry = await openSearch(page, L);
    const entryOk = entry.shown && entry.box && entry.box.width >= 44 && entry.box.height >= 44;
    let where = '';
    if (entry.box) {
      if (L.id === 'phone-landscape') where = entry.box.x < 80 ? '左側' : '不在左側';
      else where = entry.box.y < 60 ? (entry.box.x > L.viewport.width / 2 ? '頁首右側' : '頁首左側') : '不在頁首';
    }
    const leftOfFocus = focusBox ? entry.box && entry.box.x + entry.box.width <= focusBox.x + 1 : true;
    const treeBox = L.id === 'phone-landscape' ? await tid(page, 'toggle-tree-floating').boundingBox().catch(() => null) : null;
    rec(L, 'S2', '入口看得到、至少 44×44、位置照定案', entryOk && leftOfFocus && where !== '不在頁首' && where !== '不在左側', L.id === 'phone-landscape' ? '左側第二顆、目錄下面' : L.id === 'phone-portrait' ? '頁首右上' : '頁首、在專注模式左邊', `${entry.box ? `${Math.round(entry.box.width)}×${Math.round(entry.box.height)}@(${Math.round(entry.box.x)},${Math.round(entry.box.y)})` : '無'} ${where}${leftOfFocus ? '' : '、不在專注模式左邊'}${treeBox ? `；目錄鈕 y=${Math.round(treeBox.y)}` : ''}`);
    rec(L, 'S3', '打開後是全書搜尋畫面', await vis(panel()), '看得到搜尋畫面', (await vis(panel())) ? `看得到（${await panel().getAttribute('data-variant')}）` : '看不到');
    const closeAria = await tid(page, 'search-close').first().getAttribute('aria-label').catch(() => null);
    if (L.id !== 'desktop-wide') rec(L, 'S3b', '搜尋頁返回／關閉鈕朗讀「返回寫作」', closeAria === '返回寫作', '返回寫作', closeAria);

    // 3. 平常只搜尋：沒有取代欄與按鈕；黃框一直顯示
    const noteText = await text(tid(page, 'body-only-note'));
    rec(L, 'S4', '平常只搜尋：沒有取代欄與取代鈕；黃框一直顯示', !(await vis(tid(page, 'replace-input'))) && !(await vis(tid(page, 'replace-all'))) && noteText === '只改正文，資料集的卡片不會改', '無取代欄、黃框文字正確', `取代欄${(await vis(tid(page, 'replace-input'))) ? '有' : '無'}、黃框「${noteText}」`);

    await tid(page, 'search-input').first().fill(Q);
    await page.waitForTimeout(400);
    const s1 = await summary();
    const groups = await tid(page, 'search-group').count();
    const counts = await tid(page, 'search-group-count').allTextContents();
    const marks = await page.locator('[data-testid="search-hit"] mark').count();
    rec(L, 'S5', '預設全書：搜尋列「共 N 處，在 M 章」、依章分組標處數、關鍵字反白', s1 === '共 10 處，在 6 章' && groups === 6 && counts[0] === '4 處' && marks === 10, '共 10 處，在 6 章、6 組、第一章 4 處、10 個反白', `${s1}、${groups} 組、${counts.join('／')}、${marks} 個反白`);
    const hit0 = await text(tid(page, 'search-hit'));
    rec(L, 'S6', '每筆有前後文', hit0.startsWith('…') && hit0.includes(Q) && hit0.length > Q.length + 6, '…前文燈塔後文…', hit0);
    await shot(page, `${L.short}-1找-搜尋結果依章分組.png`);

    await act(L, tid(page, 'scope-chapter'));
    await page.waitForTimeout(300);
    const s2 = await summary();
    rec(L, 'S7', '切「這一章」只搜第一章', s2 === '共 4 處，在 1 章', '共 4 處，在 1 章', s2);
    await act(L, tid(page, 'scope-book'));
    await page.waitForTimeout(300);

    // 4. 點結果跳正文：第二章第 2 處（全部第 6 處）
    const listBox = tid(page, 'search-results').first();
    const target = tid(page, 'search-hit').nth(5);
    await target.scrollIntoViewIfNeeded();
    const scrollBefore = await listBox.evaluate((el) => el.scrollTop);
    await act(L, target);
    await page.waitForTimeout(800);
    input = tid(page, 'writing-input').first();
    const v2 = await input.inputValue();
    const c2 = await caret(input);
    const expectEnd = nthIndexEnd(v2, Q, 1);
    const cur = await page.locator('[data-testid="search-mark-overlay"] .search-mark.is-current').count();
    const all = await page.locator('[data-testid="search-mark-overlay"] .search-mark').count();
    rec(L, 'S8', '點結果跳到第二章那一處：游標在那處後面、目前這處深黃、其他處淡黃', page.url().endsWith('/write/ch-2') && c2.start === expectEnd && cur === 1 && all === 2, `ch-2、游標 ${expectEnd}、深黃 1 淡黃 1`, `${page.url().split('/').pop()}、游標 ${c2.start}、深黃 ${cur}／共 ${all}`);
    const markBox = await page.locator('.search-mark.is-current').first().boundingBox();
    const inBox = await input.boundingBox();
    rec(L, 'S9', '那一處捲到看得見', Boolean(markBox && inBox && markBox.y >= inBox.y && markBox.y + markBox.height <= inBox.y + inBox.height), '在正文可見範圍', markBox ? `y=${Math.round(markBox.y)}` : '無');
    if (L.id === 'phone-portrait') {
      const count = await text(tid(page, 'search-thumb-count'));
      const backAria = await tid(page, 'search-back-to-results').getAttribute('aria-label');
      const backText = await text(tid(page, 'search-back-to-results'));
      rec(L, 'S10', '直拿拇指區換成「第 6／10 處 ‹ › 回結果」，朗讀「返回搜尋結果」', count === '第 6／10 處' && backText === '回結果' && backAria === '返回搜尋結果' && !(await vis(tid(page, 'thumb-bar'))), '第 6／10 處、回結果', `${count}、${backText}（${backAria}）`);
      const navBad = await smallButtons(page, '[data-testid="search-thumb-nav"]');
      rec(L, 'S10b', '拇指區搜尋鈕至少 44×44', navBad.length === 0, '0 個太小', navBad.join('、') || '0 個太小');
    } else {
      rec(L, 'S10', '面板留著、正文讓位不被蓋住', (await vis(panel())) && (await (async () => {
        const p = await panel().boundingBox();
        const e = await input.boundingBox();
        return p && e && (L.id === 'desktop-wide' ? e.x >= p.x + p.width - 1 : e.x + e.width <= p.x + 1);
      })()), '面板與正文不重疊', '已檢查');
    }
    await shot(page, `${L.short}-2找-跳到正文深淺黃反白.png`);

    // 5. 組字中按跳轉：先送出組字，再依最新正文跳過去
    if (L.id === 'phone-portrait') {
      // 直拿：點正文開始打字時鍵盤升起，拇指區（含 ‹ ›）收起，組字中按不到跳轉；
      // 選完字、點章名收起鍵盤後拇指區回來，再按 › 跳到下一處，組好的字要留著。
      await act(L, input);
      await page.keyboard.press('Control+End');
      await cdp.send('Input.imeSetComposition', { text: 'ㄏㄠˇ', selectionStart: 3, selectionEnd: 3 });
      await page.waitForTimeout(300);
      const hiddenWhileTyping = !(await vis(tid(page, 'search-next')));
      await cdp.send('Input.insertText', { text: '好' });
      await page.waitForTimeout(300);
      await act(L, page.locator('.editor .topbar h1'));
      await page.waitForTimeout(700);
      const back = await vis(tid(page, 'search-next'));
      if (back) await act(L, tid(page, 'search-next'));
      await page.waitForTimeout(800);
      const moved = page.url().endsWith('/write/sc-1');
      await act(L, tid(page, 'search-prev'));
      await page.waitForTimeout(800);
      const kept = (await tid(page, 'writing-input').first().inputValue()).endsWith('好');
      const c11 = await text(tid(page, 'search-thumb-count'));
      rec(L, 'S11', '直拿組字：打字時拇指區收起（組字中按不到跳轉）；選完字收起鍵盤後按 › 跳下一處，組好的字留著', hiddenWhileTyping && back && moved && kept && c11 === '第 6／10 處', '打字時收起、送出後可跳、「好」留著、‹ 回第 6 處', `打字時${hiddenWhileTyping ? '收起' : '還在'}、收鍵盤後${back ? '回來' : '沒回來'}、${moved ? '跳到 sc-1' : '沒跳'}、「好」${kept ? '留著' : '不見'}、${c11}`);
    } else {
    await act(L, input);
    await page.keyboard.press('Control+End');
    await page.waitForTimeout(200);
    await cdp.send('Input.imeSetComposition', { text: 'ㄏㄠˇ', selectionStart: 3, selectionEnd: 3 });
    await page.waitForTimeout(200);
    const jumpBtn = tid(page, 'search-hit').nth(6);
    await jumpBtn.scrollIntoViewIfNeeded();
    await act(L, jumpBtn);
    await page.waitForTimeout(400);
    // 一次點擊就要完成：點擊後腳本不再送出組字（不呼叫 Input.insertText），只等跳轉。
    await page.waitForTimeout(900);
    const moved = page.url().endsWith('/write/sc-1');
    const scValue = await tid(page, 'writing-input').first().inputValue();
    const scCaret = await caret(tid(page, 'writing-input').first());
    const scExpect = nthIndexEnd(scValue, Q, 0);
    const caretOk = scCaret.start === scExpect;
    const focusKept = await page.evaluate(() => document.activeElement?.tagName === 'TEXTAREA');
    await shot(page, `${L.short}-S11-一次點擊組字中跳轉.png`);
    // 回到第二章確認組字的字（未選字的注音）有留在原文位置
    // （點擊前 ch-2 結尾就是組字的注音，腳本沒有送出任何字）
    {
      const back = tid(page, 'search-hit').nth(5);
      await back.scrollIntoViewIfNeeded();
      await act(L, back);
    }
    await page.waitForTimeout(800);
    const kept = (await tid(page, 'writing-input').first().inputValue()).endsWith('ㄏㄠˇ');
    rec(L, 'S11', '組字中點結果一次：直接送出組字並跳到那一處，組好的字留在原文，游標在那處後面（腳本點擊後未另行送字）', moved && kept && caretOk, '一次點擊到 sc-1、組字「ㄏㄠˇ」留在 ch-2 結尾、游標在第一處後面', `${moved ? '跳到 sc-1' : page.url().split('/').pop()}、組字「ㄏㄠˇ」${kept ? '留在原文' : '不見'}、游標 ${scCaret.start}／預期 ${scExpect}、焦點${focusKept ? '在正文' : '不在正文'}`);
    }

    // 6. 回結果（直拿）：回到清單原本位置
    if (L.id === 'phone-portrait') {
      await act(L, tid(page, 'search-back-to-results'));
      await page.waitForTimeout(500);
      const scrollAfter = await listBox.evaluate((el) => el.scrollTop);
      rec(L, 'S12', '按「回結果」回到結果清單原本位置', (await vis(panel())) && Math.abs(scrollAfter - scrollBefore) <= 4, `scrollTop ${Math.round(scrollBefore)}`, `scrollTop ${Math.round(scrollAfter)}`);
    }

    // 7. 打開找與取代
    await act(L, tid(page, 'find-replace-toggle'));
    await page.waitForTimeout(300);
    rec(L, 'S13', '打開「找與取代」才出現「取代成」欄、取代這處、取代全部', (await vis(tid(page, 'replace-input'))) && (await vis(tid(page, 'replace-one'))) && (await vis(tid(page, 'replace-all'))), '三者都出現', '已檢查');
    await tid(page, 'replace-input').first().fill(R);
    await page.waitForTimeout(200);

    // 8. 取代這處：第一章第 1 處 → 標已取代、焦點移到下一筆
    const firstHitText = await text(tid(page, 'search-hit'));
    await tid(page, 'replace-one').first().scrollIntoViewIfNeeded();
    await act(L, tid(page, 'replace-one'));
    await page.waitForTimeout(500);
    const s3 = await summary();
    const replacedRows = await tid(page, 'search-replaced').count();
    const tag = await text(page.locator('.book-search-done-tag'));
    const curRow = page.locator('[data-testid="search-hit"][aria-current="true"]');
    const curGroup = await curRow.locator('xpath=ancestor::section[1]').getAttribute('data-node-id').catch(() => null);
    const curIndex = await curRow.locator('xpath=..').getAttribute('data-hit-index').catch(() => null);
    rec(L, 'S14', '取代這處：只改那一處、標「已取代」、目前結果移到下一筆', s3 === '共 9 處，在 6 章' && replacedRows === 1 && tag === '已取代' && curGroup === 'ch-1' && curIndex === '0', '共 9 處、1 筆已取代、焦點在第一章下一處', `${s3}、已取代 ${replacedRows}、焦點 ${curGroup} #${curIndex}`);
    void firstHitText;
    const undo1 = await text(tid(page, 'search-undo-bar'));
    rec(L, 'S15', '取代這處後頂端出「復原上次取代」', undo1.includes('已把 1 處「燈塔」換成「燈臺」') && undo1.includes('復原上次取代'), '已把 1 處…、復原上次取代', undo1);

    // 9. 取代全部：先確認；取消不改正文
    await act(L, tid(page, 'replace-all'));
    await page.waitForTimeout(400);
    const dlg = tid(page, 'replace-all-confirm').first();
    const confirmSum = await text(tid(page, 'confirm-summary'));
    const confirmCards = await text(tid(page, 'confirm-cards-note'));
    const details = await tid(page, 'confirm-chapters').count();
    const dlgText = await text(dlg);
    const detailOk = L.id === 'phone-landscape' ? details === 0 : details === 1;
    rec(L, 'S16', '按取代全部先開確認：共 N 處，分布在 M 章、取代前後文字、再說一次卡片不會改並舉例', (await vis(dlg)) && confirmSum === '共 9 處，分布在 6 章' && dlgText.includes('把「燈塔」換成「燈臺」') && confirmCards === `只改正文，資料集的卡片（例如「${CORE_TITLE}」）不會改` && detailOk, `共 9 處，分布在 6 章；${L.id === 'phone-landscape' ? '省略' : '列'}各章明細`, `${confirmSum}｜${confirmCards}｜明細 ${details}`);
    fs.writeFileSync(path.join(RUN_DIR, `${L.short}-確認視窗文字.txt`), `${dlgText}\n`);
    await shot(page, `${L.short}-3取代-取代全部前確認.png`);
    const dlgBad = await smallButtons(page, '[data-testid="replace-all-confirm"]');
    rec(L, 'S16b', '確認視窗按鈕至少 44×44', dlgBad.length === 0, '0 個太小', dlgBad.join('、') || '0 個太小');
    await act(L, tid(page, 'confirm-cancel'));
    await page.waitForTimeout(300);
    rec(L, 'S17', '取消：不改正文', !(await vis(dlg)) && (await summary()) === '共 9 處，在 6 章', '共 9 處，在 6 章', await summary());

    // Esc 取消、Enter 確認（電腦）；觸控直接按「取代全部」
    await act(L, tid(page, 'replace-all'));
    await page.waitForTimeout(300);
    if (!L.touch) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      rec(L, 'S17b', '確認視窗內 Esc 取消', !(await vis(dlg)) && (await summary()) === '共 9 處，在 6 章', '關閉、仍 9 處', `${(await vis(dlg)) ? '還開著' : '已關'}、${await summary()}`);
      await act(L, tid(page, 'replace-all'));
      await page.waitForTimeout(300);
      await page.keyboard.press('Enter');
    } else {
      await act(L, tid(page, 'confirm-replace-all'));
    }
    await page.waitForTimeout(700);
    const done = await text(tid(page, 'replace-done'));
    const s4 = await summary();
    const v4 = await tid(page, 'writing-input').first().inputValue();
    rec(L, 'S18', '取代完成：「已取代 9 處（6 章）　復原」、正文已改', done.startsWith('已取代 9 處（6 章）') && done.endsWith('復原') && s4 === '共 0 處，在 0 章' && !v4.includes(Q) && v4.includes(R), '已取代 9 處（6 章）、0 處、正文是燈臺', `「${done}」、${s4}、正文${v4.includes(Q) ? '仍有燈塔' : '已無燈塔'}`);
    const undo2 = await text(tid(page, 'search-undo-bar'));
    rec(L, 'S19', '頂端持續「復原上次取代」', undo2.includes('已把 9 處「燈塔」換成「燈臺」'), '已把 9 處…', undo2);
    const panelBad = await smallButtons(page, '[data-testid="book-search-panel"]');
    rec(L, 'S20', '搜尋畫面看得到的按鈕都至少 44×44', panelBad.length === 0, '0 個太小', panelBad.join('、') || '0 個太小');
    await shot(page, `${L.short}-4取代-完成提示與復原上次取代.png`);

    // 10. 復原上次取代：只還原取代全部那 9 處，先前「取代這處」那一處不還原
    await act(L, tid(page, 'undo-last-replace'));
    await page.waitForTimeout(600);
    const s5 = await summary();
    rec(L, 'S21', '復原上次取代：只還原該次（9 處回來，先前取代這處那 1 處不還原）', s5 === '共 9 處，在 6 章' && !(await vis(tid(page, 'search-undo-bar'))), '共 9 處，在 6 章、復原列消失', `${s5}、復原列${(await vis(tid(page, 'search-undo-bar'))) ? '還在' : '消失'}`);

    // 再取代全部一次，然後離開搜尋、再進來：不再有復原
    await act(L, tid(page, 'replace-all'));
    await page.waitForTimeout(300);
    await act(L, tid(page, 'confirm-replace-all'));
    await page.waitForTimeout(700);
    const vAfter = await tid(page, 'writing-input').first().inputValue();
    rec(L, 'S22', '再取代全部：正文全換成燈臺', (await summary()) === '共 0 處，在 0 章' && !vAfter.includes(Q), '0 處', await summary());
    if (L.id === 'desktop-wide') {
      await act(L, tid(page, 'tree-tab-tree'));
      await page.waitForTimeout(400);
      rec(L, 'S23', '寬版：左欄切回「目錄」即離開搜尋，目錄回來', !(await vis(panel())) && (await vis(page.locator('.tree-row').first())), '目錄看得到', (await vis(page.locator('.tree-row').first())) ? '看得到' : '看不到');
      const again = await openSearch(page, L, 'tab');
      rec(L, 'S24', '寬版第二個入口：左欄頂端「搜尋」可進入；再進來不再有復原', again.shown && (await vis(panel())) && !(await vis(tid(page, 'search-undo-bar'))) && (await tid(page, 'search-input').inputValue()) === '', '看得到搜尋、沒有復原列', `${(await vis(panel())) ? '搜尋開著' : '沒開'}、復原列${(await vis(tid(page, 'search-undo-bar'))) ? '還在' : '沒有'}`);
    } else {
      await act(L, tid(page, 'search-close'));
      await page.waitForTimeout(400);
      if (L.id === 'phone-portrait') rec(L, 'S23', '離開搜尋後拇指區三顆鈕（含專注模式）回來', await vis(tid(page, 'thumb-focus-button')), '看得到', (await vis(tid(page, 'thumb-focus-button'))) ? '看得到' : '看不到');
      await openSearch(page, L);
      rec(L, 'S24', '離開搜尋後再進來：不再顯示復原上次取代', (await vis(panel())) && !(await vis(tid(page, 'search-undo-bar'))), '沒有復原列', (await vis(tid(page, 'search-undo-bar'))) ? '還在' : '沒有');
    }
    await tid(page, 'search-input').first().fill(R);
    await page.waitForTimeout(300);
    rec(L, 'S25', '正文已改：搜尋「燈臺」共 10 處', (await summary()) === '共 10 處，在 6 章', '共 10 處，在 6 章', await summary());
    if (L.id === 'phone-portrait') {
      await act(L, tid(page, 'search-hit').nth(0));
      await page.waitForTimeout(600);
    }
    await shot(page, `${L.short}-5取代後-正文已改.png`);
    if (L.id === 'phone-landscape' || L.id === 'tablet-portrait') {
      await act(L, tid(page, 'search-close'));
      await page.waitForTimeout(400);
    }

    // 11. 取代後卡片不變：資料集同一張卡片逐字相同
    const card1 = await readCoreCard(page, L);
    rec(L, 'S26', '取代後：資料集「核心主線」卡片標題與內容逐字不變（仍是燈塔）', Boolean(card1 && card0) && card1.title === card0.title && card1.content === card0.content && card1.content.includes(Q), '與取代前相同', card1 ? `${card1.title === card0?.title && card1.content === card0?.content ? '相同' : '不同'}：${card1.content.slice(0, 24)}…` : '讀不到');
    await shot(page, `${L.short}-6取代後-資料集卡片不變.png`);
    rec(L, 'S27', '整趟沒有頁面錯誤', errors.length === 0, '0', errors.join(' | ') || '0');
  } catch (err) {
    rec(L, 'X', '執行中斷', false, '跑完', err?.message || err);
    await shot(page, `${L.short}-中斷.png`).catch(() => {});
  } finally {
    await browser.close();
  }
}

/** iPad 橫拿（1024–1279）：一次只開一邊。開著看卡片時按放大鏡，右欄收起、左欄換搜尋。 */
async function runIpad() {
  const L = { id: 'ipad-landscape', name: 'iPad 橫拿', short: 'iPad橫拿1180x820', viewport: { width: 1180, height: 820 }, touch: false };
  const opts = { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] };
  const exe = chromiumPath();
  const browser = await chromium.launch(exe ? { ...opts, executablePath: exe } : opts);
  const page = await (await browser.newContext({ viewport: L.viewport, locale: 'zh-TW', timezoneId: 'Asia/Taipei' })).newPage();
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="home-screen"]', { timeout: 20000 });
    await act(L, page.locator('[data-testid="project-card"] a', { hasText: SAMPLE }).first());
    await page.waitForURL(/\/p\/[^/]+\//, { timeout: 15000 });
    const input = await openChapter(page, L, '第一章');
    if (!input) throw new Error('走不到第一章');
    await act(L, tid(page, 'toggle-cards-topbar'));
    await page.waitForTimeout(500);
    const asideOpen = await vis(tid(page, 'write-aside'));
    await act(L, tid(page, 'search-open-topbar'));
    await page.waitForTimeout(500);
    const asideAfter = await vis(tid(page, 'write-aside'));
    const searchShown = await vis(tid(page, 'book-search-panel'));
    rec(L, 'S30', '開著看卡片時按放大鏡：右欄收起、左欄換搜尋（一次只開一邊）', asideOpen && !asideAfter && searchShown, '右欄收、左欄搜尋', `看卡片${asideOpen ? '先開著' : '沒開'}→${asideAfter ? '仍開' : '收起'}、搜尋${searchShown ? '開' : '沒開'}`);
    await shot(page, `${L.short}-一次只開一邊-左欄搜尋.png`);
  } catch (err) {
    rec(L, 'X', '執行中斷', false, '跑完', err?.message || err);
  } finally {
    await browser.close();
  }
}

const started = new Date();
for (const L of LAYOUTS) await runLayout(L);
if (!only.length || only.includes('ipad-landscape')) await runIpad();
const failed = results.filter((r) => r.status === 'failed');
const summaryOut = {
  label: RUN_LABEL,
  base: BASE,
  engine: 'chromium',
  started: started.toISOString(),
  finished: new Date().toISOString(),
  layouts: [...LAYOUTS.map((l) => `${l.name} ${l.viewport.width}×${l.viewport.height}`), 'iPad 橫拿 1180×820'],
  passed: results.length - failed.length,
  failed: failed.length,
  results,
};
fs.writeFileSync(path.join(RUN_DIR, 'results.json'), JSON.stringify(summaryOut, null, 2));
console.log(`\n${RUN_LABEL}：通過 ${summaryOut.passed}，失敗 ${summaryOut.failed}；結果 ${path.join(RUN_DIR, 'results.json')}`);
process.exitCode = failed.length ? 1 : 0;
