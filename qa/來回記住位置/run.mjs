/**
 * WO-65：寫作 ↔ 資料集來回記住位置、卡片編輯中切走要留下字（四種版面、五組尺寸）。
 *
 * 全程只從畫面正常操作（點、打字、滾輪捲動、重新整理），不 force 點擊、不用 evaluate 改狀態或呼叫內部函式、
 * 不注入位置、草稿或偏好。evaluate 只用來「讀」：游標、選取、捲動位置、焦點與 localStorage 內容。
 * 只用本趟用介面新開、書名含【範例】的測試稿；每組尺寸各開新的瀏覽器環境，不碰真書稿或任何 .db。
 *
 * 每組尺寸：
 *   0 準備：開新稿 A、正文打長文、資料集「角色」建 16 張測試卡（內容夠長）＋1 張子卡片
 *   1 寫作打字、捲動、記下篇章／游標／捲動 → 資料集看卡片 → 回寫作：三者相同（鍵盤只記錄、待實機）
 *   2 資料集：收合子卡片、捲清單、開卡片、捲預覽 → 寫作 → 資料集：同卡片、同展開、各捲動相同
 *   3 卡片編輯中打字未按完成 → 寫作 → 資料集：仍在編輯、字還在；正式卡片（本機存的稿子）不含這些字
 *   4 編輯中按「返回」（寬版沒有返回鈕，改點別張再點回來）→ 再開同張：字還在且編輯中；按「完成」才寫回
 *   5 重新整理後仍記得位置與未完成編輯；換另一本【範例】書不串，再回原書仍接續
 *   寬版另做：右欄看卡片 ↔ 資料集雙向共用；手機橫拿另做：關閉左抽屜回寫作、再打開接續
 *
 * 環境變數：BASE、ENGINE、RUN_LABEL、SHOT_DIR、QA_DIR、LAYOUTS（逗號分隔 id，除錯用）、PLAYWRIGHT_MODULE、CHROMIUM_PATH。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumPath, loadPlaywright } from '../playwright-env.mjs';

const pw = loadPlaywright();
const BASE = (process.env.BASE || 'http://127.0.0.1:4173').replace(/\/$/, '');
const ENGINE = process.env.ENGINE === 'webkit' ? 'webkit' : 'chromium';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const QA_DIR = process.env.QA_DIR || path.join(REPO_ROOT, 'test-results', 'qa', '來回記住位置');
const RUN_LABEL = process.env.RUN_LABEL || 'WO-65';
const RUN_DIR = path.join(QA_DIR, RUN_LABEL);
const SHOT_DIR = process.env.SHOT_DIR || RUN_DIR;
fs.mkdirSync(RUN_DIR, { recursive: true });
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ALL = [
  { id: 'phone-portrait', name: '手機直拿', size: '390x844', viewport: { width: 390, height: 844 }, touch: true },
  { id: 'phone-landscape', name: '手機橫拿', size: '844x390', viewport: { width: 844, height: 390 }, touch: true },
  { id: 'medium', name: '中等', size: '900x900', viewport: { width: 900, height: 900 }, touch: true },
  { id: 'wide-1280', name: '寬版', size: '1280x900', viewport: { width: 1280, height: 900 }, touch: false, wide: true },
  { id: 'wide-1920', name: '寬版', size: '1920x900', viewport: { width: 1920, height: 900 }, touch: false, wide: true },
];
const only = (process.env.LAYOUTS || '').split(',').filter(Boolean);
const LAYOUTS = only.length ? ALL.filter((l) => only.includes(l.id)) : ALL;

const OUTLINE_KEY = 'jiufang-novel-m.outline.v1';
const NAV_PREFIX = 'jiufang-novel-m.nav-memory.v1:';
const CARD_COUNT = 16;
const MARK_STASH = '【WO65暫存】';
const MARK_BACK = '【WO65返回】';
const MARK_RELOAD = '【WO65重開】';
const MARK_ASIDE = '【WO65右欄】';
const longText = (label, lines) =>
  Array.from({ length: lines }, (_, i) => `${label}第${i + 1}行：【範例】測試內容，用來產生足夠的捲動高度。`).join('\n');

const results = [];
function rec(L, step, item, ok, actual) {
  results.push({ layout: L.name, size: L.size, step, item, status: ok ? 'passed' : 'failed', actual: String(actual) });
  console.log(`[${L.name} ${L.size}] ${ok ? '通過' : '失敗'} ${step} ${item} :: ${actual}`);
}
function note(L, step, item, actual) {
  results.push({ layout: L.name, size: L.size, step, item, status: 'manual', actual: String(actual) });
  console.log(`[${L.name} ${L.size}] 待實機 ${step} ${item} :: ${actual}`);
}
async function shot(page, L, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, `${L.name}-${L.size}-${name}.png`) }).catch(() => {});
}

const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const vis = (loc) => loc.first().isVisible().catch(() => false);
const act = async (L, loc) => {
  await loc.first().scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  return L.touch ? loc.first().tap({ timeout: 8000 }) : loc.first().click({ timeout: 8000 });
};
const wait = (page, ms = 400) => page.waitForTimeout(ms);
const near = (a, b, tol = 2) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol;
/**
 * 正文捲動比較：正文框寬度相同時只容許像素取整差；寬度不同（手機橫拿目錄抽屜開關造成換行不同）時，
 * 像素無法直接比，改比「捲到全文的哪個比例」，差 1% 以內，並在結果寫明。
 */
