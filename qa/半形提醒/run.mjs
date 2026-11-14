/**
 * WO-76 乙段：正文半形標點提醒，四種版面從畫面正常操作驗證。
 *
 * 只從畫面操作（點、打字、讀可見文字與元素位置），不 force 點擊、不用 evaluate 改狀態或呼叫 App 內部函式、
 * 不跳內部網址。只用內建【範例】霧港紀事。讀取 selectionStart、元素位置屬唯讀。
 * 組字事件以 Chromium CDP Input.imeSetComposition／Input.insertText 送出（瀏覽器層級的組字事件，非實機注音）。
 *
 * 底線對齊量測：點每條底線的正中央（底線疊層不擋點擊，點到的是正文），
 * 游標必須落在半形標點旁邊；若疊層和正文錯位，游標會落到別的字旁。
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
const QA_DIR = process.env.QA_DIR || path.join(REPO_ROOT, 'test-results', 'qa', '半形提醒');
const RUN_LABEL = process.env.RUN_LABEL || 'WO-76-乙段';
const RUN_DIR = path.join(QA_DIR, RUN_LABEL);
const SHOT_DIR = process.env.SHOT_DIR || RUN_DIR;
fs.mkdirSync(RUN_DIR, { recursive: true });
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ALL = [
  { id: 'phone-portrait', name: '手機直拿', short: '直拿', viewport: { width: 390, height: 844 }, touch: true },
  { id: 'phone-landscape', name: '手機橫拿', short: '橫拿', viewport: { width: 844, height: 390 }, touch: true },
  { id: 'tablet-portrait', name: '中等', short: '中等', viewport: { width: 768, height: 1024 }, touch: true },
  { id: 'desktop-wide', name: '寬版', short: '寬版', viewport: { width: 1280, height: 800 }, touch: false },
];
const only = (process.env.LAYOUTS || '').split(',').filter(Boolean);
const LAYOUTS = only.length ? ALL.filter((l) => only.includes(l.id)) : ALL;
const SAMPLE = '【範例】霧港紀事';
const SCALES = [90, 100, 110, 120, 130, 140, 150, 175, 200];
/** 打進第一章章首的【範例】測試文字：要提醒 6 處，數字、英文、網址、時間不提醒。 */
const TYPED =
  '【範例】他說,走吧.真的要去嗎?燈塔的光...一閃一閃。潮位3.5米,約1,000人在12:30看見OK, let\'s go.網址https://example.com/a.b沒有變!\n';
const EXPECT_MARKS = [',', '.', '?', '...', ',', '!'];
const HALF = /[,.?!:;]/;

const vis = (loc) => loc.first().isVisible().catch(() => false);
const act = (L, loc) => (L.touch ? loc.first().tap({ timeout: 8000 }) : loc.first().click({ timeout: 8000 }));
const num = (s) => {
  const m = String(s || '').match(/([\d,]+)/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
};

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
  const input = page.locator('[data-testid="writing-input"]').first();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(500);
  // 橫拿與中等：目錄還開著就收起，正文回到原寬度
  for (const s of ['[data-testid="tree-close-button"]']) {
    const b = page.locator(s).first();
    if (L.id !== 'desktop-wide' && (await vis(b))) {
      await act(L, b);
      await page.waitForTimeout(500);
    }
  }
  return input;
}

async function setScale(page, L, target) {
  if (!(await gotoTab(page, L, 'settings'))) return false;
  const value = page.locator('[data-testid="body-font-value"]').first();
  await value.waitFor({ state: 'visible', timeout: 5000 });
  for (let i = 0; i < 12; i += 1) {
    const now = num(await value.textContent());
    if (now === target) return true;
    const btn = page.locator(`[data-testid="body-font-${now < target ? 'increase' : 'decrease'}"]`).first();
    await btn.scrollIntoViewIfNeeded();
    await act(L, btn);
    await page.waitForTimeout(150);
  }
  return num(await value.textContent()) === target;
}

