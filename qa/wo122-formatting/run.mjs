/**
 * WO-122：寫作頁排版小工具的獨立瀏覽器驗收（不屬於 npm test，由派工人執行）。
 *
 * 做法：
 *  - 只用腳本自製的假稿「【範例】WO-122 排版驗收」：先由畫面開新稿子，再把本機儲存的稿子內容換成自製的
 *    多章多幕假稿（含空正文、未開節點、卡片、長標題、大份正文）與另一份假稿，用 storageState 帶進乾淨 context。
 *    不讀任何真書稿或 .db。
 *  - 排版、復原、專注、鍵盤都用畫面操作（點擊、真實鍵盤）；evaluate 只「讀」狀態（data-layout、localStorage 內的稿子、
 *    文字框內容、class），唯一例外是組字不在本腳本範圍。橫拿打字用真實點擊／輸入觸發，不直接加 landscape-writing。
 *  - 預期結果由本腳本自己另寫一份簡單轉換（只用 LF 測資）計算，與 App 內程式互為對照；CRLF／混合換行由單元測試負責。
 *
 * 環境變數：
 *   BASE       預設 http://127.0.0.1:4199
 *   QA_DIR     報告與截圖目錄，預設 /workspace/delivery/novel-editor-mobile/wo122/qa
 *   HEADLESS   1（預設）或 0（有頭）；截圖檔名前綴為 headless- 或 headed-
 *   PLAYWRIGHT_MODULE、CHROMIUM_PATH／PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH（沿用 qa/playwright-env.mjs）
 * 有任何「失敗」結束碼為 1；缺環境（找不到 Playwright）也非零結束，並說明待驗。
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromiumPath, loadPlaywright } from '../playwright-env.mjs';

const BASE = (process.env.BASE || 'http://127.0.0.1:4199').replace(/\/$/, '');
const QA_DIR = process.env.QA_DIR || '/workspace/delivery/novel-editor-mobile/wo122/qa';
const HEADLESS = process.env.HEADLESS !== '0';
const MODE = HEADLESS ? 'headless' : 'headed';
fs.mkdirSync(QA_DIR, { recursive: true });

const OUTLINE_KEY = 'jiufang-novel-m.outline.v1';
const TITLE = '【範例】WO-122 排版驗收';
const OTHER_ID = 'p-1700000000999';
const IDEO = '　';
const LONG_TITLE = '第一章　這是一個非常非常非常非常非常非常非常非常長的章名，用來確認頁首的更多按鈕不會被擠掉';
const BIG_TEXT = Array.from({ length: 80 }, (_, i) => `${i % 7 === 3 ? '' : IDEO}甲乙丙丁戊己庚辛${i}`).join('\n');

const results = [];
function rec(scene, item, status, expected, actual, extra = {}) {
  results.push({ scene, item, status, expected: String(expected), actual: String(actual), ...extra });
  const tag = { passed: '通過', failed: '失敗', pending: '待驗', note: '備註' }[status];
  console.log(`${tag} [${scene}] ${item} :: 預期 ${expected} / 實際 ${actual}`);
}
const check = (scene, item, ok, expected, actual, extra) => rec(scene, item, ok ? 'passed' : 'failed', expected, actual, extra);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const vis = (loc) => loc.first().isVisible().catch(() => false);
const shots = [];
async function shot(page, name) {
  const file = path.join(QA_DIR, `${MODE}-${name}.png`);
  await page.screenshot({ path: file }).catch((e) => note('截圖', name, `截圖失敗：${e.message}`));
  shots.push(file);
  return file;
}
function note(scene, item, text) {
  rec(scene, item, 'note', '', text);
}

// ---------- 自製假稿 ----------
function seedNodes() {
  return [
    {
      id: 'v1',
      type: 'folder',
      title: '第一卷',
      expanded: true,
      children: [
        {
          id: 'c1',
          type: 'file',
          title: LONG_TITLE,
          progress: 'Draft',
          content: `甲甲甲\n乙乙乙\n\n\n${IDEO}丙丙丙\n \t丁丁丁`,
          expanded: true,
          children: [
            { id: 's1', type: 'scene', title: '第一幕', content: '戊戊\n己己' },
            { id: 's2', type: 'scene', title: '第二幕（空）', content: '' },
          ],
        },
        { id: 'c2', type: 'file', title: '第二章（空）', progress: 'Draft', content: '' },
        { id: 'c3', type: 'file', title: '第三章', progress: 'Draft', content: ' 庚庚\n辛辛\n\n壬壬' },
        { id: 'c4', type: 'file', title: '第四章（大份正文）', progress: 'Draft', content: BIG_TEXT },
      ],
    },
    { id: 'c5', type: 'file', title: '第五章（卷外）', progress: 'Draft', content: '癸癸\n\n\n子子' },
  ];
}
const SEED_CARDS = [
  { id: 'card-1', parent_id: null, category: '人物', title: '【範例】甲', content: '卡片內容\n\n\n不可被排版', color: '', is_collapsed: 0, sort_order: 0 },
  { id: 'card-2', parent_id: null, category: '地點', title: '【範例】乙', content: ' 資料集內容', color: '', is_collapsed: 0, sort_order: 1 },
];
const flat = (nodes, out = []) => {
  for (const n of nodes) {
    out.push(n);
    if (n.children) flat(n.children, out);
  }
  return out;
};
const writable = (nodes) => flat(nodes).filter((n) => n.type === 'file' || n.type === 'scene');

// 預期結果：本腳本自己的簡單實作（LF 測資）
const isBlank = (l) => /^[ 　\t\r]*$/.test(l);
function fmt(kind, text) {
  const lines = text.split('\n');
  if (kind === 'indent') return lines.map((l) => (isBlank(l) ? l : `${IDEO}${IDEO}${l.replace(/^[ 　\t]+/, '')}`)).join('\n');
  const kept = lines.filter((l) => !isBlank(l));
  return kept.join(kind === 'strip-blank' ? '\n' : '\n\n');
}
const KIND_LABEL = { indent: '段首加兩個全形空格', 'strip-blank': '去除空行', 'space-paragraphs': '段落之間加空行' };
const SCOPE_LABEL = { chapter: '這一章', book: '全書' };

// ---------- 瀏覽器與 context ----------
async function launch(pw) {
  const opts = { headless: HEADLESS, args: ['--no-sandbox', '--disable-setuid-sandbox'] };
  const exe = chromiumPath();
  return pw.chromium.launch(exe && fs.existsSync(exe) ? { ...opts, executablePath: exe } : opts);
}
const initScript = (desktopLike) => {
  try {
    localStorage.setItem('jiufang-novel-m.onboarding.v1', JSON.stringify({ status: 'skipped', at: '2026-11-18T05:00:00.000Z', appVersion: '0.1.0' }));
    localStorage.setItem('jiufang-novel-m.theme.v1', 'forest');
    if (desktopLike) {
      localStorage.setItem('jiufang-novel-m.input-mode.v1', 'mouse');
      localStorage.setItem('jiufang-novel-m.device-kind.v1', 'computer');
    }
  } catch {}
};
const matchMediaStub = () => {
  const real = window.matchMedia.bind(window);
  window.matchMedia = (q) => {
    const s = String(q).replace(/\s/g, '');
    const stub = (matches) => ({ matches, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true });
    if (s === '(pointer:fine)' || s === '(any-pointer:fine)' || s === '(hover:hover)') return stub(true);
    if (s === '(pointer:coarse)') return stub(false);
    return real(q);
  };
};

const LAYOUTS = {
  'phone-portrait': { viewport: { width: 390, height: 844 }, mobile: true },
  'phone-landscape': { viewport: { width: 844, height: 390 }, mobile: true },
  medium: { viewport: { width: 768, height: 1024 }, mobile: false },
  wide: { viewport: { width: 1440, height: 900 }, mobile: false },
  'phone-narrow': { viewport: { width: 320, height: 568 }, mobile: true },
  'wide-1100': { viewport: { width: 1100, height: 800 }, mobile: false },
};

async function newCtx(browser, seed, layoutKey) {
  const { viewport, mobile } = LAYOUTS[layoutKey];
  const context = await browser.newContext({
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    viewport,
    isMobile: mobile,
    hasTouch: mobile,
    storageState: seed.state,
  });
  await context.addInitScript(initScript, !mobile);
  if (!mobile) await context.addInitScript(matchMediaStub);
  const page = await context.newPage();
  return { context, page };
}

async function openChapter(page, seed, id) {
  await page.goto(`${BASE}/p/${seed.pid}/write/${id}`, { waitUntil: 'domcontentloaded' });
  await tid(page, 'writing-input').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(500);
}

async function seedBook(browser) {
  const context = await browser.newContext({ locale: 'zh-TW', timezoneId: 'Asia/Taipei', viewport: { width: 1440, height: 900 } });
  await context.addInitScript(initScript, true);
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="home-screen"]', { timeout: 20000 });
  await page.getByRole('button', { name: '開新稿子' }).first().click({ timeout: 8000 });
  await page.locator('form.dialog input').first().fill(TITLE);
  await page.locator('form.dialog button[type="submit"]').first().click({ timeout: 8000 });
  await page.waitForURL(/\/p\/[^/]+\/write/, { timeout: 15000 });
  await page.waitForTimeout(1200);
  const pid = page.url().match(/\/p\/([^/]+)\/write/)[1];
  const state = await context.storageState();
  await context.close();
  const origin = state.origins.find((o) => o.origin === new URL(BASE).origin);
  const item = origin?.localStorage.find((i) => i.name === OUTLINE_KEY);
  if (!item) throw new Error('新稿子沒有寫進本機儲存，無法建立假稿');
  const projects = JSON.parse(item.value);
  const book = projects.find((p) => p.id === pid);
  book.nodes = seedNodes();
  book.cards = JSON.parse(JSON.stringify(SEED_CARDS));
  book.shape = 'novel';
  book.lastOpenedNodeId = 'c1';
  const other = JSON.parse(JSON.stringify(book));
  other.id = OTHER_ID;
  other.title = '【範例】另一份假稿（不可被改）';
  other.nodes = [{ id: 'o1', type: 'file', title: '另一份第一章', progress: 'Draft', content: ' 子子\n\n\n丑丑' }];
  projects.push(other);
  item.value = JSON.stringify(projects);
  return { state, pid };
}

// ---------- 唯讀檢查 ----------
const readProjects = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), OUTLINE_KEY);
const counts = (page) =>
  page.evaluate(() => {
    let paste = 0;
    let del = 0;
    let rows = 0;
    for (let i = 0; i < localStorage.length; i += 1) {
      const v = localStorage.getItem(localStorage.key(i)) || '';
      for (const m of v.matchAll(/"paste_large_count":\s*(\d+)/g)) {
        paste += Number(m[1]);
        rows += 1;
      }
      for (const m of v.matchAll(/"delete_large_count":\s*(\d+)/g)) del += Number(m[1]);
    }
    return { paste, del, rows };
  });
const body = (page) => tid(page, 'writing-input').first().inputValue();
const layoutOf = (page) => page.evaluate(() => document.documentElement.dataset.layout);
const hasClass = (page, cls) => page.evaluate((c) => document.documentElement.classList.contains(c), cls);
const originalOf = (id) => writable(seedNodes()).find((n) => n.id === id)?.content ?? '';

async function waitProjects(page, pid, predicate, timeout = 5000) {
  const end = Date.now() + timeout;
  let last = null;
  while (Date.now() < end) {
    const projects = await readProjects(page);
    last = projects.find((p) => p.id === pid);
    if (last && predicate(last, projects)) return { ok: true, project: last, projects };
    await page.waitForTimeout(150);
  }
  return { ok: false, project: last, projects: null };
}

/** 預期整份稿子：scope／kind 決定哪些章幕被排版；其他（標題、卷、卡片、順序、型別）一律照原樣。 */
function expectedBook(kind, scope, currentId, baseline = seedNodes()) {
  const nodes = JSON.parse(JSON.stringify(baseline));
  for (const n of flat(nodes)) {
    if (n.type === 'folder') continue;
    if (scope === 'chapter' && n.id !== currentId) continue;
    n.content = fmt(kind, n.content ?? '');
  }
  return nodes;
}
const contentMap = (nodes) => Object.fromEntries(writable(nodes).map((n) => [n.id, n.content ?? '']));
const skeleton = (nodes) => JSON.stringify(flat(nodes).map((n) => [n.id, n.type, n.title, n.progress ?? null, n.type === 'folder' ? n.content ?? null : 0]));

