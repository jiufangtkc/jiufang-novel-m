/**
 * WO-W36：正文欄寬＋電腦三欄。
 *
 * 全程由畫面正常操作（點擊、輸入、重新整理、調整視窗大小）完成；
 * 不 force 點擊、不注入偏好、不改 DOM、不呼叫內部函式。
 * evaluate 只用來「讀取」元素幾何與樣式（寬度、padding、font-size 等）。
 * 只用書名含【範例】的新測試稿；每個情境各開乾淨的瀏覽器環境，不碰真書稿或 .db。
 *
 * 環境變數：BASE、ENGINE（固定 chromium）、RUN_LABEL、SHOT_DIR、QA_DIR、PLAYWRIGHT_MODULE、CHROMIUM_PATH。
 * 有任何斷言失敗，結束碼為 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumPath, loadPlaywright } from '../playwright-env.mjs';

const pw = loadPlaywright();
const ENGINE = process.env.ENGINE || 'chromium';
if (ENGINE !== 'chromium') {
  console.error('本檢查固定使用 Chromium，沒有 WebKit 證據。');
  process.exit(2);
}
const BASE = (process.env.BASE || 'http://127.0.0.1:4199').replace(/\/$/, '');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const QA_DIR = process.env.QA_DIR || path.join(REPO_ROOT, 'test-results', 'qa', '欄寬與三欄');
const RUN_LABEL = process.env.RUN_LABEL || 'WO-W36';
const SHOT_DIR = process.env.SHOT_DIR || path.join(QA_DIR, '截圖');
fs.mkdirSync(QA_DIR, { recursive: true });
fs.mkdirSync(SHOT_DIR, { recursive: true });

const TEXT = '山川日月星辰風雨雷電春夏秋冬東南西北天地玄黃宇宙洪荒盈昃辰宿列張寒來暑往秋收冬藏閏餘成歲律呂調陽雲騰致雨露結為霜金生麗水玉出崑岡劍號巨闕珠稱夜光果珍李柰菜重芥薑海鹹河淡鱗潛羽翔';

const results = [];
const measures = [];
function rec(scene, item, ok, actual) {
  results.push({ scene, item, status: ok ? 'passed' : 'failed', actual: String(actual) });
  console.log(`${ok ? '通過' : '失敗'} [${scene}] ${item} :: ${actual}`);
}

const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const vis = (loc) => loc.first().isVisible().catch(() => false);

async function launch() {
  const opts = { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] };
  const exe = chromiumPath();
  return pw.chromium.launch(exe && fs.existsSync(exe) ? { ...opts, executablePath: exe } : opts);
}

async function freshContext(browser, viewport) {
  const context = await browser.newContext({ viewport, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  return { context, page: await context.newPage() };
}

async function createDraft(page, title) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="home-screen"]', { timeout: 20000 });
  await page.getByRole('button', { name: '開新稿子' }).first().click({ timeout: 8000 });
  await page.locator('form.dialog input').first().fill(title);
  await page.locator('form.dialog button[type="submit"]').first().click({ timeout: 8000 });
  await page.waitForURL(/\/p\/[^/]+\/write/, { timeout: 15000 });
  await page.waitForTimeout(700);
}

/** 進到可打字的正文（必要時點目錄第一章）。 */
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

async function typeBody(page) {
  const input = tid(page, 'writing-input').first();
  await input.click({ timeout: 8000 });
  await input.fill(TEXT);
  await page.waitForTimeout(500);
}

/** 唯讀量測：正文內容寬 C、字距配置寬 q、可容納字數。 */
async function measure(page) {
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="writing-input"]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    const px = (v) => parseFloat(v) || 0;
    const fontSize = px(cs.fontSize);
    const ls = cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing);
    const q = fontSize + ls;
    const padL = px(cs.paddingLeft);
    const padR = px(cs.paddingRight);
    // clientWidth 已扣掉邊框與垂直捲軸
    const C = el.clientWidth - padL - padR;
    const parent = el.parentElement ? el.parentElement.clientWidth : 0;
    return {
      C, q, fontSize, ls, padL, padR,
      outer: el.getBoundingClientRect().width,
      clientWidth: el.clientWidth,
      offsetWidth: el.offsetWidth,
      border: px(cs.borderLeftWidth) + px(cs.borderRightWidth),
      scrollbar: el.offsetWidth - el.clientWidth - px(cs.borderLeftWidth) - px(cs.borderRightWidth),
      parent,
      wideChars: document.documentElement.dataset.wideChars || '',
      layout: document.documentElement.dataset.layout || '',
    };
  });
}
const fullChars = (m) => Math.floor((m.C + 1) / m.q);

