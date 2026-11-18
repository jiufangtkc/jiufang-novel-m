/**
 * WO-119：電腦專注模式按 Esc 離開（獨立 QA，不屬於 npm test）。
 *
 * 只由介面操作：先略過歡迎導覽、新開書名含【範例】的假稿、按鈕進入專注、真實鍵盤按 Esc。
 * 不直接改 class／屬性假造離開；不呼叫內部 exit；不碰真書稿或 .db。
 * evaluate 只「讀」狀態（data-focus-mode、data-side-panel-*、textarea 內容與選取、matchMedia），
 * 唯一的寫入是組字模擬：對正文框送 composition 事件與 isComposing／229 的 keydown 替身
 *（事件替身／composition 模擬，非真機中文輸入法驗證）。
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
const QA_DIR = process.env.QA_DIR || path.join(REPO_ROOT, 'test-results', 'qa', 'wo119-focus-escape');
const RUN_LABEL = process.env.RUN_LABEL || 'WO-119';
const SHOT_DIR = process.env.SHOT_DIR || path.join(QA_DIR, '截圖');
fs.mkdirSync(QA_DIR, { recursive: true });
fs.mkdirSync(SHOT_DIR, { recursive: true });

const TEXT = '【範例】山川日月星辰風雨雷電春夏秋冬東南西北天地玄黃宇宙洪荒';
const results = [];
function rec(scene, item, ok, expected, actual, extra = {}) {
  results.push({ scene, item, status: ok ? 'passed' : 'failed', expected: String(expected), actual: String(actual), ...extra });
  console.log(`${ok ? '通過' : '失敗'} [${scene}] ${item} :: 預期 ${expected} / 實際 ${actual}`);
}
function note(scene, item, text) {
  results.push({ scene, item, status: 'note', actual: text });
  console.log(`備註 [${scene}] ${item} :: ${text}`);
}

const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const vis = (loc) => loc.first().isVisible().catch(() => false);

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

async function createDraft(page, title) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await skipTourIfAny(page);
  await page.waitForSelector('[data-testid="home-screen"]', { timeout: 20000 });
  await page.getByRole('button', { name: '開新稿子' }).first().click({ timeout: 8000 });
  await page.locator('form.dialog input').first().fill(title);
  await page.locator('form.dialog button[type="submit"]').first().click({ timeout: 8000 });
  await page.waitForURL(/\/p\/[^/]+\/write/, { timeout: 15000 });
  await page.waitForTimeout(700);
}

async function openChapter(page) {
  const input = tid(page, 'writing-input').first();
  if (!(await vis(input))) {
    const row = page.locator('.tree-row[data-node-id] .tree-main').first();
    await row.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    if (await vis(row)) await row.click({ timeout: 8000 });
  }
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(400);
}

/** 唯讀快照：專注、側欄、正文與選取、媒體值。 */
async function snap(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="writing-input"]');
    const d = document.documentElement.dataset;
    return {
      focus: d.focusMode === 'true',
      left: d.sidePanelLeft,
      right: d.sidePanelRight,
      layout: d.layout,
      pointerPref: d.pointer,
      fine: matchMedia('(pointer: fine)').matches,
      coarse: matchMedia('(pointer: coarse)').matches,
      value: el ? el.value : null,
      start: el ? el.selectionStart : null,
      end: el ? el.selectionEnd : null,
      dir: el ? el.selectionDirection : null,
      active: document.activeElement === el,
    };
  });
}
const sameText = (a, b) => a.value === b.value && a.start === b.start && a.end === b.end && a.dir === b.dir;

/** 在正文建立游標與一段選取（由介面：點擊、輸入、鍵盤選取）。 */
async function prepareBody(page) {
  const input = tid(page, 'writing-input').first();
  await input.click({ timeout: 8000 });
  await input.fill(TEXT);
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await page.waitForTimeout(300);
}

async function enterFocus(page) {
  await tid(page, 'enter-focus-mode').first().click({ timeout: 8000 });
  await page.waitForTimeout(500);
  const s = await snap(page);
  return s.focus;
}