async function verifyBook(page, seed, scene, label, expectedNodes) {
  const r = await waitProjects(page, seed.pid, (p) => same(contentMap(p.nodes), contentMap(expectedNodes)));
  const p = r.project;
  check(scene, `${label}：各章幕正文符合預期（只改目標、已自動暫存）`, r.ok, JSON.stringify(contentMap(expectedNodes)).slice(0, 160), r.ok ? 'ok' : JSON.stringify(contentMap(p?.nodes ?? [])).slice(0, 160));
  if (!p) return;
  check(scene, `${label}：標題、卷、型別、順序不變`, skeleton(p.nodes) === skeleton(seedNodes()), 'skeleton 相同', skeleton(p.nodes) === skeleton(seedNodes()) ? '相同' : '不同');
  check(scene, `${label}：卡片與資料集不變`, same(p.cards, SEED_CARDS), '深比對相同', same(p.cards, SEED_CARDS) ? '相同' : '不同');
  const projects = r.projects ?? (await readProjects(page));
  const other = projects.find((x) => x.id === OTHER_ID);
  check(scene, `${label}：另一份稿子不變`, Boolean(other) && same(other.nodes[0].content, ' 子子\n\n\n丑丑'), '另一份稿子正文原樣', other ? JSON.stringify(other.nodes[0].content) : '找不到');
}