function sameScroll(a, b) {
  if (!a || !b) return { ok: false, desc: '讀不到正文' };
  if (a.width === b.width) return { ok: near(a.scrollTop, b.scrollTop), desc: `${a.scrollTop} → ${b.scrollTop}（寬 ${a.width}）` };
  const ra = a.max > 0 ? a.scrollTop / a.max : 0;
  const rb = b.max > 0 ? b.scrollTop / b.max : 0;
  return {
    ok: Math.abs(ra - rb) <= 0.01,
    desc: `寬度不同 ${a.width}→${b.width}，依比例 ${(ra * 100).toFixed(1)}% → ${(rb * 100).toFixed(1)}%（${a.scrollTop}/${a.max} → ${b.scrollTop}/${b.max}）`,
  };
}

/* ---------- 唯讀觀察 ---------- */
async function readWriting(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="writing-input"]');
    if (!el) return null;
    return {
      path: location.pathname,
      start: el.selectionStart,
      end: el.selectionEnd,
      scrollTop: Math.round(el.scrollTop),
      width: el.clientWidth,
      max: el.scrollHeight - el.clientHeight,
      focused: document.activeElement === el,
      length: el.value.length,
    };
  });
}
async function paneTop(page, role) {
  return page.evaluate((r) => {
    const el = document.querySelector(`[data-nav-pane="${r}"]`);
    if (!el) return null;
    // 卡片內容在部分版面由內層內容區捲動：取實際在捲的那一層
    const inner = el.querySelector('.card-editor-body');
    return Math.round(Math.max(el.scrollTop, inner ? inner.scrollTop : 0));
  }, role);
}
/** 指定範圍（右欄或資料集）裡某捲動區的實際捲動值（唯讀） */
async function paneTopIn(page, scope, role) {
  return page.evaluate(
    ([s, r]) => {
      const el = document.querySelector(`${s} [data-nav-pane="${r}"]`);
      if (!el) return null;
      const inner = el.querySelector('.card-editor-body');
      return Math.round(Math.max(el.scrollTop, inner ? inner.scrollTop : 0));
    },
    [scope, role],
  );
}
/** 指定範圍的卡片清單裡，完整看得到的一列卡片 id（避開 exclude，取中間那列；唯讀） */
async function visibleRowIn(page, scope, exclude = []) {
  return page.evaluate(
    ([s, ex]) => {
      const pane = document.querySelector(`${s} [data-nav-pane="list"]`);
      if (!pane) return null;
      const box = pane.getBoundingClientRect();
      const ids = [];
      for (const row of pane.querySelectorAll('[data-testid^="card-row-"]')) {
        const r = row.getBoundingClientRect();
        const id = row.getAttribute('data-testid').replace('card-row-', '');
        if (r.top >= box.top + 4 && r.bottom <= box.bottom - 4 && !ex.includes(id) && !row.textContent.includes('子卡片')) ids.push(id);
      }
      return ids.length ? ids[Math.floor(ids.length / 2)] : null;
    },
    [scope, exclude],
  );
}
/** 指定範圍裡測試卡01 的子卡片是展開還是收合（看子卡片列在不在、按鈕朗讀；唯讀） */
async function childStateIn(page, scope, parentId) {
  const label = (await page.locator(`${scope} [data-testid="card-toggle-${parentId}"]`).first().getAttribute('aria-label').catch(() => '')) || '';
  const childRows = await page.locator(`${scope} [data-testid^="card-row-"]`, { hasText: '測試卡01的子卡片' }).count();
  return { expanded: childRows > 0, label, childRows, desc: `${childRows > 0 ? '展開' : '收合'}（子卡片列 ${childRows}；按鈕「${label}」）` };
}
async function cardTitleIn(page, scope) {
  return ((await page.locator(`${scope} .card-detail-heading`).first().innerText().catch(() => '')) || '').trim();
}