async function shot(page, name) {
  const file = path.join(SHOT_DIR, `${RUN_LABEL}-${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

async function freshBook(browser, ctxOpts, label, { openAndPrepare = true } = {}) {
  const context = await browser.newContext({ locale: 'zh-TW', timezoneId: 'Asia/Taipei', ...ctxOpts });
  // 無頭 Chromium 常把 (pointer: fine) 報成 false，並把操作方式猜成觸控，Esc 就不會離開。
  // 非 isMobile 的電腦情境：預先寫入「用滑鼠／電腦」，並讓 fine 媒體查詢為 true。這是模擬有實體鍵盤的電腦，不是改產品判斷。
  const desktopLike = !ctxOpts?.isMobile;
  await context.addInitScript((desktopLike) => {
    try {
      localStorage.setItem(
        'jiufang-novel-m.onboarding.v1',
        JSON.stringify({ status: 'skipped', at: '2026-11-18T05:00:00.000Z', appVersion: '0.1.0' }),
      );
      localStorage.setItem('jiufang-novel-m.theme.v1', 'forest');
      if (desktopLike) {
        localStorage.setItem('jiufang-novel-m.input-mode.v1', 'mouse');
        localStorage.setItem('jiufang-novel-m.device-kind.v1', 'computer');
      }
    } catch {}
  }, desktopLike);
  if (desktopLike) {
    await context.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q) => {
        const s = String(q).replace(/\s/g, '');
        const stub = (matches) => ({
          matches,
          media: q,
          onchange: null,
          addEventListener() {},
          removeEventListener() {},
          addListener() {},
          removeListener() {},
          dispatchEvent: () => true,
        });
        if (s === '(pointer:fine)' || s === '(any-pointer:fine)' || s === '(hover:hover)') return stub(true);
        if (s === '(pointer:coarse)') return stub(false);
        return real(q);
      };
    });
  }
  const page = await context.newPage();
  await createDraft(page, `【範例】專注Esc-${label}-${RUN_LABEL}`);
  if (openAndPrepare) {
    await openChapter(page);
    await prepareBody(page);
  }
  return { context, page };
}

async function focusEscapeBasics(browser, width, height) {
  const scene = `${width}x${height}`;
  // A：按 Esc 離開
  const A = await freshBook(browser, { viewport: { width, height } }, `${width}-A`);
  const before = await snap(A.page);
  const entered = await enterFocus(A.page);
  rec(scene, '由按鈕進入專注', entered, 'focus=true', entered, { viewport: `${width}x${height}`, fine: before.fine, pointerPref: before.pointerPref });
  const inFocus = await snap(A.page);
  await shot(A.page, `${scene}-專注中`);
  await A.page.keyboard.press('Escape');
  await A.page.waitForTimeout(500);
  const afterEsc = await snap(A.page);
  rec(scene, '專注中正文內按 Esc 離開', !afterEsc.focus, 'focus=false', `focus=${afterEsc.focus}`);
  rec(scene, 'Esc 離開後側欄恢復為進入前', afterEsc.left === before.left && afterEsc.right === before.right, `${before.left}/${before.right}`, `${afterEsc.left}/${afterEsc.right}`);
  rec(scene, 'Esc 離開後文字與選取不變', sameText(inFocus, afterEsc), `${inFocus.start}-${inFocus.end}/${inFocus.dir}`, `${afterEsc.start}-${afterEsc.end}/${afterEsc.dir}`);
  rec(scene, 'Esc 不強制失焦', inFocus.active === afterEsc.active, `active=${inFocus.active}`, `active=${afterEsc.active}`);
  await shot(A.page, `${scene}-Esc離開後`);

  // 未專注時按 Esc 不進入
  await A.page.keyboard.press('Escape');
  await A.page.waitForTimeout(300);
  rec(scene, '未專注按 Esc 不進入專注', !(await snap(A.page)).focus, 'focus=false', `focus=${(await snap(A.page)).focus}`);
  await A.context.close();

  // B：按鈕離開（比較基準）
  const B = await freshBook(browser, { viewport: { width, height } }, `${width}-B`);
  const beforeB = await snap(B.page);
  await enterFocus(B.page);
  await tid(B.page, 'exit-focus-mode').first().click({ timeout: 8000 });
  await B.page.waitForTimeout(500);
  const afterBtn = await snap(B.page);
  rec(scene, 'Esc 與「離開專注模式」按鈕：側欄恢復一致', afterBtn.left === afterEsc.left && afterBtn.right === afterEsc.right, `${afterBtn.left}/${afterBtn.right}`, `${afterEsc.left}/${afterEsc.right}`);
  rec(scene, '按鈕離開後也回到進入前側欄', afterBtn.left === beforeB.left && afterBtn.right === beforeB.right, `${beforeB.left}/${beforeB.right}`, `${afterBtn.left}/${afterBtn.right}`);
  await B.context.close();

  // C：repeat 不穿透
  const C = await freshBook(browser, { viewport: { width, height } }, `${width}-C`);
  await enterFocus(C.page);
  await C.page.keyboard.down('Escape');
  await C.page.keyboard.up('Escape');
  await C.page.waitForTimeout(300);
  const left = !(await snap(C.page)).focus;
  rec(scene, '單次按下 Esc 已離開（repeat 前置）', left, 'focus=false', `focus=${!left}`);
  await C.page.evaluate(() => {
    // 事件替身：repeat=true 的 Escape，用來確認長按不重複觸發（此時本就未專注，不得進入）
    document.querySelector('[data-testid="writing-input"]')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', repeat: true, bubbles: true, cancelable: true }));
  });
  await C.page.waitForTimeout(200);
  rec(scene, 'repeat 的 Esc 不進入專注', !(await snap(C.page)).focus, 'focus=false', `focus=${(await snap(C.page)).focus}`);
  // 專注中送 repeat Esc：不離開
  await enterFocus(C.page);
  await C.page.evaluate(() => {
    document.querySelector('[data-testid="writing-input"]')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', repeat: true, bubbles: true, cancelable: true }));
  });
  await C.page.waitForTimeout(300);
  rec(scene, '專注中 repeat 的 Esc 不離開（事件替身）', (await snap(C.page)).focus, 'focus=true', `focus=${(await snap(C.page)).focus}`);
  await C.context.close();

  // D：WO-114 存檔快速鍵與 Esc 並存：Ctrl+S 不離開專注
  const D = await freshBook(browser, { viewport: { width, height } }, `${width}-D`);
  await enterFocus(D.page);
  await D.page.keyboard.press('Control+s');
  await D.page.waitForTimeout(400);
  rec(scene, 'WO-114 回歸：專注中 Ctrl+S 不離開專注', (await snap(D.page)).focus, 'focus=true', `focus=${(await snap(D.page)).focus}`);
  await D.page.keyboard.press('Escape');
  await D.page.waitForTimeout(300);
  rec(scene, 'Ctrl+S 之後 Esc 仍可離開', !(await snap(D.page)).focus, 'focus=false', `focus=${(await snap(D.page)).focus}`);
  await D.context.close();

  // E：組字模擬
  const E = await freshBook(browser, { viewport: { width, height } }, `${width}-E`);
  await enterFocus(E.page);
  await E.page.evaluate(() => {
    const el = document.querySelector('[data-testid="writing-input"]');
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  });
  await E.page.keyboard.press('Escape');
  await E.page.waitForTimeout(300);
  const duringComp = (await snap(E.page)).focus;
  rec(scene, '組字中（composition 事件）Esc 不離開【事件替身，非真機輸入法】', duringComp, 'focus=true', `focus=${duringComp}`);
  await E.page.evaluate(() => {
    const el = document.querySelector('[data-testid="writing-input"]');
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 229, bubbles: true, cancelable: true }));
  });
  await E.page.waitForTimeout(300);
  const afterSim = (await snap(E.page)).focus;
  rec(scene, 'isComposing／keyCode 229 的 keydown 替身不離開【事件替身】', afterSim, 'focus=true', `focus=${afterSim}`);
  await E.page.keyboard.press('Escape');
  await E.page.waitForTimeout(400);
  rec(scene, '組字結束後新按 Esc 才離開', !(await snap(E.page)).focus, 'focus=false', `focus=${(await snap(E.page)).focus}`);
  await E.context.close();

  // F：卡片開著
  const F = await freshBook(browser, { viewport: { width, height } }, `${width}-F`);
  await enterFocus(F.page);
  const cardsBtn = F.page.getByRole('button', { name: '看卡片' }).first();
  if (await vis(cardsBtn)) {
    await cardsBtn.click({ timeout: 8000 });
    await F.page.waitForTimeout(600);
    const drawer = tid(F.page, 'writing-cards-drawer');
    const opened = await vis(drawer);
    rec(scene, '專注中由介面開啟卡片', opened, 'drawer 可見', String(opened));
    if (opened) {
      await F.page.keyboard.press('Escape');
      await F.page.waitForTimeout(400);
      const s1 = await snap(F.page);
      rec(scene, '卡片開著第一次 Esc 不離開專注', s1.focus, 'focus=true', `focus=${s1.focus}`);
      const stillOpen = await vis(drawer);
      note(scene, '卡片對 Esc 的實際行為', `現況卡片面板沒有 Esc 關閉流程；第一次 Esc 後卡片${stillOpen ? '仍開著（僅阻擋離開）' : '已關閉'}`);
      if (stillOpen) {
        await tid(F.page, 'close-cards-drawer').first().click({ timeout: 8000 });
        await F.page.waitForTimeout(500);
      }
      await F.page.keyboard.press('Escape');
      await F.page.waitForTimeout(400);
      rec(scene, '卡片關閉後下一次 Esc 才離開', !(await snap(F.page)).focus, 'focus=false', `focus=${(await snap(F.page)).focus}`);
    }
  } else {
    note(scene, '卡片情境', '專注中找不到「看卡片」按鈕，未能由介面到達，略過（非通過）');
  }
  await F.context.close();

  // G：搜尋開著（若能由專注中到達）
  const G = await freshBook(browser, { viewport: { width, height } }, `${width}-G`);
  await enterFocus(G.page);
  const searchBtn = G.page.getByRole('button', { name: '全書搜尋' }).first();
  if (await vis(searchBtn)) {
    await searchBtn.click({ timeout: 8000 });
    await G.page.waitForTimeout(500);
    const panel = tid(G.page, 'book-search-panel');
    if (await vis(panel)) {
      await G.page.keyboard.press('Escape');
      await G.page.waitForTimeout(400);
      const s = await snap(G.page);
      const open = await vis(panel);
      rec(scene, '搜尋開著第一次 Esc 不離開專注', s.focus, 'focus=true', `focus=${s.focus}`);
      note(scene, '搜尋對 Esc 的實際行為', `第一次 Esc 後搜尋面板${open ? '仍開著（僅阻擋離開）' : '已關閉'}`);
    } else {
      note(scene, '搜尋情境', '點搜尋鈕後面板不可見，略過');
    }
  } else {
    note(scene, '搜尋情境', '專注中沒有可見的搜尋入口，略過（非通過）');
  }
  await G.context.close();
}

async function layoutExclusions(browser) {
  const cases = [
    { name: 'medium-fine（桌面 800x900）', ctx: { viewport: { width: 800, height: 900 } }, expectExit: true },
    { name: 'medium-coarse-touch（800x900 觸控）', ctx: { viewport: { width: 800, height: 900 }, hasTouch: true, isMobile: true }, expectExit: 'byRule' },
    { name: 'wide-coarse-touch（1024x800 觸控）', ctx: { viewport: { width: 1024, height: 800 }, hasTouch: true, isMobile: true }, expectExit: 'byRule' },
    { name: 'phone-portrait（390x844）', ctx: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, expectExit: false },
    { name: 'phone-landscape（844x390）', ctx: { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }, expectExit: false },
  ];
  for (const c of cases) {
    const { context, page } = await freshBook(browser, c.ctx, c.name.slice(0, 8), { openAndPrepare: false });
    try {
      await openChapter(page);
    } catch {
      note(c.name, '進章', '無法進到正文，略過');
      await context.close();
      continue;
    }
    const enterBtn = tid(page, 'enter-focus-mode').first();
    let entered = false;
    if (await vis(enterBtn)) entered = await enterFocus(page).catch(() => false);
    else {
      const alt = page.getByRole('button', { name: /專注模式/ }).first();
      if (await vis(alt)) {
        await alt.click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(500);
        entered = (await snap(page)).focus;
      }
    }
    const before = await snap(page);
    if (!entered) {
      note(c.name, '進入專注', '此版面由介面進不了專注，略過');
      await context.close();
      continue;
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const after = await snap(page);
    const ruleExit = (before.layout === 'medium' || before.layout === 'wide') && (before.fine || before.pointerPref !== 'touch');
    const expected = c.expectExit === 'byRule' ? ruleExit : c.expectExit;
    rec(c.name, `Esc ${expected ? '離開' : '不離開'}專注（媒體條件模擬，非硬體驗證）`, after.focus === !expected,
      `focus=${!expected}`, `focus=${after.focus}`, { layout: before.layout, fine: before.fine, coarse: before.coarse, pointerPref: before.pointerPref });
    await shot(page, c.name.slice(0, 12).replace(/[^\w一-龥-]/g, '_'));
    await context.close();
  }
}

async function main() {
  const browser = await launch();
  try {
    await focusEscapeBasics(browser, 1024, 800);
    await focusEscapeBasics(browser, 1440, 900);
    await layoutExclusions(browser);
  } catch (err) {
    rec('執行', '腳本例外', false, '無例外', err && err.stack ? err.stack : String(err));
  } finally {
    await browser.close();
  }
  const failed = results.filter((r) => r.status === 'failed');
  fs.writeFileSync(path.join(QA_DIR, 'results.json'), JSON.stringify({ run: RUN_LABEL, base: BASE, results }, null, 2));
  console.log(`\n共 ${results.filter((r) => r.status !== 'note').length} 項，失敗 ${failed.length} 項。結果：${path.join(QA_DIR, 'results.json')}`);
  process.exit(failed.length ? 1 : 0);
}

main();