// ---------- 畫面操作 ----------
async function moreButton(page) {
  for (const id of ['format-more-topbar', 'format-more-landscape']) {
    const loc = tid(page, id).first();
    if (await vis(loc)) return loc;
  }
  return null;
}
async function openMenu(page) {
  const more = await moreButton(page);
  if (!more) throw new Error('看不到可用的「更多」入口');
  await more.click({ timeout: 8000 });
  await tid(page, 'format-menu').first().waitFor({ state: 'visible', timeout: 5000 });
}
async function toConfirm(page, kind, scope) {
  await openMenu(page);
  await tid(page, 'format-menu-item').first().click({ timeout: 5000 });
  await tid(page, `format-kind-${kind}`).first().click({ timeout: 5000 });
  await tid(page, `format-scope-${scope}`).first().click({ timeout: 5000 });
  await tid(page, 'format-step-confirm').first().waitFor({ state: 'visible', timeout: 5000 });
}
async function startFormat(page) {
  await tid(page, 'format-start').first().click({ timeout: 5000 });
  await page.waitForTimeout(300);
}
async function doFormat(page, kind, scope) {
  await toConfirm(page, kind, scope);
  await startFormat(page);
}

// ---------- 場景 ----------
async function flowScenes(browser, seed) {
  for (const kind of Object.keys(KIND_LABEL)) {
    for (const scope of Object.keys(SCOPE_LABEL)) {
      const scene = `流程-${kind}-${scope}`;
      const stepShots = kind === 'indent';
      // 排版 → 暫存 → 重新載入讀回
      {
        const { context, page } = await newCtx(browser, seed, 'wide');
        await openChapter(page, seed, 'c1');
        const before = await counts(page);
        await toConfirm(page, kind, scope);
        const sentence = await tid(page, 'format-confirm-sentence').first().innerText();
        check(scene, '確認句與暫定用字相符', sentence === `要把${SCOPE_LABEL[scope]}的正文做「${KIND_LABEL[kind]}」嗎？只改正文，改完可以復原。`, '範本句', sentence);
        const dialogText = await tid(page, 'format-step-confirm').first().innerText();
        check(scene, '確認視窗有復原提醒' + (scope === 'book' ? '與全書補充' : ''), dialogText.includes('按「復原」會回到這次排版前') && (scope === 'chapter' || dialogText.includes('全書會一起改這本稿子裡所有章和幕的正文。')), '含提醒', dialogText.slice(0, 80));
        if (stepShots) await shot(page, `confirm-${scope}`);
        // 確認前什麼都沒動
        const untouched = await waitProjects(page, seed.pid, (p) => same(contentMap(p.nodes), contentMap(seedNodes())), 800);
        check(scene, '確認前正文沒有改動、沒有復原提示', untouched.ok && !(await vis(tid(page, 'format-notice'))), '未改動', untouched.ok ? '未改動' : '已改動');
        await startFormat(page);
        const expected = expectedBook(kind, scope, 'c1');
        const want = contentMap(expected).c1;
        const got = await body(page);
        check(scene, '目前開著的正文框立刻顯示排版結果', got === want, JSON.stringify(want).slice(0, 80), JSON.stringify(got).slice(0, 80));
        check(scene, '完成提示「排版好了」與「復原」按鈕出現', (await vis(tid(page, 'format-notice'))) && (await vis(tid(page, 'format-undo'))), '提示可見', String(await vis(tid(page, 'format-notice'))));
        const noticeText = await tid(page, 'format-notice').first().innerText().catch(() => '');
        check(scene, '完成提示含「排版好了」與覆蓋提醒', noticeText.includes('排版好了') && noticeText.includes('連排版後在這些正文新打的字也會一起還原'), '含兩者', noticeText.slice(0, 60));
        if (stepShots) await shot(page, `done-undo-${scope}`);
        await verifyBook(page, seed, scene, '排版後', expected);
        const after = await counts(page);
        check(scene, '排版前後 paste_large_count／delete_large_count 不變', before.paste === after.paste && before.del === after.del, `${before.paste}/${before.del}`, `${after.paste}/${after.del}`);
        // 提示持續顯示（超過一般提示時間）
        await page.waitForTimeout(10500);
        check(scene, '完成提示持續超過 10 秒仍在', await vis(tid(page, 'format-notice')), '仍可見', String(await vis(tid(page, 'format-notice'))));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await tid(page, 'writing-input').first().waitFor({ state: 'visible', timeout: 15000 });
        await page.waitForTimeout(600);
        check(scene, '重新載入後正文框讀回排版結果', (await body(page)) === want, JSON.stringify(want).slice(0, 80), JSON.stringify(await body(page)).slice(0, 80));
        await verifyBook(page, seed, scene, '重新載入後', expected);
        check(scene, '重新載入後不要求保留復原按鈕', !(await vis(tid(page, 'format-notice'))), '無提示', String(await vis(tid(page, 'format-notice'))));
        await context.close();
      }
      // 排版 → 復原 → 暫存 → 重新載入讀回
      {
        const { context, page } = await newCtx(browser, seed, 'wide');
        await openChapter(page, seed, 'c1');
        const before = await counts(page);
        await doFormat(page, kind, scope);
        await tid(page, 'format-undo').first().click({ timeout: 5000 });
        await page.waitForTimeout(400);
        if (stepShots) await shot(page, `after-undo-${scope}`);
        const baseline = seedNodes();
        check(scene, '復原後正文框回到排版前', (await body(page)) === originalOf('c1'), JSON.stringify(originalOf('c1')).slice(0, 80), JSON.stringify(await body(page)).slice(0, 80));
        check(scene, '復原後提示與按鈕消失（快照清空）', !(await vis(tid(page, 'format-undo'))), '無復原鈕', String(await vis(tid(page, 'format-undo'))));
        await verifyBook(page, seed, scene, '復原後', baseline);
        const after = await counts(page);
        check(scene, '復原後兩種大量計數仍相等', before.paste === after.paste && before.del === after.del, `${before.paste}/${before.del}`, `${after.paste}/${after.del}`);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await tid(page, 'writing-input').first().waitFor({ state: 'visible', timeout: 15000 });
        await page.waitForTimeout(600);
        await verifyBook(page, seed, scene, '復原後重新載入', baseline);
        check(scene, '復原後重新載入正文框為排版前', (await body(page)) === originalOf('c1'), '排版前', JSON.stringify(await body(page)).slice(0, 80));
        await context.close();
      }
    }
  }
}

