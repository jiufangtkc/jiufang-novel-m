/**
 * WO-76 內建範例書字數：首頁清單、統計全書、寫作頁本章，在「打字 → 立刻暫存稿子 → 重新整理（重開 App）」前後一致。
 *
 * 只從畫面操作（點、打字、讀可見文字），不呼叫 App 內部函式、不改狀態、不 force 點擊。
 * 原問題：範例書一字未改，按「立刻暫存稿子」後全書 666 變 577、第一章 252 變 220。
 * 範例書的「另存 → 開檔重開」由單元測試 src/state/wo76WordCount.test.ts 覆蓋；新稿的另存重開見 run.mjs。
 *
 * 環境變數：BASE、ENGINE（chromium）、RUN_LABEL、PLAYWRIGHT_MODULE、CHROMIUM_PATH、LAYOUTS（除錯用）、QA_DIR。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumPath, loadPlaywright } from '../playwright-env.mjs';

const { chromium } = loadPlaywright();
const BASE = (process.env.BASE || 'http://127.0.0.1:4173').replace(/\/$/, '');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const QA_DIR = process.env.QA_DIR || path.join(REPO_ROOT, 'test-results', 'qa', '存檔再開');
const RUN_LABEL = process.env.RUN_LABEL || 'WO-76-範例書';
const RUN_DIR = path.join(QA_DIR, RUN_LABEL);
fs.mkdirSync(RUN_DIR, { recursive: true });

const ALL = [
  { id: 'phone-portrait', name: '手機直拿', viewport: { width: 390, height: 844 }, touch: true },
  { id: 'phone-landscape', name: '手機橫拿', viewport: { width: 844, height: 390 }, touch: true },
  { id: 'tablet-portrait', name: '中等', viewport: { width: 768, height: 1024 }, touch: true },
  { id: 'desktop-wide', name: '寬版', viewport: { width: 1280, height: 800 }, touch: false },
];
const only = (process.env.LAYOUTS || '').split(',').filter(Boolean);
const LAYOUTS = only.length ? ALL.filter((l) => only.includes(l.id)) : ALL;
const SAMPLE = '【範例】霧港紀事';
const CHAPTER = '第一章';
/** 打進第一章的文字：全形標點、英文單字、小數各一。 */
const TYPED = '霧散了，她說OK，潮位3.5米。';

// 與 run.mjs 相同的定案算法（測試自算，不呼叫 App 內部函式）
function expectedWordCount(text) {
  let total = 0;
  for (const seg of String(text).split(/[\s　]+/u)) {
    for (const piece of seg.match(/[\x21-\x7e]+|[^\x21-\x7e]/gu) || []) {
      if (piece.length === 1 && !/[\x21-\x7e]/.test(piece)) total += 1;
      else total += /[A-Za-z0-9]/.test(piece) ? 1 : piece.length;
    }
  }
  return total;
}
const num = (s, re) => { const m = String(s || '').match(re); return m ? Number(m[1].replace(/,/g, '')) : null; };
const act = (L, loc) => (L.touch ? loc.tap({ timeout: 8000 }) : loc.click({ timeout: 8000 }));
const vis = (loc) => loc.first().isVisible().catch(() => false);

const results = [];
function rec(L, step, item, ok, expected, actual) {
  results.push({ layout: L.name, step, item, status: ok ? 'passed' : 'failed', expected, actual });
  console.log(`[${L.name}] ${ok ? '通過' : '失敗'} ${step} ${item} :: ${actual}`);
}

async function gotoTab(page, L, tab) {
  const nav = L.id === 'desktop-wide' || L.id === 'phone-landscape' ? '[data-testid="nav-rail"]' : '[data-testid="bottom-nav"]';
  const btn = page.locator(`${nav} [data-testid="nav-${tab}"]`).first();
  await btn.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  if (!(await vis(btn))) {
    for (const s of ['[data-testid="toggle-tree-floating"]', '[data-testid="back-button"]']) {
      const b = page.locator(s).first();
      if (await vis(b)) { await act(L, b); await page.waitForTimeout(600); if (await vis(btn)) break; }
    }
  }
  if (!(await vis(btn))) return false;
  await act(L, btn);
  await page.waitForTimeout(700);
  return page.url().includes(`/${tab}`);
}

async function homeWords(page) {
  const card = page.locator('[data-testid="project-card"]', { hasText: SAMPLE }).first();
  return num(await card.innerText().catch(() => ''), /字數：\s*([\d,]+)/);
}
async function statsBook(page, L) {
  if (!(await gotoTab(page, L, 'stats'))) return null;
  await page.waitForSelector('[data-testid="stats-screen"]', { timeout: 6000 }).catch(() => {});
  return num(await page.locator('[data-testid="stats-screen"]').innerText().catch(() => ''), /目前\s*([\d,]+)\s*字/);
}
async function openChapter(page, L) {
  if (!(await gotoTab(page, L, 'write')) && !page.url().includes('/write')) return null;
  const row = page.locator('.tree-row[data-node-id] .tree-main', { hasText: CHAPTER }).first();
  if (!(await vis(row))) {
    for (const s of ['[data-testid="back-button"]', '[data-testid="toggle-tree-topbar"]', '[data-testid="toggle-tree-floating"]']) {
      const b = page.locator(s).first();
      if (await vis(b)) { await act(L, b); await page.waitForTimeout(600); if (await vis(row)) break; }
    }
  }
  if (!(await vis(row))) return null;
  await act(L, row);
  const input = page.locator('[data-testid="writing-input"]').first();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  return {
    input,
    body: await input.inputValue(),
    shown: num(await page.locator('[data-testid="chapter-word-count"]').first().textContent().catch(() => ''), /([\d,]+)/),
  };
}