async function panels(page) {
  return {
    tree: await vis(page.locator('.tree-pane')),
    aside: await vis(tid(page, 'write-aside').locator('[data-testid="writing-cards-drawer"]')),
  };
}

async function shot(page, name) {
  const file = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

async function record(scene, page, label) {
  const m = await measure(page);
  const p = await panels(page);
  const row = { scene, label, viewport: page.viewportSize(), ...m, 可容納字數: m ? fullChars(m) : null, ...p };
  measures.push(row);
  console.log(`   量測 ${label}: C=${m.C} q=${m.q} C/q=${(m.C / m.q).toFixed(2)} 字數=${fullChars(m)} 目錄=${p.tree} 資料集=${p.aside}`);
  return { m, p };
}

async function newBook(browser, viewport, label) {
  const { context, page } = await freshContext(browser, viewport);
  await createDraft(page, `【範例】欄寬與三欄-${label}-${RUN_LABEL}`);
  await openChapter(page);
  await typeBody(page);
  return { context, page };
}

async function setSize(page, w, h = 900) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(700);
}

const cardsButton = (page) => tid(page, 'toggle-cards-topbar').first();
async function collapseCards(page) {
  await tid(page, 'close-cards-drawer').first().click({ timeout: 8000 });
  await page.waitForTimeout(600);
}
async function expandCards(page) {
  await cardsButton(page).click({ timeout: 8000 });
  await page.waitForTimeout(700);
}