async function behaviourScenes(browser, seed) {
  const scene = '行為';
  // 取消完全不改
  {
    const { context, page } = await newCtx(browser, seed, 'wide');
    await openChapter(page, seed, 'c1');
    await toConfirm(page, 'indent', 'book');
    await tid(page, 'format-cancel').first().click({ timeout: 5000 });
    await page.waitForTimeout(300);
    check(scene, '取消：視窗關閉、沒有提示、正文不變', !(await vis(tid(page, 'format-step-confirm'))) && !(await vis(tid(page, 'format-notice'))) && (await body(page)) === originalOf('c1'), '不變', 'ok');
    await verifyBook(page, seed, scene, '取消後', seedNodes());
    const focusBack = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    check(scene, '取消後焦點回到原入口', focusBack === 'format-more-topbar', 'format-more-topbar', String(focusBack));
    await context.close();
  }
  // 空章：無改動提示
  {
    const { context, page } = await newCtx(browser, seed, 'wide');
    await openChapter(page, seed, 'c2');
    await doFormat(page, 'indent', 'chapter');
    const toast = await page.locator('.toast').first().innerText().catch(() => '');
    check(scene, '空章：顯示「已經是這個樣子，不用再改。」', toast.includes('已經是這個樣子，不用再改。'), '無改動提示', toast);
    check(scene, '空章：不出現完成提示與復原鈕', !(await vis(tid(page, 'format-notice'))), '無提示', String(await vis(tid(page, 'format-notice'))));
    await context.close();
  }
  // 打字後復原會覆蓋新字（含提醒）；其他章幕不受影響
  {
    const { context, page } = await newCtx(browser, seed, 'wide');
    await openChapter(page, seed, 'c1');
    await doFormat(page, 'space-paragraphs', 'chapter');
    const input = tid(page, 'writing-input').first();
    await input.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('排版後新打的字');
    check(scene, '排版後打字，復原提示仍在', await vis(tid(page, 'format-undo')), '仍可見', String(await vis(tid(page, 'format-undo'))));
    await tid(page, 'format-undo').first().click({ timeout: 5000 });
    await page.waitForTimeout(400);
    check(scene, '復原後新打的字一起還原（被覆蓋）', (await body(page)) === originalOf('c1'), '排版前', JSON.stringify(await body(page)).slice(0, 80));
    await verifyBook(page, seed, scene, '打字後復原', seedNodes());
    await context.close();
  }
  // 連做兩次只復原第二次；沒有內容可復原不報錯
  {
    const { context, page } = await newCtx(browser, seed, 'wide');
    await openChapter(page, seed, 'c1');
    await doFormat(page, 'space-paragraphs', 'chapter');
    const first = await body(page);
    await doFormat(page, 'indent', 'chapter');
    const second = await body(page);
    check(scene, '兩次排版結果不同', first !== second, '不同', first === second ? '相同' : '不同');
    await tid(page, 'format-undo').first().click({ timeout: 5000 });
    await page.waitForTimeout(400);
    check(scene, '復原第二次回到第一次排版後', (await body(page)) === first, JSON.stringify(first).slice(0, 80), JSON.stringify(await body(page)).slice(0, 80));
    check(scene, '不能再復原第一次（按鈕已消失）', !(await vis(tid(page, 'format-undo'))), '無復原鈕', String(await vis(tid(page, 'format-undo'))));
    await context.close();
  }
  // 全書復原包含沒開的章幕；換章後復原不覆蓋沒被排版的章幕
  {
    const { context, page } = await newCtx(browser, seed, 'wide');
    await openChapter(page, seed, 'c3');
    await doFormat(page, 'indent', 'book');
    await verifyBook(page, seed, scene, '全書排版', expectedBook('indent', 'book', 'c3'));
    await tid(page, 'format-undo').first().click({ timeout: 5000 });
    await page.waitForTimeout(500);
    await verifyBook(page, seed, scene, '全書復原（含未開章幕）', seedNodes());
    await context.close();
  }
  // 大份自製正文：兩種大量計數前後相等、沒有 WO-113 阻擋訊息
  {
    const { context, page } = await newCtx(browser, seed, 'wide');
    await openChapter(page, seed, 'c4');
    const before = await counts(page);
    if (before.rows === 0) note(scene, '大量計數欄位', '本機儲存內找不到 paste_large_count 欄位，下列「相等」可能是空比較，請人工確認統計頁');
    await doFormat(page, 'space-paragraphs', 'chapter');
    const mid = await counts(page);
    const pageText = await page.evaluate(() => document.body.innerText);
    check(scene, '大份正文排版：沒有 WO-113 阻擋訊息', !pageText.includes('匯入已經存在的稿子'), '無阻擋訊息', pageText.includes('匯入已經存在的稿子') ? '出現' : '無');
    check(scene, '大份正文排版後兩種大量計數不變', before.paste === mid.paste && before.del === mid.del, `${before.paste}/${before.del}`, `${mid.paste}/${mid.del}`);
    await tid(page, 'format-undo').first().click({ timeout: 5000 });
    await page.waitForTimeout(500);
    const end = await counts(page);
    check(scene, '大份正文復原後兩種大量計數不變', before.paste === end.paste && before.del === end.del, `${before.paste}/${before.del}`, `${end.paste}/${end.del}`);
    check(scene, '大份正文復原後回到排版前', (await body(page)) === BIG_TEXT, '原文', (await body(page)) === BIG_TEXT ? '相同' : '不同');
    await context.close();
  }
  // 鍵盤操作與焦點
  {
    const { context, page } = await newCtx(browser, seed, 'wide');
    await openChapter(page, seed, 'c1');
    await tid(page, 'format-more-topbar').first().focus();
    const expandedBefore = await tid(page, 'format-more-topbar').first().getAttribute('aria-expanded');
    await page.keyboard.press('Enter');
    await tid(page, 'format-menu').first().waitFor({ state: 'visible', timeout: 5000 });
    const focusInMenu = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    const expandedOpen = await tid(page, 'format-more-topbar').first().getAttribute('aria-expanded');
    check(scene, '鍵盤 Enter 開選單、焦點進選單、aria-expanded 變 true', focusInMenu === 'format-menu-item' && expandedBefore === 'false' && expandedOpen === 'true', 'format-menu-item／false→true', `${focusInMenu}／${expandedBefore}→${expandedOpen}`);
    await page.keyboard.press('Enter');
    await tid(page, 'format-step-kind').first().waitFor({ state: 'visible', timeout: 5000 });
    await page.keyboard.press('Enter');
    await tid(page, 'format-step-scope').first().waitFor({ state: 'visible', timeout: 5000 });
    await page.keyboard.press('Enter');
    await tid(page, 'format-step-confirm').first().waitFor({ state: 'visible', timeout: 5000 });
    check(scene, '只用鍵盤可走到確認步驟', true, '到達確認', '到達確認');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const back = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    check(scene, 'Esc 關閉視窗、正文不變、焦點回到原入口', !(await vis(tid(page, 'format-step-confirm'))) && (await body(page)) === originalOf('c1') && back === 'format-more-topbar', '關閉／不變／format-more-topbar', `${back}`);
    await context.close();
  }
  // 專注模式：不露出更多、Esc 仍離開
  {
    const { context, page } = await newCtx(browser, seed, 'wide');
    await openChapter(page, seed, 'c1');
    await tid(page, 'enter-focus-mode').first().click({ timeout: 8000 });
    await page.waitForTimeout(500);
    const focus = await page.evaluate(() => document.documentElement.dataset.focusMode === 'true');
    const anyVisible = (await vis(tid(page, 'format-more-topbar'))) || (await vis(tid(page, 'format-more-landscape')));
    check('專注', '專注模式中沒有「更多」入口', focus && !anyVisible, 'focus=true、入口不可見', `focus=${focus}、可見=${anyVisible}`);
    await shot(page, 'focus-mode-wide');
    await tid(page, 'writing-input').first().click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => document.documentElement.dataset.focusMode === 'true');
    check('專注', '真實 Esc 仍離開專注模式', !after, 'focus=false', `focus=${after}`);
    check('專注', '離開專注後入口回來', await vis(tid(page, 'format-more-topbar')), '可見', String(await vis(tid(page, 'format-more-topbar'))));
    await context.close();
  }
  // 手機直拿專注：沒有更多
  {
    const { context, page } = await newCtx(browser, seed, 'phone-portrait');
    await openChapter(page, seed, 'c1');
    const enter = tid(page, 'thumb-focus-button').first();
    if (await vis(enter)) {
      await enter.click();
      await page.waitForTimeout(500);
      const anyVisible = (await vis(tid(page, 'format-more-topbar'))) || (await vis(tid(page, 'format-more-landscape')));
      check('專注', '手機直拿專注模式沒有「更多」入口', !anyVisible, '不可見', String(anyVisible));
      await shot(page, 'focus-mode-phone-portrait');
    } else {
      rec('專注', '手機直拿專注模式沒有「更多」入口', 'pending', '可進入專注', '找不到拇指區專注鈕');
    }
    await context.close();
  }
}