async function caretInfo(input) {
  return input.evaluate((el) => ({ start: el.selectionStart, end: el.selectionEnd, value: el.value, active: document.activeElement === el }));
}

const markLoc = (page) => page.locator('[data-testid="half-width-overlay"] .half-width-mark');

/** 唯讀：每條底線的位置，以及是否落在正文可見範圍。 */
async function markBoxes(page, input) {
  const box = await input.boundingBox();
  const marks = markLoc(page);
  const n = await marks.count();
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const b = await marks.nth(i).boundingBox();
    if (!b || !box) continue;
    const inView = b.y >= box.y + 4 && b.y + b.height <= box.y + box.height - 4 && b.width > 0;
    out.push({ i, ...b, inView, text: await marks.nth(i).textContent() });
  }
  return out;
}

/** 點底線正中央，游標要落在半形標點旁邊。回傳 [對齊數, 量測數, 說明]。 */
async function alignCheck(page, L, input, limit = 4, fromEnd = false) {
  const done = new Set();
  let ok = 0;
  let measured = 0;
  const notes = [];
  for (let round = 0; round < limit; round += 1) {
    // 每次點前重新量：上一次點擊可能讓正文捲動；捲出畫面的就改量下一條看得到的
    const shown = (await markBoxes(page, input)).filter((item) => item.inView && !done.has(item.i));
    const b = fromEnd ? shown.at(-1) : shown[0];
    if (!b) break;
    done.add(b.i);
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    if (L.touch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    await page.waitForTimeout(120);
    const c = await caretInfo(input);
    const around = c.value.slice(Math.max(0, c.start - 1), c.start + 1);
    const hit = HALF.test(around);
    measured += 1;
    if (hit) ok += 1;
    notes.push(`${b.text}@${c.start}${hit ? '' : `✗「${around}」`}`);
  }
  return [ok, measured, notes.join(' ')];
}

async function blurBody(page, L) {
  // 點頁首章名：正文失焦（手機上等於收起鍵盤）
  const h1 = page.locator('.editor .topbar h1').first();
  if (await vis(h1)) await act(L, h1);
  await page.waitForTimeout(700);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, name) });
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
  const notice = () => page.locator(L.id === 'phone-portrait' ? '[data-testid="half-width-strip"]' : '[data-testid="half-width-badge"]').first();
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="home-screen"]', { timeout: 20000 });
    await act(L, page.locator('[data-testid="project-card"] a', { hasText: SAMPLE }).first());
    await page.waitForURL(/\/p\/[^/]+\//, { timeout: 15000 });
    let input = await openChapter(page, L, '第一章');
    if (!input) throw new Error('走不到第一章');
    rec(L, 'B0', '範例書第一章原文沒有半形標點：沒有底線、沒有提示', (await markLoc(page).count()) === 0 && !(await vis(notice())), '0 條、無提示', `${await markLoc(page).count()} 條`);

    // 1. 打字中只留底線，停筆 3 秒才檢查
    await act(L, input);
    await page.keyboard.press('Control+Home');
    await page.keyboard.type(TYPED, { delay: 5 });
    const typedCaret = (await caretInfo(input)).start;
    await page.waitForTimeout(800);
    rec(L, 'B1', '打字後不到 3 秒：還沒檢查（沒有底線）', (await markLoc(page).count()) === 0, '0 條', `${await markLoc(page).count()} 條`);
    await page.waitForTimeout(2800);
    const marks1 = await markLoc(page).allTextContents();
    rec(L, 'B2', '停筆約 3 秒後：只在中文字旁的半形標點加底線（數字、英文、網址、時間不加）', JSON.stringify(marks1) === JSON.stringify(EXPECT_MARKS), EXPECT_MARKS.join(' '), marks1.join(' '));
    const c2 = await caretInfo(input);
    rec(L, 'B3', '檢查不動游標、不改正文、不搶焦點', c2.start === typedCaret && c2.value.startsWith(TYPED) && c2.active, `游標 ${typedCaret}、焦點在正文`, `游標 ${c2.start}、焦點${c2.active ? '在' : '不在'}正文`);
    const showWhileTyping = await vis(notice());
    if (L.id === 'desktop-wide') rec(L, 'B4', '寬版：打字時可同時有底線與頁首乙案', showWhileTyping, '頁首有提示', showWhileTyping ? '有' : '無');
    else rec(L, 'B4', '打字中／鍵盤開著：只留底線，不出提示條或頁首提示', !showWhileTyping, '沒有提示', showWhileTyping ? '有提示' : '沒有提示');
    await shot(page, `${L.short}-100-打字中只留底線.png`);

    // 2. 組字保護（Chromium CDP 組字事件）
    await page.keyboard.type('好,', { delay: 5 });
    await cdp.send('Input.imeSetComposition', { text: 'ㄗㄡˇ', selectionStart: 3, selectionEnd: 3 });
    await page.waitForTimeout(3600);
    const during = await markLoc(page).count();
    const bubbleDuring = await vis(page.locator('[data-testid="half-width-bubble"]'));
    rec(L, 'B5', '組字中停了 3 秒以上：不重新檢查（新打的半形逗號還沒底線）', during === EXPECT_MARKS.length && !bubbleDuring, `${EXPECT_MARKS.length} 條`, `${during} 條`);
    await cdp.send('Input.insertText', { text: '走' });
    await page.waitForTimeout(2000);
    const after2s = await markLoc(page).count();
    await page.waitForTimeout(1500);
    const after35 = await markLoc(page).count();
    rec(L, 'B6', '選完字（compositionend）後重新計時：2 秒時還沒檢查，3 秒後才加上新底線', after2s === EXPECT_MARKS.length && after35 === EXPECT_MARKS.length + 1, `2 秒 ${EXPECT_MARKS.length}、3.5 秒 ${EXPECT_MARKS.length + 1}`, `2 秒 ${after2s}、3.5 秒 ${after35}`);
    // 把這次組字打的字刪掉，回到測試文字
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('Backspace');
    await page.waitForTimeout(3400);

    // 3. 底線對齊（100%）與游標旁小泡泡
    const [ok1, n1, note1] = await alignCheck(page, L, input);
    rec(L, 'B7', '100%：點底線正中央，游標落在半形標點旁（底線對齊正文）', n1 >= 3 && ok1 === n1, `${n1}/${n1}`, `${ok1}/${n1} ${note1}`);
    const bubble = page.locator('[data-testid="half-width-bubble"]').first();
    const firstMark = (await markBoxes(page, input)).find((b) => b.inView);
    if (firstMark) {
      const bx = firstMark.x + firstMark.width / 2;
      const by = firstMark.y + firstMark.height / 2;
      if (L.touch) await page.touchscreen.tap(bx, by);
      else await page.mouse.click(bx, by);
      await page.waitForTimeout(200);
    }
    const bb = await bubble.boundingBox().catch(() => null);
    const covers = bb && firstMark ? !(bb.y + bb.height <= firstMark.y - 2 || bb.y >= firstMark.y + firstMark.height + 2) : true;
    rec(L, 'B8', '游標在底線標點旁：出「改成全形」小泡泡，不蓋住游標那一行，至少 44×44', Boolean(bb) && !covers && bb.width >= 44 && bb.height >= 44, '有泡泡、不重疊、≥44', bb ? `${Math.round(bb.width)}×${Math.round(bb.height)}${covers ? '、蓋到那一行' : ''}` : '沒有泡泡');
    if (L.id === 'phone-portrait') await shot(page, `${L.short}-100-游標旁小泡泡.png`);
    if (!L.touch && firstMark) {
      // 電腦：滑鼠移過底線不出泡泡（先把游標移到章尾再移過去）
      // 電腦：游標先移到別行（不在標點旁），滑鼠只移過底線不出泡泡
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(150);
      const again = (await markBoxes(page, input)).find((item) => item.i === firstMark.i);
      await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
      await page.waitForTimeout(300);
      rec(L, 'B8b', '電腦：滑鼠只移過底線不出泡泡', !(await vis(bubble)), '沒有泡泡', (await vis(bubble)) ? '出現' : '沒有');
      await page.mouse.click(again.x + again.width / 2, again.y + again.height / 2);
      await page.waitForTimeout(200);
    }
    if (await vis(bubble)) {
      const before = await caretInfo(input);
      const label = await bubble.getAttribute('aria-label');
      await act(L, bubble);
      await page.waitForTimeout(300);
      const after = await caretInfo(input);
      const removed = (before.value.match(/[,.?!]/g) || []).length - (after.value.match(/[,.?!]/g) || []).length;
      rec(L, 'B9', '按小泡泡只改那一個，游標留在原處、焦點不離開正文（鍵盤不收）', removed === 1 && after.start === before.start && after.active && (await markLoc(page).count()) === EXPECT_MARKS.length - 1, `少 1 個半形、游標 ${before.start}、焦點在正文`, `少 ${removed} 個、游標 ${after.start}、焦點${after.active ? '在' : '不在'}；朗讀「${label}」`);
    } else {
      rec(L, 'B9', '按小泡泡只改那一個', false, '有泡泡可按', '沒有泡泡');
    }
    await page.keyboard.type('x');
    await page.waitForTimeout(150);
    rec(L, 'B10', '繼續打字：小泡泡消失', !(await vis(bubble)), '沒有泡泡', (await vis(bubble)) ? '還在' : '消失');
    await page.keyboard.press('Backspace');

    // 3b. 捲到章尾：正文捲動後，章尾新打的底線仍對齊
    const TAIL = '\n【範例】尾段,收筆.';
    await page.keyboard.press('Control+End');
    await page.keyboard.type(TAIL, { delay: 5 });
    await page.waitForTimeout(3400);
    const sc = await input.evaluate((el) => ({ top: el.scrollTop, fits: el.scrollHeight <= el.clientHeight + 1 }));
    const [okS, nS, noteS] = await alignCheck(page, L, input, 2, true);
    rec(L, 'B10b', '捲到章尾（正文需要捲動時已捲動）：章尾新底線仍對齊', (sc.top > 0 || sc.fits) && nS >= 2 && okS === nS, `已捲動或一頁放得下、${nS}/${nS}`, `scrollTop ${Math.round(sc.top)}${sc.fits ? '（一頁放得下）' : ''}、${okS}/${nS} ${noteS}`);
    await page.keyboard.press('Control+End');
    for (let i = 0; i < TAIL.length; i += 1) await page.keyboard.press('Backspace');
    await page.keyboard.press('Control+Home');
    await page.waitForTimeout(3400);

    // 4. 收起鍵盤（失焦）後的提示位置
    await blurBody(page, L);
    await page.waitForTimeout(3200);
    const count4 = await markLoc(page).count();
    const n4 = notice();
    const nb = await n4.boundingBox().catch(() => null);
    const text4 = (await (L.id === 'phone-portrait' ? n4.locator('.half-width-text') : n4).textContent().catch(() => '')) || '';
    if (L.id === 'phone-portrait') {
      const thumb = await page.locator('[data-testid="thumb-bar"]').first().boundingBox();
      const above = nb && thumb ? nb.y + nb.height <= thumb.y + 1 && thumb.y - (nb.y + nb.height) < 24 : false;
      rec(L, 'B11', '直拿收起鍵盤：拇指區正上方出甲案細條「這一章有 N 個半形標點」，不蓋住三顆鈕', text4 === `這一章有 ${count4} 個半形標點` && above, `這一章有 ${count4} 個半形標點、在拇指區正上方`, `「${text4}」${above ? '、在正上方' : '、位置不對'}`);
      const btns = page.locator('[data-testid="half-width-strip"] button');
      let small = 0;
      for (let i = 0; i < (await btns.count()); i += 1) {
        const b = await btns.nth(i).boundingBox();
        if (!b || b.width < 44 || b.height < 44) small += 1;
      }
      rec(L, 'B12', '細條按鈕觸控區至少 44×44、一行不換兩行', small === 0 && nb && nb.height <= 50, '0 個太小、高度 ≤50', `${small} 個太小、高 ${nb ? Math.round(nb.height) : '-'}`);
      await shot(page, `${L.short}-100-收起鍵盤後拇指區上方甲案細條.png`);
    } else {
      const topbar = await page.locator('.editor .topbar').first().boundingBox();
      const inHeader = nb && topbar ? nb.y >= topbar.y && nb.y + nb.height <= topbar.y + topbar.height + 1 : false;
      rec(L, 'B11', '頁首（標題列）右側出乙案「半形標點　N 處」', text4 === `半形標點　${count4} 處` && inHeader && nb.x > L.viewport.width / 2, `半形標點　${count4} 處、在頁首右側`, `「${text4}」${inHeader ? '、在頁首' : '、不在頁首'}`);
      rec(L, 'B12', '乙案可點區至少 44×44', nb && nb.width >= 44 && nb.height >= 44, '≥44×44', nb ? `${Math.round(nb.width)}×${Math.round(nb.height)}` : '-');
      await shot(page, `${L.short}-100-頁首乙案.png`);
    }

    // 5. 改成全形 → 復原（一次整批）
    const wc = page.locator('[data-testid="chapter-word-count"]').first();
    const words0 = num(await wc.textContent());
    const value0 = (await caretInfo(input)).value;
    if (L.id === 'tablet-portrait' || L.id === 'desktop-wide') {
      await act(L, notice());
      await page.waitForTimeout(300);
      const card = page.locator('[data-testid="half-width-card"]').first();
      const cardText = (await card.locator('.half-width-text').textContent().catch(() => '')) || '';
      rec(L, 'B13', '點一下乙案：展開甲案小卡，有「改成全形」「先不用」', cardText === `這一章有 ${count4} 個半形標點` && (await vis(card.locator('[data-testid="half-width-skip"]'))), `這一章有 ${count4} 個半形標點`, `「${cardText}」`);
      await shot(page, `${L.short}-100-點開甲案小卡.png`);
      await act(L, card.locator('[data-testid="half-width-convert"]'));
    } else if (L.id === 'phone-portrait') {
      await act(L, page.locator('[data-testid="half-width-convert"]'));
    } else {
      await act(L, notice());
    }
    await page.waitForTimeout(500);
    const value1 = (await caretInfo(input)).value;
    const words1 = num(await wc.textContent());
    const resultText = (await page.locator('[data-testid="half-width-result"] .half-width-text').first().textContent().catch(() => '')) || '';
    // 前面小泡泡已改掉一個；其餘照規則換，數字、英文、網址、時間不動
    const expectConverted = [
      ['說,走', '說，走'],
      ['吧.真', '吧。真'],
      ['嗎?燈', '嗎？燈'],
      ['光...一', '光……一'],
      ['米,約', '米，約'],
      ['變!', '變！'],
    ].reduce((text, [from, to]) => text.replace(from, to), value0);
    rec(L, 'B14', `按「改成全形」：只改這一章符合規則的 ${count4} 個，顯示「已改成全形，共 ${count4} 個」`, value1 === expectConverted && resultText === `已改成全形，共 ${count4} 個` && (await markLoc(page).count()) === 0, `正文照規則換、共 ${count4} 個`, `正文${value1 === expectConverted ? '相同' : '不同'}、「${resultText}」`);
    rec(L, 'B15', '本章字數走既有 commit-text 更新（「...」換成「……」少 1）', words1 === words0 - 1, `${words0 - 1}`, `${words1}`);
    await shot(page, `${L.short}-100-改成全形結果.png`);
    await act(L, page.locator('[data-testid="half-width-undo"]'));
    await page.waitForTimeout(500);
    const value2 = (await caretInfo(input)).value;
    const words2 = num(await wc.textContent());
    rec(L, 'B16', '按一次「復原」整批還原，字數回到原值', value2 === value0 && words2 === words0 && (await markLoc(page).count()) === count4, `正文還原、${words0}`, `正文${value2 === value0 ? '還原' : '不同'}、${words2}`);

    // 6. 先不用（橫拿頁首只有乙案，沒有「先不用」）
    if (L.id !== 'phone-landscape') {
      if (L.id !== 'phone-portrait') {
        await act(L, notice());
        await page.waitForTimeout(300);
      }
      await act(L, page.locator('[data-testid="half-width-skip"]'));
      await page.waitForTimeout(400);
      const gone = !(await vis(notice())) && !(await vis(page.locator('[data-testid="half-width-card"]')));
      rec(L, 'B17', '按「先不用」：細條或小卡立刻收起，底線保留', gone && (await markLoc(page).count()) === count4, `收起、底線 ${count4}`, `${gone ? '收起' : '還在'}、底線 ${await markLoc(page).count()}`);

      const probeBubble = async (label) => {
        const first = (await markBoxes(page, input)).find((b) => b.inView);
        if (!first) return { ok: false, note: '找不到底線' };
        const bx = first.x + first.width / 2;
        const by = first.y + first.height / 2;
        if (L.touch) await page.touchscreen.tap(bx, by);
        else await page.mouse.click(bx, by);
        await page.waitForTimeout(300);
        const byClick = await vis(page.locator('[data-testid="half-width-bubble"]'));
        // 方向鍵：先移開再用方向鍵移回標點旁
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(300);
        const byKey = await vis(page.locator('[data-testid="half-width-bubble"]'));
        // 收起鍵盤，回到探測前的狀態，後面步驟照原樣走
        await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
        await page.waitForTimeout(300);
        return { ok: !byClick && !byKey && (await markLoc(page).count()) === count4, note: `${label}：點${byClick ? '有' : '無'}泡泡、方向鍵${byKey ? '有' : '無'}泡泡、底線 ${await markLoc(page).count()}` };
      };
      const p1 = await probeBubble('按「先不用」後');
      rec(L, 'B17b', '按「先不用」後：點底線旁或用方向鍵移到標點旁，都不出小泡泡，底線仍在', p1.ok, '無泡泡、底線 ' + count4, p1.note);
      if (L.id === 'phone-portrait') await shot(page, `${L.short}-100-先不用後不再出小泡泡.png`);
      input = await openChapter(page, L, '第三章');
      input = await openChapter(page, L, '第一章');
      if (input) {
        await page.waitForTimeout(800);
        const back = await vis(notice());
        rec(L, 'B18', '切到別章再回來：同一章仍不出提示，底線還在', !back && (await markLoc(page).count()) === count4, `無提示、底線 ${count4}`, `${back ? '有提示' : '無提示'}、底線 ${await markLoc(page).count()}`);
        const p2 = await probeBubble('切章回來後');
        rec(L, 'B18b', '切到別章再回來：點底線旁或用方向鍵移動游標，仍不出小泡泡，底線仍在', p2.ok, '無泡泡、底線 ' + count4, p2.note);
      }
    }

    // 7. 專注模式：只留底線
    const enterSel = { 'phone-portrait': 'thumb-focus-button', 'phone-landscape': 'toggle-focus-landscape', 'tablet-portrait': 'enter-focus-mode', 'desktop-wide': 'enter-focus-mode' }[L.id];
    await act(L, page.locator(`[data-testid="${enterSel}"]`));
    await page.waitForTimeout(800);
    const inFocus = await page.locator('html[data-focus-mode="true"]').count();
    const focusMarks = (await markBoxes(page, input)).filter((b) => b.inView).length;
    const anyNotice = (await vis(page.locator('[data-testid="half-width-strip"]'))) || (await vis(page.locator('[data-testid="half-width-badge"]'))) || (await vis(page.locator('[data-testid="half-width-card"]')));
    const bottom = (await page.locator('[data-testid="focus-bottom-status"]').first().textContent().catch(() => '')) || '';
    rec(L, 'B19', '專注模式：看得到底線，沒有細條、小卡、頁首提示，底部字數不加半形數量', inFocus === 1 && focusMarks > 0 && !anyNotice && !bottom.includes('半形'), '有底線、無提示', `底線 ${focusMarks}、${anyNotice ? '有提示' : '無提示'}`);
    const [okF, nF, noteF] = await alignCheck(page, L, input, 3);
    rec(L, 'B20', '專注模式：底線仍對齊；游標在標點旁也不出小泡泡', nF > 0 && okF === nF && !(await vis(page.locator('[data-testid="half-width-bubble"]'))), `${nF}/${nF}、無泡泡`, `${okF}/${nF} ${noteF}`);
    await blurBody(page, L);
    await shot(page, `${L.short}-100-專注模式只留底線.png`);
    const exit = page.locator('[data-testid="exit-focus-mode"]').first();
    await act(L, exit);
    await page.waitForTimeout(300);
    if (await page.locator('html[data-focus-mode="true"]').count()) {
      await act(L, exit);
      await page.waitForTimeout(500);
    }

    // 8. 正文字級 90%～200% 各檔位：底線對齊
    const scaleNotes = [];
    let scaleOk = 0;
    for (const scale of SCALES) {
      if (!(await setScale(page, L, scale))) {
        scaleNotes.push(`${scale}% 調不到`);
        continue;
      }
      input = await openChapter(page, L, '第一章');
      if (!input) {
        scaleNotes.push(`${scale}% 回不到第一章`);
        continue;
      }
      await page.waitForTimeout(600);
      await page.keyboard.press('Control+Home').catch(() => {});
      const [ok, n, note] = await alignCheck(page, L, input, 3);
      if (n > 0 && ok === n) scaleOk += 1;
      scaleNotes.push(`${scale}%:${ok}/${n}${ok === n ? '' : `(${note})`}`);
      if (scale === 100 || scale === 200) {
        await blurBody(page, L);
        await shot(page, `${L.short}-${scale}-淡灰虛線底線對齊.png`);
      }
    }
    rec(L, 'B21', '正文字級 90、100、110、120、130、140、150、175、200% 各檔位：點底線游標都落在標點旁', scaleOk === SCALES.length, `${SCALES.length}/${SCALES.length}`, `${scaleOk}/${SCALES.length} ${scaleNotes.join(' ')}`);

    // 9. 200% 時直拿細條改乙案、一行（到第三章另打一段【範例】文字）
    if (L.id === 'phone-portrait') {
      input = await openChapter(page, L, '第三章');
      if (input) {
        await act(L, input);
        await page.keyboard.press('Control+Home');
        await page.keyboard.type('【範例】好,走吧.\n', { delay: 5 });
        await blurBody(page, L);
        await page.waitForTimeout(800);
        const strip = page.locator('[data-testid="half-width-strip"]').first();
        const sb = await strip.boundingBox().catch(() => null);
        const st = (await strip.locator('.half-width-text').textContent().catch(() => '')) || '';
        rec(L, 'B22', '字級 200%：直拿細條改用乙案，一行不換兩行', st === '半形標點　2 處' && sb && sb.height <= 50, '半形標點　2 處、一行', `「${st}」高 ${sb ? Math.round(sb.height) : '-'}`);
        await shot(page, `${L.short}-200-細條改乙案.png`);
      }
    }
    await setScale(page, L, 100);

    // 10. 設定開關：關閉後不提醒、沒有底線；打開後恢復
    if (await gotoTab(page, L, 'settings')) {
      const sw = page.locator('[data-testid="half-width-setting"]').first();
      await sw.scrollIntoViewIfNeeded();
      const label1 = await sw.getAttribute('aria-label');
      const sb = await sw.boundingBox();
      if (L.id === 'phone-portrait') await shot(page, `${L.short}-設定頁提醒半形標點開關-預設開啟.png`);
      await act(L, sw);
      await page.waitForTimeout(200);
      const label2 = await sw.getAttribute('aria-label');
      rec(L, 'B23', '設定頁「提醒半形標點」預設開啟，點一下關閉；朗讀文字照工單；觸控區 ≥44', label1 === '提醒半形標點，已開啟，點兩下關閉' && label2 === '提醒半形標點，已關閉，點兩下開啟' && sb && sb.height >= 44, '已開啟 → 已關閉', `「${label1}」→「${label2}」`);
      input = await openChapter(page, L, '第一章');
      await page.waitForTimeout(800);
      const off = (await markLoc(page).count()) === 0 && !(await vis(page.locator('[data-testid="half-width-badge"]'))) && !(await vis(page.locator('[data-testid="half-width-strip"]')));
      rec(L, 'B24', '關閉後：沒有底線、沒有提示', off, '都沒有', off ? '都沒有' : '還有');
      await gotoTab(page, L, 'settings');
      await act(L, page.locator('[data-testid="half-width-setting"]').first());
      input = await openChapter(page, L, '第一章');
      await page.waitForTimeout(800);
      rec(L, 'B25', '重新開啟：底線恢復', (await markLoc(page).count()) === count4, `${count4} 條`, `${await markLoc(page).count()} 條`);
    }

    // 11. 重新開 App：先不用失效，會再提醒
    if (L.id !== 'phone-landscape') {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-testid="home-screen"]', { timeout: 20000 });
      await act(L, page.locator('[data-testid="project-card"] a', { hasText: SAMPLE }).first());
      await page.waitForURL(/\/p\/[^/]+\//, { timeout: 15000 });
      input = await openChapter(page, L, '第一章');
      await page.waitForTimeout(800);
      rec(L, 'B26', '重新開 App 後：同一章會再提醒', await vis(notice()), '有提示', (await vis(notice())) ? '有提示' : '沒有');
    }
  } catch (e) {
    rec(L, 'B!', '流程中斷', false, '完成流程', String(e.message).slice(0, 200));
    await page.screenshot({ path: path.join(RUN_DIR, `${L.id}-中斷.png`) }).catch(() => {});
  } finally {
    await browser.close();
  }
}

const started = new Date();
for (const L of LAYOUTS) await runLayout(L);
const pass = results.filter((r) => r.status === 'passed').length;
let md = `# WO-76 乙段 半形標點提醒（${RUN_LABEL}）\n\n- 執行：${started.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}\n- BASE：${BASE}\n- ENGINE：Chromium（觸控版面以 Chromium 模擬，非 Safari／實機；組字以 CDP 組字事件模擬，非實機注音）\n\n`;
md += '| 版面 | 步驟 | 項目 | 結果 | 預期 | 實際 |\n|---|---|---|---|---|---|\n';
for (const r of results) md += `| ${r.layout} | ${r.step} | ${r.item} | ${r.status === 'passed' ? '通過' : '失敗'} | ${r.expected} | ${String(r.actual).replace(/\|/g, '｜').replace(/\n/g, ' ')} |\n`;
md += `\n總計 ${results.length}｜通過 ${pass}｜失敗 ${results.length - pass}\n`;
fs.writeFileSync(path.join(RUN_DIR, '結果.md'), md);
fs.writeFileSync(path.join(RUN_DIR, '結果.json'), JSON.stringify(results, null, 2));
console.log(`\n總計 ${results.length}｜通過 ${pass}｜失敗 ${results.length - pass}`);