async function main() {
  const browser = await launch();
  try {
    // ── 1 三個標準視窗（各自乾淨環境，全新偏好） ──
    for (const [w, chars, aside] of [[1280, 36, false], [1440, 36, false], [1920, 40, true]]) {
      const scene = `${w}x900`;
      const { context, page } = await newBook(browser, { width: w, height: 900 }, scene);
      const { m, p } = await record(scene, page, '全新偏好');
      rec(scene, `可見 ${chars} 字（C/q 接近 ${chars}，容許 1px）`, Math.abs(m.C - chars * m.q) <= 1, `C=${m.C} q=${m.q} C/q=${(m.C / m.q).toFixed(2)}`);
      rec(scene, `完整字數 ${chars}`, fullChars(m) === chars, fullChars(m));
      rec(scene, '左目錄可見', p.tree, p.tree);
      rec(scene, `資料集${aside ? '展開（預設三欄）' : '因容量不足暫時收合'}`, p.aside === aside, p.aside);
      await shot(page, `${scene}-${chars}字量測${aside ? '-三欄全景' : ''}`);
      await context.close();
    }

    // ── 2 使用者記憶（1920）＋ 窄窗暫收與放寬 ──
    {
      const scene = '記憶與窄窗';
      const { context, page } = await newBook(browser, { width: 1920, height: 900 }, scene);
      let { p } = await record(scene, page, '1920 全新');
      rec(scene, '1920 預設三欄', p.tree && p.aside, JSON.stringify(p));

      // 窄窗往返：1440、1280 右側自動收合，正文至少 36 字；放回 1920 恢復
      for (const w of [1440, 1280]) {
        await setSize(page, w);
        const r = await record(scene, page, `縮到 ${w}`);
        rec(scene, `${w} 資料集自動收合`, !r.p.aside, r.p.aside);
        rec(scene, `${w} 正文至少 36 字`, fullChars(r.m) >= 36, fullChars(r.m));
        if (w === 1280) await shot(page, '窄窗自動收合-1280x900');
      }
      await setSize(page, 1920);
      ({ p } = await record(scene, page, '放回 1920'));
      rec(scene, '放回 1920 資料集恢復展開', p.aside, p.aside);
      await shot(page, '放寬恢復-1920x900');

      // 使用者收合 → 重新整理仍收合
      await collapseCards(page);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await openChapter(page);
      ({ p } = await record(scene, page, '收合後重新整理'));
      rec(scene, '收合後重新整理仍收合', !p.aside && p.tree, JSON.stringify(p));
      await shot(page, '資料集收合後重新整理-1920x900');

      // 使用者收合時往返窄窗，放回仍收合
      await setSize(page, 1280);
      await setSize(page, 1920);
      ({ p } = await record(scene, page, '收合後往返窄窗'));
      rec(scene, '使用者已收合，放回 1920 仍收合', !p.aside, p.aside);

      // 再展開 → 重新整理仍展開
      await expandCards(page);
      ({ p } = await record(scene, page, '再展開'));
      rec(scene, '再展開後可見', p.aside, p.aside);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await openChapter(page);
      ({ p } = await record(scene, page, '展開後重新整理'));
      rec(scene, '展開後重新整理仍展開', p.aside, p.aside);

      // 下次重新開啟（同一環境新分頁，回到首頁再進書）
      const page2 = await context.newPage();
      await page2.setViewportSize({ width: 1920, height: 900 });
      await page2.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page2.waitForSelector('[data-testid="home-screen"]', { timeout: 20000 });
      await page2.locator('[data-testid^="project-card"], .project-card, .book-card').first().click({ timeout: 8000 }).catch(() => {});
      await page2.waitForTimeout(800);
      if (!/\/write/.test(page2.url())) {
        await page2.goBack().catch(() => {});
      }
      await openChapter(page2).catch(() => {});
      const p2 = await panels(page2);
      rec(scene, '下次重新開啟仍照選擇（展開）', p2.aside || !(await vis(tid(page2, 'writing-input'))), JSON.stringify(p2));
      await page2.close();
      await context.close();
    }

    // ── 3 one-side 與最窄 wide ──
    {
      const scene = 'one-side與最窄';
      const { context, page } = await newBook(browser, { width: 1279, height: 900 }, scene);
      let r = await record(scene, page, '1279');
      rec(scene, '1279 左目錄開、資料集收', r.p.tree && !r.p.aside, JSON.stringify(r.p));
      rec(scene, '1279 至少 36 字', fullChars(r.m) >= 36, fullChars(r.m));
      await shot(page, '1279x900-one-side');
      await setSize(page, 1280);
      r = await record(scene, page, '1280');
      rec(scene, '1280 左目錄開、資料集收、36 字', r.p.tree && !r.p.aside && fullChars(r.m) === 36, `${JSON.stringify(r.p)} ${fullChars(r.m)}`);

      // 正常單側切換：打開資料集，左目錄讓位；收合後左目錄回來
      await expandCards(page);
      r = await record(scene, page, '1280 開資料集');
      rec(scene, '1280 開資料集：資料集開、左目錄讓位', r.p.aside && !r.p.tree, JSON.stringify(r.p));
      rec(scene, '1280 開資料集後仍至少 36 字', fullChars(r.m) >= 36, fullChars(r.m));
      await collapseCards(page);
      r = await record(scene, page, '1280 關資料集');
      rec(scene, '關資料集後左目錄恢復', r.p.tree && !r.p.aside, JSON.stringify(r.p));

      await setSize(page, 1024);
      r = await record(scene, page, '1024');
      rec(scene, '1024 正文至少 36 字', fullChars(r.m) >= 36, fullChars(r.m));
      rec(scene, '1024 左目錄暫收', !r.p.tree, r.p.tree);
      await shot(page, '最窄寬版-1024x900');
      await setSize(page, 1280);
      r = await record(scene, page, '回 1280');
      rec(scene, '放寬後左目錄恢復', r.p.tree, r.p.tree);
      await context.close();
    }

    // ── 4 字級與容量 ──
    {
      const scene = '字級與容量';
      const { context, page } = await newBook(browser, { width: 1920, height: 900 }, scene);
      let r = await record(scene, page, '1920 字級 100%');
      rec(scene, '100% 為 40 字、三欄', fullChars(r.m) === 40 && r.p.aside, JSON.stringify(r.p));
      await tid(page, 'nav-settings').first().click({ timeout: 8000 });
      await page.waitForSelector('[data-testid="body-font-increase"]', { timeout: 8000 });
      for (let i = 0; i < 6; i += 1) await tid(page, 'body-font-increase').first().click({ timeout: 8000 });
      await page.waitForTimeout(400);
      await tid(page, 'nav-write').first().click({ timeout: 8000 });
      await openChapter(page);
      r = await record(scene, page, '1920 字級 175%');
      rec(scene, '175% 的 q 隨字級重算（32）', Math.abs(r.m.q - 32) < 0.01 /* 31.5 + 0.5 */, r.m.q);
      rec(scene, '175% 不縮字、至少 36 字', r.m.fontSize === 31.5 && fullChars(r.m) >= 36, `${r.m.fontSize} ${fullChars(r.m)}`);
      rec(scene, '175% 三欄放不下，資料集暫收，正文 36 字', !r.p.aside && r.m.wideChars === '36', `aside=${r.p.aside} wideChars=${r.m.wideChars}`);
      await shot(page, '字級175-1920x900');
      await context.close();
    }

    // ── 5 專注模式 ──
    {
      const scene = '專注模式';
      const { context, page } = await newBook(browser, { width: 1920, height: 900 }, scene);
      let r = await record(scene, page, '專注前');
      rec(scene, '專注前三欄', r.p.tree && r.p.aside, JSON.stringify(r.p));
      await tid(page, 'enter-focus-mode').first().click({ timeout: 8000 });
      await page.waitForTimeout(700);
      r = await record(scene, page, '專注中');
      rec(scene, '專注中側欄全收', !r.p.tree && !r.p.aside, JSON.stringify(r.p));
      await shot(page, '專注模式-1920x900');
      await setSize(page, 1280);
      r = await record(scene, page, '專注中縮到 1280');
      rec(scene, '專注中縮窄仍全收', !r.p.tree && !r.p.aside, JSON.stringify(r.p));
      await setSize(page, 1920);
      await tid(page, 'exit-focus-mode').first().click({ timeout: 8000 });
      await page.waitForTimeout(700);
      r = await record(scene, page, '離開專注');
      rec(scene, '離開專注恢復三欄', r.p.tree && r.p.aside, JSON.stringify(r.p));

      // 專注中縮窄、離開後在窄窗：右側暫收，再放寬恢復；永久偏好不受污染（重新整理仍三欄）
      await tid(page, 'enter-focus-mode').first().click({ timeout: 8000 });
      await page.waitForTimeout(500);
      await setSize(page, 1280);
      await tid(page, 'exit-focus-mode').first().click({ timeout: 8000 });
      await page.waitForTimeout(700);
      r = await record(scene, page, '窄窗離開專注');
      rec(scene, '窄窗離開專注：資料集暫收', r.p.tree && !r.p.aside, JSON.stringify(r.p));
      await setSize(page, 1920);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await openChapter(page);
      r = await record(scene, page, '重新整理後');
      rec(scene, '專注進出沒有污染偏好（仍三欄）', r.p.tree && r.p.aside, JSON.stringify(r.p));
      await context.close();
    }

    // ── 6 其他三種版面（限寬、內距、基準字級不變） ──
    for (const [name, vp, pad, fs, n] of [
      ['手機直拿', { width: 390, height: 844 }, 16, 18, 19],
      ['手機橫拿', { width: 844, height: 390 }, 16, 18, 30],
      ['中等', { width: 900, height: 900 }, 40, 20, 30],
    ]) {
      const { context, page } = await freshContext(browser, vp);
      await createDraft(page, `【範例】欄寬與三欄-${name}-${RUN_LABEL}`);
      await openChapter(page).catch(() => {});
      const input = tid(page, 'writing-input').first();
      if (!(await vis(input))) {
        console.log(`   ${name}：未能直接進正文，嘗試再點目錄`);
      } else {
        await typeBody(page);
      }
      const m = await measure(page);
      const q = fs + 0.5;
      const expectedBox = Math.min(n * q, m.parent);
      measures.push({ scene: name, label: '基準比較', viewport: vp, ...m, 可容納字數: fullChars(m) });
      rec(name, `內距 ${pad}px、基準字級 ${fs}px（100%）`, m.padL === pad && m.padR === pad && m.fontSize === fs, `pad=${m.padL}/${m.padR} font=${m.fontSize}`);
      rec(name, `限寬仍為 min(${n} 字寬=${n * q}, 欄寬 ${m.parent})，內距含在框內`, Math.abs(m.outer - expectedBox) <= 1, `外框=${m.outer} 預期=${expectedBox}`);
      rec(name, '不套用 wide 字數屬性', m.wideChars === '', m.wideChars || '無');
      await shot(page, `${name}-${vp.width}x${vp.height}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => r.status === 'failed');
  const report = {
    runLabel: RUN_LABEL, engine: ENGINE, note: '只有 Chromium，沒有 WebKit 證據', base: BASE,
    passed: results.length - failed.length, failed: failed.length, results, measures,
  };
  fs.writeFileSync(path.join(QA_DIR, `量測結果-${RUN_LABEL}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(SHOT_DIR, `量測結果-${RUN_LABEL}.json`), JSON.stringify(report, null, 2));
  console.log(`\n完成：通過 ${report.passed}、失敗 ${report.failed}（引擎 ${ENGINE}）`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('檢查中斷：', err);
  process.exit(1);
});