/** 入口按鈕與頁首其他可見按鈕不重疊、不超出視窗。 */
async function buttonGeometry(page, scene) {
  return page.evaluate(() => {
    const ids = ['back-button', 'toggle-tree-topbar', 'search-open-topbar', 'enter-focus-mode', 'toggle-cards-topbar', 'format-more-topbar', 'toggle-tree-floating', 'search-open-landscape', 'toggle-cards-landscape', 'toggle-focus-landscape', 'format-more-landscape'];
    const out = [];
    for (const id of ids) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || style.display === 'none' || style.visibility === 'hidden') continue;
      out.push({ id, x: r.x, y: r.y, w: r.width, h: r.height });
    }
    return { out, vw: window.innerWidth, vh: window.innerHeight };
  });
}
function overlaps(a, b) {
  return a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
}

async function layoutScenes(browser, seed) {
  for (const key of ['phone-portrait', 'phone-landscape', 'medium', 'wide', 'phone-narrow', 'wide-1100']) {
    const scene = `版面-${key}`;
    const { context, page } = await newCtx(browser, seed, key);
    await openChapter(page, seed, 'c1');
    const expectedLayout = key === 'phone-narrow' ? 'phone-portrait' : key === 'wide-1100' ? 'wide' : key;
    const layout = await layoutOf(page);
    check(scene, `data-layout 真的進入 ${expectedLayout}`, layout === expectedLayout, expectedLayout, String(layout));
    const more = await moreButton(page);
    check(scene, '有可用的「更多」入口', Boolean(more), '可見', more ? '可見' : '找不到');
    const geo = await buttonGeometry(page, scene);
    const mine = geo.out.find((b) => b.id.startsWith('format-more'));
    if (mine) {
      check(scene, '入口完全在視窗內，點擊區至少 44×44', mine.x >= 0 && mine.y >= 0 && mine.x + mine.w <= geo.vw + 0.5 && mine.y + mine.h <= geo.vh + 0.5 && mine.w >= 43.5 && mine.h >= 43.5, '視窗內且 ≥44', `${Math.round(mine.x)},${Math.round(mine.y)} ${Math.round(mine.w)}×${Math.round(mine.h)} / ${geo.vw}×${geo.vh}`);
      const clash = geo.out.filter((b) => b.id !== mine.id && overlaps(b, mine)).map((b) => b.id);
      check(scene, '與其他可見按鈕（搜尋、專注、看卡片、目錄、返回）不重疊', clash.length === 0, '不重疊', clash.join(',') || '不重疊');
      const others = geo.out.filter((b) => !b.id.startsWith('format-more'));
      const pairClash = [];
      for (let i = 0; i < others.length; i += 1) for (let j = i + 1; j < others.length; j += 1) if (overlaps(others[i], others[j])) pairClash.push(`${others[i].id}×${others[j].id}`);
      check(scene, '原有按鈕彼此不重疊', pairClash.length === 0, '不重疊', pairClash.join(',') || '不重疊');
    }
    await shot(page, key === 'phone-narrow' ? 'phone-narrow-320' : key === 'wide-1100' ? 'wide-1100' : key);
    // 開選單、確認視窗不被遮住
    if (more) {
      await toConfirm(page, 'indent', 'chapter');
      const box = await tid(page, 'format-step-confirm').first().boundingBox();
      const vp = LAYOUTS[key].viewport;
      check(scene, '確認視窗完整在視窗內', Boolean(box) && box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width + 0.5 && box.y + box.height <= vp.height + 0.5, '視窗內', box ? `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}` : '無');
      await tid(page, 'format-start').first().scrollIntoViewIfNeeded().catch(() => {});
      check(scene, '「開始排版」可點', await tid(page, 'format-start').first().isEnabled(), '可點', 'enabled');
      await shot(page, `${key === 'phone-narrow' ? 'phone-narrow-320' : key}-confirm`);
      await tid(page, 'format-cancel').first().click();
    }
    // 版面專屬
    if (key === 'phone-landscape') await landscapeExtras(page, scene);
    if (key === 'medium') await mediumExtras(page, scene);
    if (key === 'wide' || key === 'wide-1100') {
      const visibleIds = (await buttonGeometry(page, scene)).out.map((b) => b.id);
      const needed = ['format-more-topbar', 'search-open-topbar', 'enter-focus-mode', 'toggle-cards-topbar'];
      check(scene, '頁首更多、搜尋、專注、看卡片同時可見可用', needed.every((id) => visibleIds.includes(id)), needed.join(','), visibleIds.join(','));
    }
    await context.close();
  }
}