async function readStorage(page, key) {
  return page.evaluate((k) => localStorage.getItem(k), key);
}
async function officialCardText(page, bookId) {
  const raw = await readStorage(page, OUTLINE_KEY);
  try {
    const projects = JSON.parse(raw || '[]');
    const book = projects.find((p) => p.id === bookId);
    return JSON.stringify(book?.cards ?? []);
  } catch {
    return '';
  }
}
const bookIdOf = (url) => (/\/p\/([^/]+)\//.exec(url) || [])[1] || '';

/* ---------- 導覽 ---------- */
async function navTo(page, L, tab) {
  const link = page.locator(`[data-testid="bottom-nav"] [data-testid="nav-${tab}"], [data-testid="nav-rail"] [data-testid="nav-${tab}"]`);
  const visible = async () => {
    const n = await link.count();
    for (let i = 0; i < n; i += 1) if (await link.nth(i).isVisible().catch(() => false)) return link.nth(i);
    return null;
  };
  let target = await visible();
  if (!target) {
    // 手機直拿在正文裡要先回目錄頁才看得到分頁；手機橫拿要先展開目錄抽屜
    for (const id of ['back-button', 'toggle-tree-floating']) {
      const b = tid(page, id).first();
      if (await vis(b)) {
        await act(L, b);
        await wait(page, 500);
        target = await visible();
        if (target) break;
      }
    }
  }
  if (!target) return false;
  await act(L, target);
  await wait(page, 700);
  return page.url().includes(`/${tab}`);
}

async function createBook(page, L, title) {
  await act(L, page.getByRole('button', { name: '開新稿子' }));
  await page.locator('form.dialog input').first().fill(title);
  await act(L, page.locator('form.dialog button[type="submit"]'));
  await page.waitForURL(/\/p\/[^/]+\/write/, { timeout: 15000 });
  await wait(page, 700);
}

async function goHome(page, L) {
  await navTo(page, L, 'files');
  await act(L, tid(page, 'close-project'));
  await page.waitForSelector('[data-testid="home-screen"]', { timeout: 10000 });
  await wait(page, 400);
}

/** 資料集：回到「角色」分類的卡片清單 */
async function toCharacterList(page, L) {
  for (let i = 0; i < 3; i += 1) {
    if (await vis(tid(page, 'category-card-list'))) break;
    if (await vis(tid(page, 'category-row-character'))) {
      await act(L, tid(page, 'category-row-character'));
      await wait(page);
      continue;
    }
    const back = page.locator('[data-testid="cards-screen"] button[aria-label="返回卡片清單"], [data-testid="cards-screen"] button[aria-label="返回分類清單"]');
    if (await vis(back)) {
      await act(L, back);
      await wait(page);
    } else break;
  }
  return vis(tid(page, 'category-card-list'));
}

async function startEdit(page, L) {
  for (const id of ['card-editor-start-edit-btn', 'card-editor-start-edit-btn-footer']) {
    const b = page.locator(`[data-testid="cards-screen"] [data-testid="${id}"]`);
    if (await vis(b)) {
      await act(L, b);
      await wait(page);
      return true;
    }
  }
  return false;
}

async function addCard(page, L, title, content) {
  await toCharacterList(page, L);
  const add = page.locator('[data-testid="cards-screen"] [data-testid="add-card-btn"], [data-testid="cards-screen"] [data-testid="add-card-btn-empty"]');
  await act(L, add);
  await wait(page, 400);
  await startEdit(page, L);
  await tid(page, 'card-editor-title-input').first().fill(title);
  await tid(page, 'card-editor-content-textarea').first().fill(content);
  await act(L, tid(page, 'card-editor-done-btn'));
  await wait(page, 300);
}

async function cardIdByTitle(page, title) {
  return page.evaluate((t) => {
    for (const row of document.querySelectorAll('[data-testid^="card-row-"]')) {
      if (row.textContent.includes(t)) return row.getAttribute('data-testid').replace('card-row-', '');
    }
    return null;
  }, title);
}

async function wheelOver(page, loc, dy) {
  const box = await loc.first().boundingBox();
  if (!box) return false;
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 120));
  await page.mouse.wheel(0, dy);
  await wait(page, 500);
  return true;
}

async function typeAtEnd(page, loc, text) {
  await loc.first().focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(text);
  await wait(page, 200);
}

async function editModeText(page) {
  const mode = await page.locator('[data-testid="cards-screen"] [data-testid="card-editor-pane"]').first().getAttribute('data-mode').catch(() => null);
  const content = await page.locator('[data-testid="cards-screen"] [data-testid="card-editor-content-textarea"]').first().inputValue().catch(() => '');
  return { mode, content };
}