async function runLayout(L) {
  const opts = { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] };
  const exe = chromiumPath();
  const browser = await chromium.launch(exe ? { ...opts, executablePath: exe } : opts);
  const ctxOpts = { viewport: L.viewport, locale: 'zh-TW', timezoneId: 'Asia/Taipei' };
  if (L.touch) Object.assign(ctxOpts, { hasTouch: true, isMobile: true });
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="home-screen"]', { timeout: 20000 });
    const home1 = await homeWords(page);
    await act(L, page.locator('[data-testid="project-card"] a', { hasText: SAMPLE }).first());
    await page.waitForURL(/\/p\/[^/]+\//, { timeout: 15000 });
    const stats1 = await statsBook(page, L);
    rec(L, 'Y1', '打字前：首頁清單與統計全書字數相同', home1 !== null && home1 === stats1, '兩者相同', `首頁 ${home1}、統計 ${stats1}`);

    const ch1 = await openChapter(page, L);
    if (!ch1) throw new Error('走不到第一章');
    rec(L, 'Y2', '打字前：本章字數符合定案算法（不含章名）', ch1.shown === expectedWordCount(ch1.body), `自算 ${expectedWordCount(ch1.body)}`, `畫面 ${ch1.shown}`);

    // 打字：游標放到正文最後，接著打
    await act(L, ch1.input);
    await page.keyboard.press('Control+End');
    await page.keyboard.type(TYPED, { delay: 20 });
    await page.waitForTimeout(3500);
    const after = await ch1.input.inputValue();
    const shown2 = num(await page.locator('[data-testid="chapter-word-count"]').first().textContent(), /([\d,]+)/);
    const add = expectedWordCount(TYPED);
    rec(L, 'Y3', `打字後：本章增加 ${add}（「${TYPED}」）`, shown2 === ch1.shown + add && shown2 === expectedWordCount(after), `本章 ${ch1.shown + add}`, `畫面 ${shown2}`);
    await page.locator('[data-testid="writing-input"]').first().blur();
    await page.waitForTimeout(800);

    const stats2 = await statsBook(page, L);
    rec(L, 'Y4', '打字後：統計全書增加同樣字數', stats2 === stats1 + add, `全書 ${stats1 + add}`, `統計 ${stats2}`);

    // 立刻暫存稿子
    if (!(await gotoTab(page, L, 'files'))) throw new Error('走不到檔案頁');
    await act(L, page.locator('[data-testid="stash-draft"]').first());
    await page.waitForTimeout(2000);
    const stats3 = await statsBook(page, L);
    const ch3 = await openChapter(page, L);
    rec(L, 'Y5', '暫存後：統計全書與本章字數不變', stats3 === stats2 && ch3?.shown === shown2, `全書 ${stats2}、本章 ${shown2}`, `全書 ${stats3}、本章 ${ch3?.shown}`);

    // 重新整理（重開 App）後從首頁再進來
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="home-screen"]', { timeout: 20000 });
    await page.waitForTimeout(1500);
    const home4 = await homeWords(page);
    await act(L, page.locator('[data-testid="project-card"] a', { hasText: SAMPLE }).first());
    await page.waitForURL(/\/p\/[^/]+\//, { timeout: 15000 });
    const stats4 = await statsBook(page, L);
    const ch4 = await openChapter(page, L);
    rec(L, 'Y6', '重開後：首頁、統計全書、本章字數與暫存前相同，正文逐字相同',
      home4 === stats2 && stats4 === stats2 && ch4?.shown === shown2 && ch4?.body === after,
      `首頁＝統計＝${stats2}、本章 ${shown2}、正文相同`,
      `首頁 ${home4}、統計 ${stats4}、本章 ${ch4?.shown}、正文${ch4?.body === after ? '相同' : '不同'}`);
    await page.screenshot({ path: path.join(RUN_DIR, `${L.id}-重開後.png`) });
  } catch (e) {
    rec(L, 'Y!', '流程中斷', false, '完成流程', String(e.message).slice(0, 200));
    await page.screenshot({ path: path.join(RUN_DIR, `${L.id}-中斷.png`) }).catch(() => {});
  } finally {
    await browser.close();
  }
}

const started = new Date();
for (const L of LAYOUTS) await runLayout(L);
const pass = results.filter((r) => r.status === 'passed').length;
let md = `# WO-76 範例書字數（${RUN_LABEL}）\n\n- 執行：${started.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}\n- BASE：${BASE}\n- ENGINE：Chromium（觸控版面以 Chromium 模擬，非 Safari／實機）\n\n`;
md += '| 版面 | 步驟 | 項目 | 結果 | 預期 | 實際 |\n|---|---|---|---|---|---|\n';
for (const r of results) md += `| ${r.layout} | ${r.step} | ${r.item} | ${r.status === 'passed' ? '通過' : '失敗'} | ${r.expected} | ${r.actual} |\n`;
md += `\n總計 ${results.length}｜通過 ${pass}｜失敗 ${results.length - pass}\n`;
fs.writeFileSync(path.join(RUN_DIR, '結果.md'), md);
fs.writeFileSync(path.join(RUN_DIR, '結果.json'), JSON.stringify(results, null, 2));
console.log(`\n總計 ${results.length}｜通過 ${pass}｜失敗 ${results.length - pass}`);