async function landscapeExtras(page, scene) {
  // 一般狀態：浮動更多可點
  await openMenu(page);
  check(scene, '一般狀態：浮動「更多」可開選單', await vis(tid(page, 'format-menu')), '選單可見', String(await vis(tid(page, 'format-menu'))));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  // 打字：真實聚焦與輸入觸發 landscape-writing
  const input = tid(page, 'writing-input').first();
  await input.click();
  await page.keyboard.type('字');
  await page.waitForTimeout(600);
  const typing = await hasClass(page, 'landscape-writing');
  if (!typing) {
    rec(scene, '打字時進入 landscape-writing（頁首隱藏）', 'pending', 'html.landscape-writing', '桌面瀏覽器沒有觸發；請在真機或可模擬鍵盤的環境複驗');
  } else {
    const topbarVisible = await vis(page.locator('.editor .topbar'));
    check(scene, '打字時頁首隱藏（真實輸入觸發）', !topbarVisible, '頁首隱藏', String(topbarVisible));
    await shot(page, 'phone-landscape-writing');
    const more = tid(page, 'format-more-landscape').first();
    check(scene, '打字隱藏頁首時浮動「更多」仍可見', await vis(more), '可見', String(await vis(more)));
    await more.click({ timeout: 5000 }).catch(() => {});
    check(scene, '打字隱藏頁首時浮動「更多」可開選單', await vis(tid(page, 'format-menu')), '選單可見', String(await vis(tid(page, 'format-menu'))));
    await page.keyboard.press('Escape');
  }
  // 側欄開／關後入口回來
  const treeBtn = tid(page, 'toggle-tree-floating').first();
  if (await vis(treeBtn)) {
    await treeBtn.click();
    await page.waitForTimeout(400);
    const hiddenWhileOpen = !(await vis(tid(page, 'format-more-landscape')));
    await shot(page, 'phone-landscape-tree-open');
    const close = page.locator('.tree-close-button').first();
    if (await vis(close)) await close.click();
    await page.waitForTimeout(400);
    check(scene, '側欄開著時入口讓位、關掉後入口回來', hiddenWhileOpen && (await vis(tid(page, 'format-more-landscape'))), '開著隱藏、關後可見', `開著隱藏=${hiddenWhileOpen}、關後可見=${await vis(tid(page, 'format-more-landscape'))}`);
  } else {
    rec(scene, '側欄開／關後入口回來', 'pending', '可開側欄', '打字狀態下目錄浮動鈕不可見，未測');
  }
}