/* ---------- 每組尺寸 ---------- */
async function runLayout(L) {
  const engine = ENGINE === 'webkit' && !L.wide ? pw.webkit : pw.chromium;
  const opts = { headless: true, args: ENGINE === 'webkit' && !L.wide ? [] : ['--no-sandbox', '--disable-setuid-sandbox'] };
  const exe = chromiumPath();
  const browser = await engine.launch(engine === pw.chromium && exe && fs.existsSync(exe) ? { ...opts, executablePath: exe } : opts);
  const ctxOpts = { viewport: L.viewport, locale: 'zh-TW', timezoneId: 'Asia/Taipei' };
  if (L.touch) {
    ctxOpts.hasTouch = true;
    ctxOpts.isMobile = true;
  }
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  const BOOK_A = `【範例】來回測試甲-${L.name}${L.size}-${RUN_LABEL}`;
  const BOOK_B = `【範例】來回測試乙-${L.name}${L.size}-${RUN_LABEL}`;
  const portraitLike = !L.wide; // 清單與卡片內容不同時顯示（直拿、橫拿、中等）
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="home-screen"]', { timeout: 20000 });

    // ── 0 準備 ──
    await createBook(page, L, BOOK_A);
    const bookA = bookIdOf(page.url());
    const chapterPath = new URL(page.url()).pathname;
    const input = tid(page, 'writing-input').first();
    await input.fill(longText('正文', 160));
    await wait(page, 300);
    rec(L, '0-1', '開新稿 A 並進第一章、打好長正文', /\/write\/.+/.test(chapterPath), chapterPath);

    await navTo(page, L, 'cards');
    for (let i = 1; i <= CARD_COUNT; i += 1) {
      await addCard(page, L, `【範例】測試卡${String(i).padStart(2, '0')}`, longText(`卡${i}`, 40));
    }
    await toCharacterList(page, L);
    const card01 = await cardIdByTitle(page, '【範例】測試卡01');
    // 為測試卡01 加一張子卡片
    await act(L, tid(page, `card-select-${card01}`));
    await wait(page);
    await act(L, page.locator('[data-testid="cards-screen"] [data-testid="card-editor-more-btn"]'));
    await act(L, tid(page, 'card-menu-add-subcard-btn'));
    await wait(page);
    await startEdit(page, L);
    await tid(page, 'card-editor-title-input').first().fill('【範例】測試卡01的子卡片');
    await act(L, tid(page, 'card-editor-done-btn'));
    await wait(page);
    await toCharacterList(page, L);
    const rows = await page.locator('[data-testid^="card-row-"]').count();
    rec(L, '0-2', `資料集「角色」建好 ${CARD_COUNT} 張測試卡與 1 張子卡片`, rows === CARD_COUNT + 1, `清單列數 ${rows}`);

    // ── 1 寫作 → 資料集 → 寫作 ──
    await navTo(page, L, 'write');
    if (!page.url().includes('/write/')) {
      // 新稿第一次從資料集回寫作：記憶裡就是剛剛那一章
      rec(L, '1-0', '從資料集按「寫作」回到原本那一章', false, page.url());
    }
    await input.waitFor({ state: 'visible', timeout: 8000 });
    await wheelOver(page, input, 1500);
    const tb = await input.boundingBox();
    await (L.touch ? input.tap({ position: { x: Math.min(120, tb.width / 3), y: tb.height * 0.4 } }) : input.click({ position: { x: Math.min(120, tb.width / 3), y: tb.height * 0.4 } }));
    await page.keyboard.insertText('【WO65定位】');
    await wait(page, 400);
    const before1 = await readWriting(page);
    rec(L, '1-1', '寫作頁已捲動（非零）並放好游標', before1 && before1.scrollTop > 0 && before1.start > 0, JSON.stringify(before1));
    await navTo(page, L, 'cards');
    await toCharacterList(page, L);
    await act(L, tid(page, `card-select-${card01}`));
    await wait(page);
    await navTo(page, L, 'write');
    await input.waitFor({ state: 'visible', timeout: 8000 });
    await wait(page, 300);
    const after1 = await readWriting(page);
    rec(L, '1-2', '回寫作：同一篇', after1?.path === before1?.path, `${before1?.path} → ${after1?.path}`);
    rec(L, '1-3', '回寫作：同一個字（游標／選取）', after1?.start === before1?.start && after1?.end === before1?.end, `${before1?.start}-${before1?.end} → ${after1?.start}-${after1?.end}`);
    const s14 = sameScroll(before1, after1);
    rec(L, '1-4', '回寫作：同一捲動位置', s14.ok, s14.desc);
    note(L, '1-5', '鍵盤照離開前狀態（瀏覽器只記錄焦點，iPhone 鍵盤待實機）', `離開前焦點 ${before1?.focused}、回來焦點 ${after1?.focused}`);
    await shot(page, L, '1-寫作來回-同篇同字同捲動');

    // ── 2 資料集 → 寫作 → 資料集 ──
    await navTo(page, L, 'cards');
    await toCharacterList(page, L);
    await act(L, tid(page, `card-toggle-${card01}`)); // 收合子卡片
    await wait(page);
    const listPane = page.locator('[data-nav-pane="list"]');
    await wheelOver(page, listPane, 450);
    const listBefore = await paneTop(page, 'list');
    // 選一張捲動後看得到的卡片
    const pickId = await page.evaluate(() => {
      const pane = document.querySelector('[data-nav-pane="list"]');
      const box = pane.getBoundingClientRect();
      for (const row of pane.querySelectorAll('[data-testid^="card-row-"]')) {
        const r = row.getBoundingClientRect();
        if (r.top >= box.top + 4 && r.bottom <= box.bottom - 4) return row.getAttribute('data-testid').replace('card-row-', '');
      }
      return null;
    });
    await act(L, tid(page, `card-select-${pickId}`));
    await wait(page);
    // 卡片內容實際在捲的那一層（部分版面是內層內容區）
    const previewPane = (await page.locator('[data-nav-pane="preview"] .card-editor-body').count())
      ? page.locator('[data-nav-pane="preview"] .card-editor-body')
      : page.locator('[data-nav-pane="preview"]');
    await wheelOver(page, previewPane, 600);
    const previewBefore = await paneTop(page, 'preview');
    const titleBefore = await page.locator('[data-testid="cards-screen"] .card-detail-heading').first().innerText().catch(() => '');
    rec(L, '2-1', '清單與卡片內容都已捲動（非零）', listBefore > 0 && previewBefore > 0, `清單 ${listBefore}、內容 ${previewBefore}、卡片 ${titleBefore}`);
    await navTo(page, L, 'write');
    await navTo(page, L, 'cards');
    await wait(page, 300);
    const titleAfter = await page.locator('[data-testid="cards-screen"] .card-detail-heading').first().innerText().catch(() => '');
    const previewAfter = await paneTop(page, 'preview');
    rec(L, '2-2', '回資料集：同一張卡片', titleAfter === titleBefore && !!titleAfter, `${titleBefore} → ${titleAfter}`);
    rec(L, '2-3', '回資料集：卡片內容捲動相同', near(previewAfter, previewBefore), `${previewBefore} → ${previewAfter}`);
    let listAfter;
    if (portraitLike) {
      await shot(page, L, '2-資料集來回-同卡片同捲動');
      await act(L, page.locator('[data-testid="cards-screen"] button[aria-label="返回卡片清單"]'));
      await wait(page);
      listAfter = await paneTop(page, 'list');
    } else {
      listAfter = await paneTop(page, 'list');
      await shot(page, L, '2-資料集來回-同卡片同捲動同展開');
    }
    rec(L, '2-4', '回資料集：卡片清單捲動相同', near(listAfter, listBefore), `${listBefore} → ${listAfter}`);
    const collapsed = (await tid(page, `card-toggle-${card01}`).first().getAttribute('aria-label').catch(() => '')) || '';
    const childShown = await page.locator('[data-testid^="card-row-"]', { hasText: '測試卡01的子卡片' }).count();
    rec(L, '2-5', '回資料集：子卡片展開狀態相同（仍收合）', collapsed.includes('展開') && childShown === 0, `${collapsed}；子卡片列 ${childShown}`);
    const memRaw = await readStorage(page, `${NAV_PREFIX}${bookA}`);
    rec(L, '2-6', '記憶存在這個裝置的 localStorage（每本書一個鍵、有版本號）', !!memRaw && JSON.parse(memRaw).version === 1, `${NAV_PREFIX}${bookA}`);

    // 返工 1：同一分類連續開卡片、按「返回」兩次，清單都回到原位置（清單每次重新建立）
    if (portraitLike) {
      const listStart = await paneTop(page, 'list');
      const seen = [];
      let used = [pickId];
      for (let i = 0; i < 2; i += 1) {
        // 手機橫拿抽屜清單較矮，完整看得到的列不多：沒有沒開過的就再開一次看得到的那張
        const id =
          (await visibleRowIn(page, '[data-testid="cards-screen"]', used)) ??
          (await visibleRowIn(page, '[data-testid="cards-screen"]', [pickId]));
        used = [...used, id];
        await act(L, tid(page, `card-select-${id}`));
        await wait(page);
        await act(L, page.locator('[data-testid="cards-screen"] button[aria-label="返回卡片清單"]'));
        await wait(page);
        seen.push(await paneTop(page, 'list'));
      }
      rec(L, '2-7', '同一分類連續開卡片、按「返回」兩次：清單都回到原位置', listStart > 0 && seen.every((v) => near(v, listStart)), `${listStart} → ${seen.join('、')}`);
    }

    // ── 3 編輯中切走 ──
    if (portraitLike) {
      await act(L, tid(page, `card-select-${pickId}`));
      await wait(page);
    }
    await startEdit(page, L);
    await typeAtEnd(page, tid(page, 'card-editor-content-textarea'), MARK_STASH);
    const officialDuring = await officialCardText(page, bookA);
    await navTo(page, L, 'write');
    await navTo(page, L, 'cards');
    await wait(page, 300);
    const e3 = await editModeText(page);
    rec(L, '3-1', '切走再回來：仍在編輯畫面', e3.mode === 'edit', e3.mode);
    rec(L, '3-2', '切走再回來：剛打的字還在', e3.content.includes(MARK_STASH), e3.content.slice(-30));
    const official3 = await officialCardText(page, bookA);
    rec(L, '3-3', '未按完成：本機存的正式卡片不含暫存字（切走前後皆是）', !officialDuring.includes(MARK_STASH) && !official3.includes(MARK_STASH), '正式卡片未含');
    const mem3 = (await readStorage(page, `${NAV_PREFIX}${bookA}`)) || '';
    rec(L, '3-4', '暫存字只在這本書的記憶裡（以卡片 id 分開）', mem3.includes(MARK_STASH) && mem3.includes(`"${pickId}"`), pickId);
    await shot(page, L, '3-編輯中切走回來-字還在');

    // ── 4 編輯中按「返回」→ 再開同張 ──
    await typeAtEnd(page, tid(page, 'card-editor-content-textarea'), MARK_BACK);
    if (portraitLike) {
      await act(L, page.locator('[data-testid="cards-screen"] button[aria-label="返回卡片清單"]'));
      await wait(page);
      rec(L, '4-0', '按「返回」離開編輯畫面回清單', await vis(tid(page, 'category-card-list')), '');
    } else {
      // 寬版沒有返回鈕：改點另一張再點回來
      await act(L, tid(page, `card-select-${card01}`));
      await wait(page);
      const other = await editModeText(page);
      rec(L, '4-0', '先看另一張：另一張是預覽、沒有被套上暫存字', other.mode === 'preview' && !(await page.locator('[data-testid="cards-screen"]').innerText()).includes(MARK_BACK), other.mode);
    }
    await act(L, tid(page, `card-select-${pickId}`));
    await wait(page);
    const e4 = await editModeText(page);
    rec(L, '4-1', '再打開同張：仍在編輯、返回前的字都在', e4.mode === 'edit' && e4.content.includes(MARK_STASH) && e4.content.includes(MARK_BACK), `${e4.mode}；${e4.content.slice(-24)}`);
    rec(L, '4-2', '按「返回」沒有偷偷當完成', !(await officialCardText(page, bookA)).includes(MARK_BACK), '正式卡片未含');
    await shot(page, L, '4-返回再開-字還在');
    await act(L, tid(page, 'card-editor-done-btn'));
    await wait(page, 500);
    const officialDone = await officialCardText(page, bookA);
    const memDone = (await readStorage(page, `${NAV_PREFIX}${bookA}`)) || '';
    const hint = ((await tid(page, 'card-editor-saved-hint').first().innerText().catch(() => '')) || '').trim();
    rec(L, '4-3', '按「完成」才寫回這張卡片，並清掉暫存', officialDone.includes(MARK_BACK) && !memDone.includes(MARK_BACK), hint || '（無提示）');

    // ── 5 重新整理、換書 ──
    await startEdit(page, L);
    await typeAtEnd(page, tid(page, 'card-editor-content-textarea'), MARK_RELOAD);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await tid(page, 'cards-screen').first().waitFor({ state: 'visible', timeout: 15000 });
    await wait(page, 600);
    const e5 = await editModeText(page);
    rec(L, '5-1', '重新整理後：資料集仍是同張卡片且在編輯中、未完成的字還在', e5.mode === 'edit' && e5.content.includes(MARK_RELOAD), `${e5.mode}；${e5.content.slice(-16)}`);
    await shot(page, L, '5-重新整理後-仍在編輯');
    await navTo(page, L, 'write');
    await input.waitFor({ state: 'visible', timeout: 8000 });
    await wait(page, 300);
    const after5 = await readWriting(page);
    const s52 = sameScroll(before1, after5);
    rec(L, '5-2', '重新整理後：回寫作同篇、同字、同捲動', after5?.path === before1.path && after5?.start === before1.start && s52.ok, `${after5?.path} 游標 ${after5?.start}；${s52.desc}`);

    await goHome(page, L);
    await createBook(page, L, BOOK_B);
    const bookB = bookIdOf(page.url());
    const bodyB = await tid(page, 'writing-input').first().inputValue();
    await navTo(page, L, 'cards');
    await wait(page, 300);
    const textB = await page.locator('[data-testid="cards-screen"]').first().innerText();
    rec(L, '5-3', '換另一本【範例】書：資料集不顯示前一本的卡片或暫存字', !textB.includes('測試卡') && !textB.includes(MARK_RELOAD) && !bodyB.includes('WO65定位'), `書 ${bookB}`);
    await goHome(page, L);
    await act(L, page.locator('a.project-main', { hasText: BOOK_A }));
    await page.waitForURL(/\/write\//, { timeout: 10000 });
    await wait(page, 500);
    const back5 = await readWriting(page);
    const s54 = sameScroll(before1, back5);
    rec(L, '5-4', '回原書：寫作接續同字同捲動', back5?.start === before1.start && s54.ok, `游標 ${back5?.start}；${s54.desc}`);
    await navTo(page, L, 'cards');
    await wait(page, 300);
    const e6 = await editModeText(page);
    rec(L, '5-5', '回原書：資料集接續同張卡片的未完成編輯', e6.mode === 'edit' && e6.content.includes(MARK_RELOAD), e6.mode);
    await shot(page, L, '5-換書再回原書-接續');

    // ── 寬版：右欄看卡片與資料集共用 ──
    if (L.wide) {
      await navTo(page, L, 'write');
      await input.waitFor({ state: 'visible', timeout: 8000 });
      let aside = tid(page, 'write-aside').locator('[data-testid="writing-cards-drawer"]');
      if (await vis(aside)) {
        // 右欄回寫作時原本就開著（W36 依寬度自動打開）：先回正文，只提示有未完成的修改
        const notice = await vis(tid(page, 'card-draft-kept-notice'));
        const writable = (await input.getAttribute('readonly')) === null;
        rec(L, 'W-0', '右欄原本就開著：正文可寫、右欄提示有未完成的修改（不搶鍵盤）', notice && writable, `提示 ${notice}、正文可寫 ${writable}`);
        await act(L, tid(page, 'toggle-cards-topbar'));
        await wait(page, 400);
      }
      await act(L, tid(page, 'toggle-cards-topbar'));
      await wait(page, 500);
      aside = tid(page, 'write-aside').locator('[data-testid="writing-cards-drawer"]');
      const asideText = await aside.first().innerText().catch(() => '');
      // 使用者自己打開右欄：同一張卡片、接續編輯
      const asideEditing = (await aside.first().getAttribute('data-card-editing').catch(() => null)) === 'true';
      const asideContent = await aside.locator('[data-testid="card-editor-content-textarea"]').first().inputValue().catch(() => '');
      rec(L, 'W-1', '右欄看卡片讀同一份記憶：同一張卡片且接續編輯中的字', asideEditing && asideContent.includes(MARK_RELOAD), asideText.replace(/\s+/g, ' ').slice(0, 40));
      await act(L, aside.locator('[data-testid="card-editor-done-btn"]'));
      await wait(page, 500);
      // 右欄改看另一張（測試卡01）
      await act(L, aside.locator('button[aria-label="返回卡片清單"]'));
      await wait(page, 400);
      await act(L, aside.locator(`[data-testid="card-select-${card01}"]`));
      await wait(page, 400);
      await shot(page, L, '6-右欄看卡片-改看另一張');
      await navTo(page, L, 'cards');
      const dsTitle = await page.locator('[data-testid="cards-screen"] .card-detail-heading').first().innerText().catch(() => '');
      rec(L, 'W-2', '右欄看的卡片 → 資料集打開也是那張', dsTitle.includes('測試卡01'), dsTitle);
      await startEdit(page, L);
      await typeAtEnd(page, tid(page, 'card-editor-content-textarea'), MARK_ASIDE);
      await navTo(page, L, 'write');
      await input.waitFor({ state: 'visible', timeout: 8000 });
      await wait(page, 400);
      const keptNotice = await vis(tid(page, 'card-draft-kept-notice'));
      const bodyWritable = (await input.getAttribute('readonly')) === null;
      rec(L, 'W-3', '回寫作時右欄原本開著：正文可寫、右欄提示有未完成的修改', keptNotice && bodyWritable, `提示 ${keptNotice}、正文可寫 ${bodyWritable}`);
      await act(L, tid(page, 'toggle-cards-topbar'));
      await wait(page, 400);
      await act(L, tid(page, 'toggle-cards-topbar'));
      await wait(page, 500);
      const aside2 = tid(page, 'write-aside').locator('[data-testid="writing-cards-drawer"]');
      const resumed = await aside2.locator('[data-testid="card-editor-content-textarea"]').first().inputValue().catch(() => '');
      rec(L, 'W-4', '收起再打開右欄：資料集打的未完成字在右欄接續編輯', resumed.includes(MARK_ASIDE), resumed.slice(-16));
      rec(L, 'W-5', '右欄收起不當作完成：正式卡片不含右欄暫存字', !(await officialCardText(page, bookA)).includes(MARK_ASIDE), '正式卡片未含');
      await shot(page, L, '6-右欄與資料集共用-接續編輯');

      // ── 寬版雙向：展開狀態、清單捲動、卡片內容捲動（返工 1 補） ──
      const ASIDE = '[data-testid="write-aside"] [data-testid="writing-cards-drawer"]';
      const DS = '[data-testid="cards-screen"]';
      // 先按「完成」結束右欄的編輯，再回右欄的卡片清單
      await act(L, aside2.locator('[data-testid="card-editor-done-btn"]'));
      await wait(page, 500);
      await act(L, aside2.locator('button[aria-label="返回卡片清單"]'));
      await wait(page, 500);
      // 方向一：右欄 → 資料集
      const a0 = await childStateIn(page, ASIDE, card01);
      await act(L, aside2.locator(`[data-testid="card-toggle-${card01}"]`));
      await wait(page, 400);
      const a1 = await childStateIn(page, ASIDE, card01);
      await wheelOver(page, aside2.locator('[data-nav-pane="list"]'), 260);
      const aList = await paneTopIn(page, ASIDE, 'list');
      const aPick = await visibleRowIn(page, ASIDE, [card01, pickId]);
      await act(L, aside2.locator(`[data-testid="card-select-${aPick}"]`));
      await wait(page, 500);
      await wheelOver(page, aside2.locator('[data-nav-pane="preview"]'), 400);
      const aPreview = await paneTopIn(page, ASIDE, 'preview');
      const aTitle = await cardTitleIn(page, ASIDE);
      rec(
        L,
        'W-6',
        '右欄：改了子卡片展開、清單與卡片內容都已捲動（非零）',
        a0.expanded !== a1.expanded && aList > 0 && aPreview > 0 && !!aTitle,
        `展開 ${a0.desc} → ${a1.desc}；清單 ${aList}；卡片 ${aTitle}、內容 ${aPreview}`,
      );
      await shot(page, L, '7-右欄-展開與捲動後');
      await navTo(page, L, 'cards');
      await wait(page, 400);
      const dTitle = await cardTitleIn(page, DS);
      const dPreview = await paneTopIn(page, DS, 'preview');
      const dList = await paneTopIn(page, DS, 'list');
      const d1 = await childStateIn(page, DS, card01);
      rec(L, 'W-7a', '右欄 → 資料集：同一張卡片', dTitle === aTitle && !!dTitle, `${aTitle} → ${dTitle}`);
      rec(L, 'W-7b', '右欄 → 資料集：子卡片展開狀態相同', d1.expanded === a1.expanded, `${a1.desc} → ${d1.desc}`);
      rec(L, 'W-7c', '右欄 → 資料集：卡片清單捲動相同', near(dList, aList), `${aList} → ${dList}`);
      rec(L, 'W-7d', '右欄 → 資料集：卡片內容捲動相同', near(dPreview, aPreview), `${aPreview} → ${dPreview}`);
      await shot(page, L, '7-右欄到資料集-同卡片同展開同捲動');

      // 方向二：資料集 → 右欄（改回展開狀態、換一張卡片、捲到不同位置）
      await act(L, page.locator(`${DS} [data-testid="card-toggle-${card01}"]`));
      await wait(page, 400);
      const d2 = await childStateIn(page, DS, card01);
      await wheelOver(page, page.locator(`${DS} [data-nav-pane="list"]`), 180);
      const dList2 = await paneTopIn(page, DS, 'list');
      const dPick = await visibleRowIn(page, DS, [card01, pickId, aPick]);
      await act(L, page.locator(`${DS} [data-testid="card-select-${dPick}"]`));
      await wait(page, 500);
      const dListAfterPick = await paneTopIn(page, DS, 'list');
      await wheelOver(page, page.locator(`${DS} [data-nav-pane="preview"]`), 250);
      const dPreview2 = await paneTopIn(page, DS, 'preview');
      const dTitle2 = await cardTitleIn(page, DS);
      rec(
        L,
        'W-8',
        '資料集：改了子卡片展開、換一張卡片，清單與卡片內容都已捲動（非零）',
        d2.expanded !== d1.expanded && dList2 > 0 && near(dListAfterPick, dList2) && dPreview2 > 0 && dTitle2 !== aTitle,
        `展開 ${d1.desc} → ${d2.desc}；清單 ${dList2}（點卡片後 ${dListAfterPick}）；卡片 ${dTitle2}、內容 ${dPreview2}`,
      );
      await shot(page, L, '7-資料集-展開與捲動後');
      await navTo(page, L, 'write');
      await input.waitFor({ state: 'visible', timeout: 8000 });
      await wait(page, 400);
      let aside3 = page.locator(ASIDE);
      if (!(await vis(aside3))) {
        await act(L, tid(page, 'toggle-cards-topbar'));
        await wait(page, 500);
        aside3 = page.locator(ASIDE);
      }
      const bTitle = await cardTitleIn(page, ASIDE);
      const bPreview = await paneTopIn(page, ASIDE, 'preview');
      await shot(page, L, '7-資料集到右欄-同卡片同捲動');
      // 右欄一次只顯示卡片或清單：按「返回卡片清單」看清單（清單重新建立）
      await act(L, aside3.locator('button[aria-label="返回卡片清單"]'));
      await wait(page, 500);
      const bList = await paneTopIn(page, ASIDE, 'list');
      const b2 = await childStateIn(page, ASIDE, card01);
      rec(L, 'W-9a', '資料集 → 右欄：同一張卡片', bTitle === dTitle2 && !!bTitle, `${dTitle2} → ${bTitle}`);
      rec(L, 'W-9b', '資料集 → 右欄：卡片內容捲動相同', near(bPreview, dPreview2), `${dPreview2} → ${bPreview}`);
      rec(L, 'W-9c', '資料集 → 右欄：返回清單後卡片清單捲動相同', near(bList, dList2), `${dList2} → ${bList}`);
      rec(L, 'W-9d', '資料集 → 右欄：子卡片展開狀態相同', b2.expanded === d2.expanded, `${d2.desc} → ${b2.desc}`);
      await shot(page, L, '7-資料集到右欄-同清單同展開');
    }

    // ── 手機橫拿：資料集左抽屜收起即回寫作 ──
    if (L.id === 'phone-landscape') {
      await navTo(page, L, 'cards');
      const drawer = await vis(tid(page, 'cards-drawer'));
      const close = page.locator('[data-testid="cards-drawer"] [data-testid="close-cards-drawer"]');
      let closed = false;
      if (await vis(close)) {
        await act(L, close);
        closed = true;
      } else {
        // 編輯中抽屜頂端沒有關閉鈕：先按返回再關
        await act(L, page.locator('[data-testid="cards-screen"] button[aria-label="返回卡片清單"]'));
        await wait(page);
        await act(L, close);
        closed = true;
      }
      await wait(page, 600);
      const w = await readWriting(page);
      const sh1 = sameScroll(before1, w);
      rec(L, 'H-1', '資料集是左側抽屜；關閉抽屜即回寫作原篇同字同捲動', drawer && closed && w?.path === before1.path && w?.start === before1.start && sh1.ok, `${w?.path} 游標 ${w?.start}；${sh1.desc}`);
      await navTo(page, L, 'cards');
      await wait(page, 300);
      const e7 = await editModeText(page);
      const t7 = await page.locator('[data-testid="cards-screen"] .card-detail-heading, [data-testid="cards-screen"] [data-testid="card-editor-title-input"]').first().textContent().catch(() => '');
      rec(L, 'H-2', '再打開抽屜：接續同張卡片與未完成編輯', e7.mode === 'edit' && e7.content.includes(MARK_RELOAD), `${e7.mode} ${t7}`);
      await shot(page, L, '6-左抽屜收起再開-接續');
    }
  } catch (err) {
    rec(L, 'ERR', '執行中斷', false, err.message.split('\n')[0]);
    await shot(page, L, 'ERR-中斷');
  } finally {
    await browser.close();
  }
}

for (const L of LAYOUTS) await runLayout(L);

const failed = results.filter((r) => r.status === 'failed');
const passed = results.filter((r) => r.status === 'passed');
const manual = results.filter((r) => r.status === 'manual');
const summary = { runLabel: RUN_LABEL, base: BASE, engine: ENGINE, total: results.length, passed: passed.length, failed: failed.length, manual: manual.length, results };
fs.writeFileSync(path.join(RUN_DIR, 'results.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(SHOT_DIR, `檢查結果-${RUN_LABEL}.json`), JSON.stringify(summary, null, 2));
console.log(`\n共 ${results.length} 項：通過 ${passed.length}、失敗 ${failed.length}、待實機 ${manual.length}`);
process.exit(failed.length ? 1 : 0);