async function mediumExtras(page, scene) {
  const tree = tid(page, 'toggle-tree-topbar').first();
  for (const state of ['開', '關']) {
    if (state === '開' && (await vis(tree))) {
      await tree.click();
      await page.waitForTimeout(500);
    }
    const more = await moreButton(page);
    check(scene, `側欄${state}：入口可見`, Boolean(more), '可見', more ? '可見' : '找不到');
    if (more) {
      await toConfirm(page, 'indent', 'chapter');
      const box = await tid(page, 'format-step-confirm').first().boundingBox();
      check(scene, `側欄${state}：確認視窗不被遮住`, Boolean(box) && box.x >= 0 && box.x + box.width <= 768.5, '視窗內', box ? `${Math.round(box.x)}+${Math.round(box.width)}` : '無');
      await shot(page, `medium-tree-${state === '開' ? 'open' : 'closed'}-confirm`);
      await tid(page, 'format-cancel').first().click();
    }
    if (state === '開') {
      const close = page.locator('.tree-close-button').first();
      if (await vis(close)) await close.click();
      await page.waitForTimeout(400);
    }
  }
}

// ---------- 報告 ----------
function writeReport() {
  const failed = results.filter((r) => r.status === 'failed').length;
  const passed = results.filter((r) => r.status === 'passed').length;
  const pending = results.filter((r) => r.status === 'pending').length;
  const json = { work_order: 'WO-122', mode: MODE, base: BASE, generated_at: new Date().toISOString(), summary: { passed, failed, pending }, screenshots: shots, results };
  fs.writeFileSync(path.join(QA_DIR, `${MODE}-wo122-formatting-report.json`), JSON.stringify(json, null, 2));
  const lines = [
    `# WO-122 排版驗收結果（${MODE}）`,
    '',
    `- BASE：${BASE}`,
    `- 通過 ${passed}、失敗 ${failed}、待驗 ${pending}`,
    '- 限制：桌面瀏覽器模擬不能當作 iPhone／Android 真機檔案能力與真實軟鍵盤的證據；組字（IME）由單元測試與人工複驗，不在本腳本。',
    '',
    '| 場景 | 項目 | 狀態 | 預期 | 實際 |',
    '| --- | --- | --- | --- | --- |',
    ...results.map((r) => `| ${r.scene} | ${r.item} | ${{ passed: '通過', failed: '失敗', pending: '待驗', note: '備註' }[r.status]} | ${String(r.expected).replace(/\|/g, '／').replace(/\n/g, ' ')} | ${String(r.actual).replace(/\|/g, '／').replace(/\n/g, ' ')} |`),
    '',
    '## 截圖',
    ...shots.map((s) => `- ${s}`),
    '',
  ];
  fs.writeFileSync(path.join(QA_DIR, `${MODE}-wo122-formatting-report.md`), lines.join('\n'));
  console.log(`\n結果：通過 ${passed}、失敗 ${failed}、待驗 ${pending}；報告在 ${QA_DIR}`);
  return failed;
}

async function main() {
  let pw;
  try {
    pw = loadPlaywright();
  } catch (error) {
    rec('環境', '載入 Playwright', 'pending', '可載入', error.message);
    writeReport();
    console.error('缺 Playwright：本次全部待驗，不算通過。');
    process.exit(2);
  }
  const browser = await launch(pw);
  try {
    const seed = await seedBook(browser);
    await layoutScenes(browser, seed);
    await behaviourScenes(browser, seed);
    await flowScenes(browser, seed);
  } catch (error) {
    rec('腳本', '執行中斷', 'failed', '完整跑完', error.stack || error.message);
  } finally {
    await browser.close().catch(() => {});
  }
  const failed = writeReport();
  process.exit(failed > 0 ? 1 : 0);
}

main();
