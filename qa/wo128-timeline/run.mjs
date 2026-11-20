/**
 * WO-128「事件時間線」第 8 段：四種版面 × 三套主題真實瀏覽器量測（不屬於 npm test，由召集人於沙盒外執行）。
 *
 * 做法：
 *  - 只在瀏覽器中透過 App 介面「開新稿子」並以程式寫入《霧港旅館》範例（5 章、7 事件，不讀寫任何 .db 檔）。
 *  - 所有點擊、拖曳、輸入、刪章刪卷與主題切換皆採真實 Playwright 互動，不使用 force、不用 evaluate 硬點，
 *    也絕不「找不到就算過」；任何斷言失敗或必要元素缺失均以非 0 結束碼結束。
 *  - 量測結果 JSON 與截圖輸出至 qa/wo128-timeline/out/。
 *
 * 環境變數：
 *   BASE               測試網址，預設 http://127.0.0.1:4173
 *   OUT_DIR            產出目錄，預設 qa/wo128-timeline/out
 *   HEADLESS           1（預設）或 0（有頭）
 *   PLAYWRIGHT_MODULE  本機 playwright 套件路徑（沿用 qa/playwright-env.mjs）
 *   CHROMIUM_PATH / PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH  選用 Chromium 執行檔
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumPath, loadPlaywright } from '../playwright-env.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || 'http://127.0.0.1:4173').replace(/\/$/, '');
const OUT_DIR = process.env.OUT_DIR || path.join(HERE, 'out');
const HEADLESS = process.env.HEADLESS !== '0';

fs.mkdirSync(OUT_DIR, { recursive: true });

const OUTLINE_KEY = 'jiufang-novel-m.outline.v1';
const ONBOARDING_KEY = 'jiufang-novel-m.onboarding.v1';
const THEME_KEY = 'jiufang-novel-m.theme.v1';
const INPUT_MODE_KEY = 'jiufang-novel-m.input-mode.v1';
const DEVICE_KIND_KEY = 'jiufang-novel-m.device-kind.v1';

const VIEWPORTS = [
  { key: 'phone-portrait', expectedLayout: 'phone-portrait', width: 390, height: 844, touch: true },
  { key: 'phone-landscape', expectedLayout: 'phone-landscape', width: 844, height: 390, touch: true },
  { key: 'medium', expectedLayout: 'medium', width: 820, height: 1180, touch: true },
  { key: 'wide-1180', expectedLayout: 'wide', width: 1180, height: 820, touch: true },
  { key: 'wide-1440', expectedLayout: 'wide', width: 1440, height: 900, touch: false },
];

const THEMES = ['forest', 'celadon', 'classic'];
/** 與 src/copy/userFacing.ts 的 BACK_TO_CATEGORIES_ARIA / BACK_TO_CARDS_ARIA 一致 */
const BACK_TO_CATEGORIES_ARIA = '返回分類清單';
const BACK_TO_CARDS_ARIA = '返回卡片清單';

const results = [];
const screenshots = [];

function record(section, item, passed, expected, actual, extra = {}) {
  results.push({
    section,
    item,
    status: passed ? 'passed' : 'failed',
    expected: String(expected),
    actual: String(actual),
    ...extra,
  });
  const tag = passed ? '通過' : '失敗';
  console.log(`${tag} [${section}] ${item} :: 預期 ${expected} / 實際 ${actual}`);
}

async function capture(page, name) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  screenshots.push(file);
  return file;
}

function createFogHotelChapters(withVolume = false) {
  const ch1 = { id: 'ch-1', type: 'file', title: '第一章　清晨的書房', progress: 'Draft', content: '霧港清晨書房正文。', expanded: true };
  const ch2 = { id: 'ch-2', type: 'file', title: '第二章　偵探上岸', progress: 'Draft', content: '偵探林曉霧上岸正文。', expanded: true };
  const ch3 = { id: 'ch-3', type: 'file', title: '第三章　十年前的火', progress: 'Draft', content: '十年前舊館大火正文。', expanded: true };
  const ch4 = { id: 'ch-4', type: 'file', title: '第四章　每個人都在別處', progress: 'Draft', content: '不在場證明正文。', expanded: true };
  const ch5 = { id: 'ch-5', type: 'file', title: '第五章　霧散', progress: 'Draft', content: '真相揭曉正文。', expanded: true };
  if (!withVolume) {
    return [ch1, ch2, ch3, ch4, ch5];
  }
  return [
    {
      id: 'vol-1',
      type: 'folder',
      title: '第一卷　霧港',
      expanded: true,
      children: [ch1, ch2],
    },
    ch3,
    ch4,
    ch5,
  ];
}

function createFogHotelEvents() {
  return [
    {
      id: 'e1',
      parent_id: null,
      category: 'timeline',
      title: '舊館大火，沈家小女兒失蹤',
      content: '除夕夜舊館起火。',
      color: '#E06C75',
      is_collapsed: 0,
      sort_order: 1,
      storyTime: '十年前・冬',
      timelineOrder: 0,
      chapterId: 'ch-3',
    },
    {
      id: 'e2',
      parent_id: null,
      category: 'timeline',
      title: '沈伯謙偷偷改了遺囑',
      content: '找律師密會改動遺產分配。',
      color: '#C5BEE0',
      is_collapsed: 0,
      sort_order: 2,
      storyTime: '案發前三個月',
      timelineOrder: 1,
      chapterId: null,
    },
    {
      id: 'e3',
      parent_id: null,
      category: 'timeline',
      title: '周嫂在湯裡下了安眠藥',
      content: '晚膳湯品異常。',
      color: '#E89A5C',
      is_collapsed: 0,
      sort_order: 3,
      storyTime: '案發當晚 20:00',
      timelineOrder: 2,
      chapterId: 'ch-5',
    },
    {
      id: 'e4',
      parent_id: null,
      category: 'timeline',
      title: '沈伯謙在書房遇害',
      content: '書房內門反鎖。',
      color: '#E06C75',
      is_collapsed: 0,
      sort_order: 4,
      storyTime: '案發當晚 23:40',
      timelineOrder: 3,
      chapterId: 'ch-5',
    },
    {
      id: 'e5',
      parent_id: null,
      category: 'timeline',
      title: '女傭阿蘋發現書房反鎖',
      content: '清晨敲門無人應答。',
      color: '#3C3F41',
      is_collapsed: 0,
      sort_order: 5,
      storyTime: '隔天清晨',
      timelineOrder: 4,
      chapterId: 'ch-1',
    },
    {
      id: 'e6',
      parent_id: null,
      category: 'timeline',
      title: '偵探林曉霧搭渡輪抵達霧港',
      content: '霧中登島調查。',
      color: '#3C3F41',
      is_collapsed: 0,
      sort_order: 6,
      storyTime: '隔天中午',
      timelineOrder: 5,
      chapterId: 'ch-2',
    },
    {
      id: 'e7',
      parent_id: null,
      category: 'timeline',
      title: '逐一詢問三人的不在場證明',
      content: '客廳集體問訊。',
      color: '#3C3F41',
      is_collapsed: 0,
      sort_order: 7,
      storyTime: '隔天傍晚',
      timelineOrder: 6,
      chapterId: 'ch-4',
    },
  ];
}

function buildInitScript({ touch, theme = 'forest' }) {
  return ({ onboardingKey, themeKey, inputModeKey, deviceKindKey, isTouch, themeId }) => {
    try {
      localStorage.setItem(
        onboardingKey,
        JSON.stringify({ status: 'skipped', at: '2026-11-20T09:00:00.000Z', appVersion: '0.1.0' }),
      );
      localStorage.setItem(themeKey, themeId);
      localStorage.setItem(inputModeKey, isTouch ? 'touch' : 'mouse');
      localStorage.setItem(deviceKindKey, isTouch ? 'phone' : 'computer');
    } catch {
      // ignore
    }
  };
}

function buildDesktopMediaStub() {
  const real = window.matchMedia.bind(window);
  window.matchMedia = (query) => {
    const normalized = String(query).replace(/\s/g, '');
    const stub = (matches) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => true,
    });
    if (normalized === '(pointer:fine)' || normalized === '(any-pointer:fine)' || normalized === '(hover:hover)') {
      return stub(true);
    }
    if (normalized === '(pointer:coarse)') return stub(false);
    return real(query);
  };
}

async function openContext(browser, seedState, { width, height, touch, theme = 'forest' }) {
  const context = await browser.newContext({
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    viewport: { width, height },
    isMobile: touch && width < 600,
    hasTouch: touch,
    storageState: seedState,
  });
  await context.addInitScript(buildInitScript({ touch, theme }), {
    onboardingKey: ONBOARDING_KEY,
    themeKey: THEME_KEY,
    inputModeKey: INPUT_MODE_KEY,
    deviceKindKey: DEVICE_KIND_KEY,
    isTouch: touch,
    themeId: theme,
  });
  if (!touch) {
    await context.addInitScript(buildDesktopMediaStub);
  }
  const page = await context.newPage();
  return { context, page };
}

/** 透過 App 介面「開新稿子」並建立《霧港旅館》（5 章、7 事件）與分卷複本（供刪卷驗證）。 */
async function createFogHotelSeed(browser) {
  const context = await browser.newContext({
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript(buildInitScript({ touch: false, theme: 'forest' }), {
    onboardingKey: ONBOARDING_KEY,
    themeKey: THEME_KEY,
    inputModeKey: INPUT_MODE_KEY,
    deviceKindKey: DEVICE_KIND_KEY,
    isTouch: false,
    themeId: 'forest',
  });
  const page = await context.newPage();

  const createBookViaUi = async (title) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.locator('[data-testid="home-screen"]').waitFor({ state: 'visible', timeout: 20000 });
    await page.getByRole('button', { name: '開新稿子' }).first().click({ timeout: 8000 });
    const dialog = page.locator('form.dialog');
    await dialog.waitFor({ state: 'visible', timeout: 8000 });
    await dialog.locator('input').first().fill(title);
    await dialog.locator('button[type="submit"]').first().click({ timeout: 8000 });
    await page.waitForURL(/\/p\/[^/]+\/write/, { timeout: 15000 });
    await page.waitForTimeout(600);
    const match = page.url().match(/\/p\/([^/]+)\/write/);
    if (!match) throw new Error(`開新稿子未進入寫作頁：${page.url()}`);
    return match[1];
  };

  const mainPid = await createBookViaUi('霧港旅館');
  const volPid = await createBookViaUi('霧港旅館（分卷）');

  const state = await context.storageState();
  await context.close();

  const baseOrigin = new URL(BASE).origin;
  const originEntry = state.origins.find((o) => o.origin === baseOrigin);
  const outlineItem = originEntry?.localStorage.find((i) => i.name === OUTLINE_KEY);
  if (!outlineItem) {
    throw new Error('App 開新稿子後找不到本機稿件儲存鍵 jiufang-novel-m.outline.v1');
  }

  const projects = JSON.parse(outlineItem.value);
  const mainBook = projects.find((p) => p.id === mainPid);
  const volBook = projects.find((p) => p.id === volPid);
  if (!mainBook || !volBook) {
    throw new Error('無法在 localStorage 中找到剛建立的《霧港旅館》專案');
  }

  mainBook.shape = 'novel';
  mainBook.nodes = createFogHotelChapters(false);
  mainBook.cards = createFogHotelEvents();
  mainBook.lastOpenedNodeId = 'ch-1';

  volBook.shape = 'novel';
  volBook.nodes = createFogHotelChapters(true);
  volBook.cards = createFogHotelEvents();
  volBook.lastOpenedNodeId = 'ch-1';

  outlineItem.value = JSON.stringify(projects);
  return { state, mainPid, volPid };
}

/** 在目前資料集畫面切到「時間軸 → 時間線」（相容記住第二／三層的手機直式／橫式與多欄版面）。 */
async function enterTimelineFromCurrentCardsScreen(page) {
  await page.locator('[data-testid="cards-screen"]').waitFor({ state: 'visible', timeout: 15000 });

  const timelineCat = page.locator('[data-testid="category-row-timeline"]').first();
  const backToCatsBtn = page.locator(`button[aria-label="${BACK_TO_CATEGORIES_ARIA}"]`).first();
  const backToCardsBtn = page.locator(`button[aria-label="${BACK_TO_CARDS_ARIA}"]`).first();

  await page
    .locator(
      `[data-testid="category-row-timeline"], button[aria-label="${BACK_TO_CATEGORIES_ARIA}"], button[aria-label="${BACK_TO_CARDS_ARIA}"]`,
    )
    .first()
    .waitFor({ state: 'visible', timeout: 10000 });

  // 手機直式／橫式停在第三層（卡片詳情）或第二層（記住的分類清單）時，先真實點擊返回至第一層分類清單
  if (!(await timelineCat.isVisible().catch(() => false))) {
    if (await backToCardsBtn.isVisible().catch(() => false)) {
      await backToCardsBtn.click({ timeout: 8000 });
      await page
        .locator(`[data-testid="category-row-timeline"], button[aria-label="${BACK_TO_CATEGORIES_ARIA}"]`)
        .first()
        .waitFor({ state: 'visible', timeout: 8000 });
    }
    if (!(await timelineCat.isVisible().catch(() => false)) && (await backToCatsBtn.isVisible().catch(() => false))) {
      await backToCatsBtn.click({ timeout: 8000 });
    }
  }

  await timelineCat.waitFor({ state: 'visible', timeout: 10000 });
  await timelineCat.click({ timeout: 8000 });

  const entrySwitch = page.locator('[data-testid="timeline-entry-switch"]').first();
  await entrySwitch.waitFor({ state: 'visible', timeout: 10000 });

  const timelineBtn = page.locator('[data-testid="timeline-entry-timeline-btn"]').first();
  await timelineBtn.waitFor({ state: 'visible', timeout: 8000 });
  await timelineBtn.click({ timeout: 8000 });

  await page.locator('[data-testid="timeline-screen"]').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(250);
}

/** 由「資料集 → 時間軸」切換進入時間線畫面，不直接硬寫時間線網址跳過入口。 */
async function openTimelineViaCards(page, pid) {
  await page.goto(`${BASE}/p/${pid}/cards`, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await enterTimelineFromCurrentCardsScreen(page);
}

/** 由目前畫面點擊可見導覽列的「資料集」分頁並進時間線。 */
async function openTimelineViaNavCards(page) {
  const layout = await page.evaluate(() => document.documentElement.dataset.layout || '');
  if (layout === 'phone-landscape') {
    const rail = page.locator('[data-testid="nav-rail"]');
    if (!(await rail.isVisible().catch(() => false))) {
      await page.locator('[data-testid="toggle-tree-floating"]').click({ timeout: 8000 });
      await rail.waitFor({ state: 'visible', timeout: 8000 });
    }
  }
  const navSelector =
    layout === 'phone-portrait' || layout === 'medium'
      ? '[data-testid="bottom-nav"] [data-testid="nav-cards"]'
      : '[data-testid="nav-rail"] [data-testid="nav-cards"]';
  const navCards = page.locator(navSelector);
  await navCards.waitFor({ state: 'visible', timeout: 8000 });
  await navCards.click({ timeout: 8000 });
  await enterTimelineFromCurrentCardsScreen(page);
}

/** 依目前版面確保寫作頁目錄區可見（手機直式回目錄頁、手機橫式點浮動目錄鈕、中等／寬版點頂列目錄鈕）。 */
async function ensureChapterTreeOpen(page) {
  const tree = page.locator('[data-testid="chapter-tree"]');
  if (await tree.isVisible().catch(() => false)) return;

  const layout = await page.evaluate(() => document.documentElement.dataset.layout || '');
  if (layout === 'phone-portrait') {
    await page.locator('[data-testid="back-button"]').click({ timeout: 8000 });
  } else if (layout === 'phone-landscape') {
    await page.locator('[data-testid="toggle-tree-floating"]').click({ timeout: 8000 });
  } else {
    await page.locator('[data-testid="toggle-tree-topbar"]').click({ timeout: 8000 });
  }
  await tree.waitFor({ state: 'visible', timeout: 10000 });
}

/** 依操作方式（滑鼠 hover 更多操作／觸控整理目錄選取後點更多）刪除指定章或卷。 */
async function deleteTreeNode(page, nodeId, isTouch) {
  await ensureChapterTreeOpen(page);
  if (isTouch) {
    await page.locator('[data-testid="organize-toggle"]').click({ timeout: 8000 });
    const dock = page.locator('.organize-dock');
    await dock.waitFor({ state: 'visible', timeout: 8000 });
    const rowMain = page.locator(`.tree-row[data-node-id="${nodeId}"] .tree-main`).first();
    await rowMain.waitFor({ state: 'visible', timeout: 8000 });
    await rowMain.click({ timeout: 8000 });
    await dock.getByRole('button', { name: '更多', exact: true }).click({ timeout: 8000 });
  } else {
    const row = page.locator(`.tree-row[data-node-id="${nodeId}"]`);
    await row.waitFor({ state: 'visible', timeout: 8000 });
    await row.hover({ timeout: 8000 });
    await row.locator('button[aria-label*="更多操作"]').click({ timeout: 8000 });
  }

  const nodeMenu = page.locator('[data-testid="node-menu"]');
  await nodeMenu.waitFor({ state: 'visible', timeout: 8000 });
  await nodeMenu.getByRole('button', { name: /刪除/ }).first().click({ timeout: 8000 });

  const deleteConfirm = page.locator('[data-testid="delete-confirm"]');
  await deleteConfirm.waitFor({ state: 'visible', timeout: 8000 });
  await deleteConfirm.locator('button.danger').click({ timeout: 8000 });
  await page.waitForTimeout(300);

  const organizeDone = page.locator('[data-testid="organize-done"]');
  if (await organizeDone.isVisible().catch(() => false)) {
    await organizeDone.click({ timeout: 8000 });
  }
}

/** 項目 1：四種版面觸控按鈕／拖曳把手 ≥ 44×44、無水平溢位、導覽不遮擋末張卡片。 */
async function verifyItem1Layouts(browser, seed) {
  for (const vp of VIEWPORTS) {
    const section = `項目1-${vp.key}`;
    const { context, page } = await openContext(browser, seed.state, {
      width: vp.width,
      height: vp.height,
      touch: vp.touch,
    });
    try {
      await openTimelineViaCards(page, seed.mainPid);

      const layoutAttr = await page.evaluate(() => ({
        layout: document.documentElement.dataset.layout || '',
        pointer: document.documentElement.dataset.pointer || '',
      }));
      record(
        section,
        `data-layout 為 ${vp.expectedLayout}`,
        layoutAttr.layout === vp.expectedLayout,
        vp.expectedLayout,
        layoutAttr.layout,
      );

      // 模式切換按鈕數量：只有 wide 有雙軸對照（3 顆），其餘 2 顆
      const tabCount = await page.locator('[data-testid="timeline-mode-switch"] [role="tab"]').count();
      const dualTabVisible = await page
        .locator('[data-testid="timeline-tab-dual"]')
        .isVisible()
        .catch(() => false);
      const expectedTabs = vp.expectedLayout === 'wide' ? 3 : 2;
      record(
        section,
        '模式切換按鈕數量與雙軸顯示條件',
        tabCount === expectedTabs && dualTabVisible === (vp.expectedLayout === 'wide'),
        `${expectedTabs} 顆（dual=${vp.expectedLayout === 'wide'}）`,
        `${tabCount} 顆（dual=${dualTabVisible}）`,
      );

      // 導覽維持五格且資料集分頁亮起（只量測目前版面實際顯示的那一條導覽列）
      const expectedNavId =
        vp.expectedLayout === 'phone-portrait' || vp.expectedLayout === 'medium' ? 'bottom-nav' : 'nav-rail';
      const navSummary = await page.evaluate((expNavId) => {
        const navs = [...document.querySelectorAll('[data-testid="bottom-nav"], [data-testid="nav-rail"]')];
        const visibleNavs = navs.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none';
        });
        const nav = visibleNavs[0];
        if (!nav) {
          return { found: false, visibleCount: 0, navId: '', matchesExpected: false, count: 0, cardsActive: false };
        }
        const items = [...nav.querySelectorAll('[data-testid^="nav-"]')];
        const cards = nav.querySelector('[data-testid="nav-cards"]');
        return {
          found: true,
          visibleCount: visibleNavs.length,
          navId: nav.getAttribute('data-testid') || '',
          matchesExpected: nav.getAttribute('data-testid') === expNavId,
          count: items.length,
          cardsActive: cards?.getAttribute('data-nav-active') === 'true',
        };
      }, expectedNavId);
      record(
        section,
        '導覽維持五格且資料集亮起',
        navSummary.found &&
          navSummary.visibleCount === 1 &&
          navSummary.matchesExpected &&
          navSummary.count === 5 &&
          navSummary.cardsActive,
        `found=true, visibleCount=1, navId=${expectedNavId}, count=5, cardsActive=true`,
        JSON.stringify(navSummary),
      );

      // 觸控模式按鈕與拖曳把手尺寸 ≥ 44×44
      if (vp.touch) {
        const hitCheck = await page.evaluate(() => {
          const selectors = [
            '[data-testid="timeline-back-btn"]',
            '[data-testid="timeline-add-event-btn"]',
            '[data-testid="timeline-mode-switch"] button',
            '.timeline-drag-handle',
            '.timeline-card-body-btn',
          ];
          const tooSmall = [];
          let measured = 0;
          for (const sel of selectors) {
            for (const el of document.querySelectorAll(sel)) {
              const r = el.getBoundingClientRect();
              if (r.width === 0 && r.height === 0) continue;
              measured += 1;
              if (r.width < 43.5 || r.height < 43.5) {
                tooSmall.push({
                  testid: el.getAttribute('data-testid') || el.className,
                  w: Math.round(r.width * 10) / 10,
                  h: Math.round(r.height * 10) / 10,
                });
              }
            }
          }
          return { pointer: document.documentElement.dataset.pointer, measured, tooSmall };
        });
        record(
          section,
          '觸控模式按鈕與拖曳把手尺寸 ≥ 44×44px',
          hitCheck.pointer === 'touch' && hitCheck.measured > 0 && hitCheck.tooSmall.length === 0,
          'pointer=touch, tooSmall=[]',
          `pointer=${hitCheck.pointer}, measured=${hitCheck.measured}, tooSmall=${JSON.stringify(hitCheck.tooSmall)}`,
        );
      }

      // 無意外水平溢位
      const overflow = await page.evaluate(() => {
        const docOverflow = document.documentElement.scrollWidth - window.innerWidth;
        const pane = document.querySelector('[data-testid="timeline-story-scroll"]');
        const paneOverflow = pane ? pane.scrollWidth - pane.clientWidth : 0;
        return { docOverflow, paneOverflow };
      });
      record(
        section,
        '故事順序無水平溢位',
        overflow.docOverflow <= 1 && overflow.paneOverflow <= 1,
        'docOverflow<=1, paneOverflow<=1',
        JSON.stringify(overflow),
      );

      // 捲至底部確認末張卡片不被底部導覽／左側窄欄遮擋
      const lastCard = page.locator('[data-testid="timeline-card-btn-e7"]').first();
      await lastCard.scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      const occlusionStory = await page.evaluate(() => {
        const card = document.querySelector('[data-testid="timeline-card-btn-e7"]');
        const nav = [...document.querySelectorAll('[data-testid="bottom-nav"], [data-testid="nav-rail"]')].find(
          (el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none';
          },
        );
        if (!card || !nav) return { ok: false, reason: 'missing-card-or-nav' };
        const cr = card.getBoundingClientRect();
        const nr = nav.getBoundingClientRect();
        const isBottom = nav.getAttribute('data-testid') === 'bottom-nav';
        const overlaps =
          cr.left < nr.right - 1 &&
          nr.left < cr.right - 1 &&
          cr.top < nr.bottom - 1 &&
          nr.top < cr.bottom - 1;
        const inView = cr.bottom <= window.innerHeight + 1 && cr.top >= -1;
        return {
          ok: !overlaps && inView,
          navId: nav.getAttribute('data-testid'),
          isBottom,
          overlaps,
          inView,
          cardBottom: Math.round(cr.bottom),
          navTop: Math.round(nr.top),
          navRight: Math.round(nr.right),
          cardLeft: Math.round(cr.left),
          vh: window.innerHeight,
        };
      });
      record(
        section,
        '故事順序末張卡片不被導覽遮擋',
        occlusionStory.ok,
        'ok=true',
        JSON.stringify(occlusionStory),
      );
      await capture(page, `item1-story-${vp.key}`);

      // 切到章節順序再確認末張卡片不被導覽遮擋且無水平溢位
      await page.locator('[data-testid="timeline-tab-reading"]').click({ timeout: 8000 });
      await page.locator('[data-testid="timeline-reading-view"]').waitFor({ state: 'visible', timeout: 8000 });
      const lastReadingCard = page.locator('[data-testid="timeline-reading-card-btn-e2"]').first();
      await lastReadingCard.scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      const occlusionReading = await page.evaluate(() => {
        const card = document.querySelector('[data-testid="timeline-reading-card-btn-e2"]');
        const nav = [...document.querySelectorAll('[data-testid="bottom-nav"], [data-testid="nav-rail"]')].find(
          (el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none';
          },
        );
        const docOverflow = document.documentElement.scrollWidth - window.innerWidth;
        if (!card || !nav) return { ok: false, reason: 'missing-card-or-nav', docOverflow };
        const cr = card.getBoundingClientRect();
        const nr = nav.getBoundingClientRect();
        const overlaps =
          cr.left < nr.right - 1 &&
          nr.left < cr.right - 1 &&
          cr.top < nr.bottom - 1 &&
          nr.top < cr.bottom - 1;
        return {
          ok: !overlaps && docOverflow <= 1 && cr.bottom <= window.innerHeight + 1 && cr.top >= -1,
          navId: nav.getAttribute('data-testid'),
          overlaps,
          docOverflow,
        };
      });
      record(
        section,
        '章節順序無水平溢位且末張卡片不被導覽遮擋',
        occlusionReading.ok,
        'ok=true',
        JSON.stringify(occlusionReading),
      );
      await capture(page, `item1-reading-${vp.key}`);

      // 點時間線左上返回鈕回到資料集時間軸清單
      await page.locator('[data-testid="timeline-back-btn"]').click({ timeout: 8000 });
      await page.locator('[data-testid="cards-screen"]').waitFor({ state: 'visible', timeout: 10000 });
      await page.locator('[data-testid="timeline-entry-switch"]').first().waitFor({ state: 'visible', timeout: 8000 });
      const cardsTabSelected =
        (await page.locator('[data-testid="timeline-entry-cards-btn"]').first().getAttribute('aria-selected')) === 'true';
      const layoutSpecificBackOk =
        vp.expectedLayout === 'phone-portrait' || vp.expectedLayout === 'phone-landscape'
          ? await page
              .locator(`button[aria-label="${BACK_TO_CATEGORIES_ARIA}"]`)
              .first()
              .isVisible()
              .catch(() => false)
          : await page
              .locator('[data-testid="category-row-timeline"]')
              .first()
              .isVisible()
              .catch(() => false);
      record(
        section,
        '點時間線返回鈕回到資料集時間軸清單',
        cardsTabSelected && layoutSpecificBackOk,
        'cardsTabSelected=true, layoutSpecificBackOk=true',
        `cardsTabSelected=${cardsTabSelected}, layoutSpecificBackOk=${layoutSpecificBackOk}`,
      );
    } finally {
      await context.close();
    }
  }
}

/** 項目 2：故事順序實際 Pointer 拖曳換順序 + 短按 ⠿ 以「上移／下移」換順序 + 重新整理保留。 */
async function verifyItem2DragAndAccessibleMove(browser, seed) {
  const section = '項目2-排序與重整保留';
  const { context, page } = await openContext(browser, seed.state, {
    width: 390,
    height: 844,
    touch: true,
  });
  const readOrder = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="timeline-story-list"] > li[data-event-id]')].map(
        (el) => el.getAttribute('data-event-id'),
      ),
    );

  try {
    await openTimelineViaCards(page, seed.mainPid);
    const initialOrder = await readOrder();
    record(
      section,
      '初始故事順序為 e1..e7',
      JSON.stringify(initialOrder) === JSON.stringify(['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7']),
      'e1..e7',
      initialOrder.join(','),
    );

    // 1. 實際 Pointer 拖曳：把 e1 拖到 e3 下半部（變成 e2, e3, e1, e4, e5, e6, e7）
    const handleBox = await page.locator('[data-testid="timeline-handle-e1"]').boundingBox();
    const targetBox = await page.locator('[data-testid="timeline-event-e3"]').boundingBox();
    if (!handleBox || !targetBox) {
      throw new Error('找不到拖曳把手 e1 或目標事件 e3');
    }
    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;
    const endX = startX;
    const endY = targetBox.y + targetBox.height * 0.8;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 14 });
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.waitForTimeout(200);

    const afterDragOrder = await readOrder();
    const dockVisibleAfterDrag = await page
      .locator('[data-testid="timeline-organize-dock"]')
      .isVisible()
      .catch(() => false);
    const liveAfterDrag = await page.locator('[data-testid="timeline-live-region"]').innerText();
    record(
      section,
      '實際 Pointer 拖曳換順序並播報、不誤開排序列',
      JSON.stringify(afterDragOrder) === JSON.stringify(['e2', 'e3', 'e1', 'e4', 'e5', 'e6', 'e7']) &&
        !dockVisibleAfterDrag &&
        liveAfterDrag.includes('已將「舊館大火，沈家小女兒失蹤」移到故事裡第 3 件'),
      'e2,e3,e1,e4,e5,e6,e7 / dock=false',
      `${afterDragOrder.join(',')} / dock=${dockVisibleAfterDrag} / live=${liveAfterDrag}`,
    );

    // 重新整理後順序保留
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.locator('[data-testid="timeline-story-list"]').waitFor({ state: 'visible', timeout: 15000 });
    const afterReload1 = await readOrder();
    record(
      section,
      '拖曳換順序後重新整理仍保留',
      JSON.stringify(afterReload1) === JSON.stringify(['e2', 'e3', 'e1', 'e4', 'e5', 'e6', 'e7']),
      'e2,e3,e1,e4,e5,e6,e7',
      afterReload1.join(','),
    );

    // 2. 短按 ⠿ 開排序列，以上移／下移換順序
    await page.locator('[data-testid="timeline-handle-e1"]').tap({ timeout: 8000 });
    await page.locator('[data-testid="timeline-organize-dock"]').waitFor({ state: 'visible', timeout: 8000 });
    const dockHitCheck = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('[data-testid="timeline-organize-dock"] button')];
      return btns.map((b) => {
        const r = b.getBoundingClientRect();
        return { id: b.getAttribute('data-testid'), w: r.width, h: r.height };
      });
    });
    record(
      section,
      '排序列上移／下移／完成按鈕觸控熱區 ≥ 44×44',
      dockHitCheck.length === 3 && dockHitCheck.every((b) => b.w >= 43.5 && b.h >= 43.5),
      '3 顆皆 ≥ 44×44',
      JSON.stringify(dockHitCheck),
    );
    await capture(page, 'item2-organize-dock');

    // e1 在第 3 位（index 2），連按兩次「上移」移到第 1 位
    await page.locator('[data-testid="timeline-move-up-btn"]').tap({ timeout: 5000 });
    await page.locator('[data-testid="timeline-move-up-btn"]').tap({ timeout: 5000 });
    const upDisabledAtTop = await page.locator('[data-testid="timeline-move-up-btn"]').isDisabled();
    // 再按一次「下移」移到第 2 位（e2, e1, e3, e4, e5, e6, e7）
    await page.locator('[data-testid="timeline-move-down-btn"]').tap({ timeout: 5000 });
    const liveAfterButtons = await page.locator('[data-testid="timeline-live-region"]').innerText();
    await page.locator('[data-testid="timeline-move-done-btn"]').tap({ timeout: 5000 });

    const afterDockOrder = await readOrder();
    record(
      section,
      '短按 ⠿ 以上移／下移換順序並播報',
      upDisabledAtTop &&
        JSON.stringify(afterDockOrder) === JSON.stringify(['e2', 'e1', 'e3', 'e4', 'e5', 'e6', 'e7']) &&
        liveAfterButtons.includes('已將「舊館大火，沈家小女兒失蹤」移到故事裡第 2 件'),
      'upDisabledAtTop=true, e2,e1,e3,e4,e5,e6,e7',
      `upDisabledAtTop=${upDisabledAtTop}, ${afterDockOrder.join(',')}`,
    );

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.locator('[data-testid="timeline-story-list"]').waitFor({ state: 'visible', timeout: 15000 });
    const afterReload2 = await readOrder();
    record(
      section,
      '上移／下移換順序後重新整理仍保留',
      JSON.stringify(afterReload2) === JSON.stringify(['e2', 'e1', 'e3', 'e4', 'e5', 'e6', 'e7']),
      'e2,e1,e3,e4,e5,e6,e7',
      afterReload2.join(','),
    );
  } finally {
    await context.close();
  }
}

/** 項目 3：事件卡設定故事時間與連章、點「跳到第三章」、回目錄刪章與刪卷後事件轉「還沒寫進任何章」（涵蓋五種尺寸）。 */
async function verifyItem3CardJumpAndDeleteChapterVolume(browser, seed) {
  for (const vp of VIEWPORTS) {
    const section = `項目3-${vp.key}`;

    // A. 設定故事時間與連章 → 返回時間線重開 → 點「跳到第三章」→ 回目錄刪章（ch-3）
    {
      const { context, page } = await openContext(browser, seed.state, {
        width: vp.width,
        height: vp.height,
        touch: vp.touch,
      });
      try {
        await openTimelineViaCards(page, seed.mainPid);
        // 打開未連章事件 e2，編輯故事時間與連章
        await page.locator('[data-testid="timeline-card-btn-e2"]').click({ timeout: 8000 });
        await page.locator('[data-testid="timeline-detail-back-btn"]').waitFor({ state: 'visible', timeout: 8000 });
        await page.locator('[data-testid="card-editor-start-edit-btn"]').click({ timeout: 8000 });

        await page.locator('[data-testid="card-editor-story-time-input"]').fill('案發前三個月・深夜');
        await page.locator('[data-testid="card-editor-chapter-trigger"]').click({ timeout: 8000 });
        const ch3Opt = page.locator('[data-testid="card-editor-chapter-option-ch-3"]');
        await ch3Opt.scrollIntoViewIfNeeded();
        await ch3Opt.click({ timeout: 8000 });
        await page.locator('[data-testid="card-editor-done-btn"]').click({ timeout: 8000 });

        const previewStoryTime = await page.locator('[data-testid="card-preview-story-time"]').innerText();
        const jumpBtn = page.locator('[data-testid="card-editor-jump-chapter-btn"]').first();
        const jumpText = await jumpBtn.innerText();
        record(
          section,
          '事件卡儲存故事時間與連到第三章並顯示跳章鈕',
          previewStoryTime.includes('案發前三個月・深夜') && jumpText.includes('跳到第三章'),
          '案發前三個月・深夜 / 跳到第三章',
          `${previewStoryTime} / ${jumpText}`,
        );

        if (vp.touch) {
          const jumpHit = await page.evaluate(() => {
            const links = [...document.querySelectorAll('.card-editor-jump-link')].filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            });
            const rects = links.map((el) => {
              const r = el.getBoundingClientRect();
              return {
                w: Math.round(r.width * 10) / 10,
                h: Math.round(r.height * 10) / 10,
              };
            });
            return {
              pointer: document.documentElement.dataset.pointer,
              count: rects.length,
              rects,
              ok: rects.length > 0 && rects.every((r) => r.h >= 43.5),
            };
          });
          record(
            section,
            '觸控模式事件卡內「跳到第○章」按鈕（.card-editor-jump-link）高度 ≥ 44px',
            jumpHit.pointer === 'touch' && jumpHit.ok,
            'pointer=touch, count>0, h>=44',
            JSON.stringify(jumpHit),
          );
        }

        // 先點「返回時間線」確認卡片詳情可回到時間線，再重開 e2 進行跳章
        await page.locator('[data-testid="timeline-detail-back-btn"]').click({ timeout: 8000 });
        await page.locator('[data-testid="timeline-story-view"]').waitFor({ state: 'visible', timeout: 8000 });
        const detailClosed = !(await page
          .locator('[data-testid="timeline-detail-back-btn"]')
          .isVisible()
          .catch(() => false));
        record(
          section,
          '點事件卡返回時間線回到時間線列表',
          detailClosed,
          'detailClosed=true',
          `detailClosed=${detailClosed}`,
        );

        await page.locator('[data-testid="timeline-card-btn-e2"]').click({ timeout: 8000 });
        await page.locator('[data-testid="card-editor-jump-chapter-btn"]').first().waitFor({ state: 'visible', timeout: 8000 });

        // 點「跳到第三章」實際導航至寫作頁第三章
        await page.locator('[data-testid="card-editor-jump-chapter-btn"]').first().click({ timeout: 8000 });
        await page.waitForURL(new RegExp(`/p/${seed.mainPid}/write/ch-3`), { timeout: 10000 });
        await page.locator('[data-testid="writing-input"]').waitFor({ state: 'visible', timeout: 10000 });
        const ch3Body = await page.locator('[data-testid="writing-input"]').inputValue();
        record(
          section,
          '點「跳到第三章」導航至寫作頁第三章',
          page.url().includes(`/write/ch-3`) && ch3Body.includes('十年前舊館大火正文'),
          'URL 含 /write/ch-3 且正文為第三章',
          `${page.url()} / ${ch3Body}`,
        );
        await capture(page, `item3-jump-to-ch3-${vp.key}`);

        // 在目錄刪除第三章（ch-3）：依版面打開目錄，依操作方式（觸控整理／滑鼠 hover）刪章
        await deleteTreeNode(page, 'ch-3', vp.touch);

        // 透過可見導覽列回時間線檢查 e1 與 e2 轉為「還沒寫進任何章」，且事件不刪
        await openTimelineViaNavCards(page);
        await page.locator('[data-testid="timeline-story-list"]').waitFor({ state: 'visible', timeout: 10000 });

        const e1Unassigned = await page
          .locator('[data-testid="timeline-unassigned-chip-e1"]')
          .isVisible()
          .catch(() => false);
        const e2Unassigned = await page
          .locator('[data-testid="timeline-unassigned-chip-e2"]')
          .isVisible()
          .catch(() => false);
        const eventCount = await page.locator('[data-testid="timeline-story-list"] > li').count();
        record(
          section,
          '刪章後連到該章的事件轉為「還沒寫進任何章」且不刪事件',
          e1Unassigned && e2Unassigned && eventCount === 7,
          'e1/e2 未連章、總事件數 7',
          `e1Unassigned=${e1Unassigned}, e2Unassigned=${e2Unassigned}, count=${eventCount}`,
        );
      } finally {
        await context.close();
      }
    }

    // B. 刪卷（vol-1 內含 ch-1、ch-2）：連到 ch-1 (e5) 與 ch-2 (e6) 轉為未連章，他章 (e1, e3, e4, e7) 不變
    {
      const { context, page } = await openContext(browser, seed.state, {
        width: vp.width,
        height: vp.height,
        touch: vp.touch,
      });
      try {
        await page.goto(`${BASE}/p/${seed.volPid}/write/ch-1`, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.locator('[data-testid="write-screen"]').waitFor({ state: 'visible', timeout: 15000 });
        await page.locator('[data-testid="writing-input"]').waitFor({ state: 'visible', timeout: 15000 });

        await deleteTreeNode(page, 'vol-1', vp.touch);

        await openTimelineViaNavCards(page);
        await page.locator('[data-testid="timeline-story-list"]').waitFor({ state: 'visible', timeout: 10000 });

        const e5Unassigned = await page
          .locator('[data-testid="timeline-unassigned-chip-e5"]')
          .isVisible()
          .catch(() => false);
        const e6Unassigned = await page
          .locator('[data-testid="timeline-unassigned-chip-e6"]')
          .isVisible()
          .catch(() => false);
        const e1Chapter = await page
          .locator('[data-testid="timeline-chapter-chip-e1"]')
          .isVisible()
          .catch(() => false);
        const eventCount = await page.locator('[data-testid="timeline-story-list"] > li').count();
        record(
          section,
          '刪卷後卷內各章事件轉「還沒寫進任何章」，他章事件維持連章',
          e5Unassigned && e6Unassigned && e1Chapter && eventCount === 7,
          'e5/e6 未連章、e1 仍連章、總事件數 7',
          `e5Unassigned=${e5Unassigned}, e6Unassigned=${e6Unassigned}, e1Chapter=${e1Chapter}, count=${eventCount}`,
        );
      } finally {
        await context.close();
      }
    }
  }
}

/** 量測雙軸對照 SVG 連線起終點與卡片中心誤差是否皆 ≤ 2px。 */
async function measureDualAxisLines(page) {
  return page.evaluate(() => {
    const stage = document.querySelector('[data-testid="timeline-dual-stage"]');
    const bottomHeader = document.querySelector('[data-testid="timeline-dual-bottom-header"]');
    const svg = document.querySelector('[data-testid="timeline-dual-svg"]');
    if (!stage || !bottomHeader || !svg) {
      return { ok: false, reason: 'missing-stage-or-svg', pathCount: 0, errors: [] };
    }
    const stageRect = stage.getBoundingClientRect();
    const bottomHeaderRect = bottomHeader.getBoundingClientRect();
    const expectedY2 = bottomHeaderRect.top - stageRect.top - 8;

    const paths = [...svg.querySelectorAll('path[data-testid^="timeline-dual-path-"]')];
    const errors = [];
    const coords = {};

    for (const pathEl of paths) {
      const testId = pathEl.getAttribute('data-testid') || '';
      const id = testId.replace('timeline-dual-path-', '');
      const topCard = document.querySelector(`[data-testid="timeline-dual-top-card-${id}"]`);
      const botCard = document.querySelector(`[data-testid="timeline-dual-bottom-card-${id}"]`);
      const dotEl = svg.querySelector(`[data-testid="timeline-dual-dot-${id}"]`);
      const d = pathEl.getAttribute('d') || '';
      const m = /^M\s+([-\d.]+)\s+([-\d.]+)\s+C\s+[-\d.]+\s+[-\d.]+,\s+[-\d.]+\s+[-\d.]+,\s+([-\d.]+)\s+([-\d.]+)$/.exec(d);
      if (!topCard || !botCard || !dotEl || !m) {
        errors.push({ id, reason: 'missing-card-dot-or-bad-d', d });
        continue;
      }
      const tr = topCard.getBoundingClientRect();
      const br = botCard.getBoundingClientRect();
      const x1 = Number(m[1]);
      const y1 = Number(m[2]);
      const x2 = Number(m[3]);
      const y2 = Number(m[4]);
      const expX1 = tr.left + tr.width / 2 - stageRect.left;
      const expY1 = tr.bottom - stageRect.top;
      const expX2 = br.left + br.width / 2 - stageRect.left;
      const cx = Number(dotEl.getAttribute('cx'));
      const cy = Number(dotEl.getAttribute('cy'));

      const dx1 = Math.abs(x1 - expX1);
      const dy1 = Math.abs(y1 - expY1);
      const dx2 = Math.abs(x2 - expX2);
      const dy2 = Math.abs(y2 - expectedY2);
      const dcx = Math.abs(cx - expX2);
      const dcy = Math.abs(cy - expectedY2);

      coords[id] = { x1: Math.round(x1), x2: Math.round(x2) };
      if (dx1 > 2 || dy1 > 2 || dx2 > 2 || dy2 > 2 || dcx > 2 || dcy > 2) {
        errors.push({
          id,
          dx1: Math.round(dx1 * 100) / 100,
          dy1: Math.round(dy1 * 100) / 100,
          dx2: Math.round(dx2 * 100) / 100,
          dy2: Math.round(dy2 * 100) / 100,
          dcx: Math.round(dcx * 100) / 100,
          dcy: Math.round(dcy * 100) / 100,
        });
      }
    }

    return {
      ok: paths.length > 0 && errors.length === 0,
      pathCount: paths.length,
      errors,
      coords,
    };
  });
}

/** 量測雙軸對照「開啟卡片」按鈕是否整顆落在可視捲動區與視窗內（≥ 44px 高且未被裁切）。 */
async function measureOpenCardBtnInView(page) {
  return page.evaluate(() => {
    const scroll = document.querySelector('[data-testid="timeline-dual-scroll"]');
    const tip = document.querySelector('[data-testid="timeline-dual-tip"]');
    const btn = document.querySelector('[data-testid="timeline-dual-open-card-btn"]');
    if (!scroll || !tip || !btn) {
      return { ok: false, reason: 'missing-scroll-tip-or-btn' };
    }
    const sr = scroll.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const inScroll =
      br.left >= sr.left - 0.5 &&
      br.right <= sr.right + 0.5 &&
      br.top >= sr.top - 0.5 &&
      br.bottom <= sr.bottom + 0.5;
    const inWindow =
      br.left >= -0.5 &&
      br.right <= vw + 0.5 &&
      br.top >= -0.5 &&
      br.bottom <= vh + 0.5;
    return {
      ok: br.width > 0 && br.height >= 43.5 && inScroll && inWindow,
      inScroll,
      inWindow,
      btn: {
        left: Math.round(br.left),
        right: Math.round(br.right),
        top: Math.round(br.top),
        bottom: Math.round(br.bottom),
        w: Math.round(br.width),
        h: Math.round(br.height),
      },
      tip: { left: Math.round(tr.left), right: Math.round(tr.right), w: Math.round(tr.width) },
      scroll: {
        left: Math.round(sr.left),
        right: Math.round(sr.right),
        top: Math.round(sr.top),
        bottom: Math.round(sr.bottom),
        scrollLeft: Math.round(scroll.scrollLeft),
        scrollWidth: Math.round(scroll.scrollWidth),
        clientWidth: Math.round(scroll.clientWidth),
      },
      vw,
      vh,
    };
  });
}

/** 項目 4：雙軸對照（1440×900 → 1180×820 → 820×1180）。 */
async function verifyItem4DualAxis(browser, seed) {
  const section = '項目4-雙軸對照';
  const { context, page } = await openContext(browser, seed.state, {
    width: 1440,
    height: 900,
    touch: false,
  });
  try {
    await openTimelineViaCards(page, seed.mainPid);
    await page.locator('[data-testid="timeline-tab-dual"]').click({ timeout: 8000 });
    await page.locator('[data-testid="timeline-dual-view"]').waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForTimeout(350);

    // 1. 1440×900：SVG <path> 條數等於事件數（7），起終點誤差 ≤ 2px
    const m1440 = await measureDualAxisLines(page);
    record(
      section,
      '1440×900 SVG path 數等於 7 且起終點與卡片中心誤差 ≤ 2px',
      m1440.ok && m1440.pathCount === 7,
      'pathCount=7, errors=[]',
      `pathCount=${m1440.pathCount}, errors=${JSON.stringify(m1440.errors)}`,
    );

    // 2. 點下排卡片 e3：上下同卡亮起且線寬變 3.5 並置頂
    await page.locator('[data-testid="timeline-dual-bottom-btn-e3"]').click({ timeout: 8000 });
    await page.waitForTimeout(150);
    const selInfo = await page.evaluate(() => {
      const topCard = document.querySelector('[data-testid="timeline-dual-top-card-e3"]');
      const botCard = document.querySelector('[data-testid="timeline-dual-bottom-card-e3"]');
      const pathE3 = document.querySelector('[data-testid="timeline-dual-path-e3"]');
      const paths = [...document.querySelectorAll('[data-testid="timeline-dual-svg"] path[data-testid^="timeline-dual-path-"]')];
      const lastTestId = paths[paths.length - 1]?.getAttribute('data-testid');
      const openBtn = document.querySelector('[data-testid="timeline-dual-open-card-btn"]');
      const tipDetail = document.querySelector('[data-testid="timeline-dual-tip-detail"]')?.textContent || '';
      return {
        topSelected: Boolean(topCard?.classList.contains('is-selected')),
        botSelected: Boolean(botCard?.classList.contains('is-selected')),
        strokeWidth: pathE3?.getAttribute('stroke-width'),
        isLastPath: lastTestId === 'timeline-dual-path-e3',
        openBtnHeight: openBtn ? Math.round(openBtn.getBoundingClientRect().height * 10) / 10 : 0,
        tipDetail,
      };
    });
    record(
      section,
      '點卡上下同卡亮起、線寬變 3.5 置頂且開啟卡片鈕 ≥ 44px',
      selInfo.topSelected &&
        selInfo.botSelected &&
        selInfo.strokeWidth === '3.5' &&
        selInfo.isLastPath &&
        selInfo.openBtnHeight >= 43.5 &&
        selInfo.tipDetail.includes('周嫂在湯裡下了安眠藥'),
      'top=true, bot=true, strokeWidth=3.5, isLastPath=true, openBtn>=44',
      JSON.stringify(selInfo),
    );
    const openBtnInView1440 = await measureOpenCardBtnInView(page);
    record(
      section,
      '1440×900 點完整可見下排卡片後「開啟卡片」按鈕整顆在可視範圍內',
      openBtnInView1440.ok,
      'ok=true, inScroll=true, inWindow=true',
      JSON.stringify(openBtnInView1440),
    );
    await capture(page, 'item4-dual-1440x900');

    // 3. 從 1440×900 縮到 1180×820：座標自動重算無偏移（誤差 ≤ 2px 且橫座標隨寬度更新）
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.waitForTimeout(450);
    const layout1180 = await page.evaluate(() => document.documentElement.dataset.layout);
    const m1180 = await measureDualAxisLines(page);
    const coordChanged =
      m1440.coords.e7 && m1180.coords.e7 && m1440.coords.e7.x1 !== m1180.coords.e7.x1;
    record(
      section,
      '縮到 1180×820 維持雙軸對照、座標自動重算且誤差 ≤ 2px',
      layout1180 === 'wide' && m1180.ok && m1180.pathCount === 7 && Boolean(coordChanged),
      'layout=wide, pathCount=7, errors=[], coordChanged=true',
      `layout=${layout1180}, pathCount=${m1180.pathCount}, coordChanged=${coordChanged}, errors=${JSON.stringify(m1180.errors)}`,
    );

    // 3b. 1180×820 實際點擊完整可見的最右側下排卡片後，「開啟卡片」按鈕整顆在可視範圍內
    const visibleBottomIds1180 = await page.evaluate(() => {
      const scroll = document.querySelector('[data-testid="timeline-dual-scroll"]');
      if (!scroll) return [];
      const sr = scroll.getBoundingClientRect();
      return [...document.querySelectorAll('[data-testid^="timeline-dual-bottom-btn-"]')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.width > 0 &&
            r.height > 0 &&
            r.left >= sr.left + 1 &&
            r.right <= sr.right - 1 &&
            r.top >= sr.top + 1 &&
            r.bottom <= sr.bottom - 1
          );
        })
        .map((el) => el.getAttribute('data-testid')?.replace('timeline-dual-bottom-btn-', '') || '')
        .filter(Boolean);
    });
    const firstVisibleId = visibleBottomIds1180[0] || '';
    const rightmostVisibleId = visibleBottomIds1180[visibleBottomIds1180.length - 1] || '';
    if (firstVisibleId && rightmostVisibleId && firstVisibleId !== rightmostVisibleId) {
      await page.locator(`[data-testid="timeline-dual-bottom-btn-${firstVisibleId}"]`).click({ timeout: 8000 });
      await page.waitForTimeout(100);
    }
    if (rightmostVisibleId) {
      await page.locator(`[data-testid="timeline-dual-bottom-btn-${rightmostVisibleId}"]`).click({ timeout: 8000 });
      await page.waitForTimeout(150);
    }
    const openBtnInView1180 = rightmostVisibleId
      ? await measureOpenCardBtnInView(page)
      : { ok: false, reason: 'no-visible-bottom-card' };
    record(
      section,
      '1180×820 點完整可見下排卡片後「開啟卡片」按鈕整顆在可視範圍內',
      Boolean(rightmostVisibleId) && openBtnInView1180.ok,
      'rightmostVisibleId!=empty, ok=true, inScroll=true, inWindow=true',
      `clicked=${rightmostVisibleId}, ${JSON.stringify(openBtnInView1180)}`,
    );
    await capture(page, 'item4-dual-1180x820');

    // 4. 縮到 820×1180（medium）：自動退出雙軸對照，回到故事順序
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.waitForTimeout(450);
    const afterNarrow = await page.evaluate(() => ({
      layout: document.documentElement.dataset.layout,
      hasDualView: Boolean(document.querySelector('[data-testid="timeline-dual-view"]')),
      hasDualTab: Boolean(document.querySelector('[data-testid="timeline-tab-dual"]')),
      hasStoryView: Boolean(document.querySelector('[data-testid="timeline-story-view"]')),
    }));
    record(
      section,
      '縮到 820×1180 自動退出雙軸對照並退回故事順序',
      afterNarrow.layout === 'medium' &&
        !afterNarrow.hasDualView &&
        !afterNarrow.hasDualTab &&
        afterNarrow.hasStoryView,
      'layout=medium, dual=false, story=true',
      JSON.stringify(afterNarrow),
    );
    await capture(page, 'item4-resize-exit-to-medium-820x1180');
  } finally {
    await context.close();
  }
}

/** 項目 5：三套主題（forest / celadon / classic）皆無文字不可辨識或透明色漏底。 */
async function inspectThemeContrastAndOpaque(page) {
  return page.evaluate(() => {
    const parseColor = (str) => {
      const m = /rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*([\d.]+))?\s*\)/.exec(
        str || '',
      );
      if (!m) return null;
      return {
        r: Number(m[1]),
        g: Number(m[2]),
        b: Number(m[3]),
        a: m[4] === undefined ? 1 : Number(m[4]),
      };
    };
    const compositeOver = (fg, bg) => {
      const a = fg.a + bg.a * (1 - fg.a);
      if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
        g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
        b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
        a,
      };
    };
    const relLuminance = ({ r, g, b }) => {
      const toLin = (v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
    };
    const contrast = (c1, c2) => {
      const l1 = relLuminance(c1);
      const l2 = relLuminance(c2);
      const hi = Math.max(l1, l2);
      const lo = Math.min(l1, l2);
      return (hi + 0.05) / (lo + 0.05);
    };
    const effectiveBg = (el) => {
      const stack = [];
      let cur = el;
      while (cur && cur.nodeType === 1) {
        const bg = parseColor(getComputedStyle(cur).backgroundColor);
        if (bg && bg.a > 0) stack.push(bg);
        cur = cur.parentElement;
      }
      let out = { r: 0, g: 0, b: 0, a: 1 };
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        out = compositeOver(stack[i], out);
      }
      return out;
    };

    // 1. 檢查應為不透明底色的結構容器不得透底
    const opaqueSelectors = [
      '.timeline-page',
      '.timeline-topbar',
      '.timeline-seg',
      '.timeline-story-card',
      '.timeline-reading-card:not(.is-unassigned)',
      '.timeline-dual-card:not(.is-unassigned)',
      '.timeline-dual-tip',
    ];
    const transparentLeaks = [];
    for (const sel of opaqueSelectors) {
      for (const el of document.querySelectorAll(sel)) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const bg = parseColor(getComputedStyle(el).backgroundColor);
        if (!bg || bg.a < 0.95) {
          transparentLeaks.push({ sel, bg: getComputedStyle(el).backgroundColor });
        }
      }
    }

    // 2. 檢查所有可見文字對比度是否可辨識（≥ 3.0）
    const textSelectors = [
      '.timeline-heading',
      '.timeline-book-crumb',
      '.timeline-add-btn',
      '.timeline-seg button',
      '.timeline-hint',
      '.timeline-card-when',
      '.timeline-card-title',
      '.timeline-chip',
      '.timeline-reading-chapter-lead',
      '.timeline-reading-chapter-sub',
      '.timeline-reading-order',
      '.timeline-reading-title',
      '.timeline-dual-row-title',
      '.timeline-dual-row-desc',
      '.timeline-dual-order',
      '.timeline-dual-title',
      '.timeline-dual-tip-intro',
      '.timeline-dual-tip-detail',
      '.timeline-dual-open-btn',
      '.timeline-dual-footer',
    ];
    const lowContrast = [];
    let checkedText = 0;
    for (const sel of textSelectors) {
      for (const el of document.querySelectorAll(sel)) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const text = (el.textContent || '').trim();
        if (!text) continue;
        const fg = parseColor(getComputedStyle(el).color);
        if (!fg || fg.a < 0.5) {
          lowContrast.push({ sel, text: text.slice(0, 20), ratio: 0, reason: 'transparent-fg' });
          continue;
        }
        const bg = effectiveBg(el);
        const fgComp = fg.a < 1 ? compositeOver(fg, bg) : fg;
        const ratio = Math.round(contrast(fgComp, bg) * 100) / 100;
        checkedText += 1;
        if (ratio < 3.0) {
          lowContrast.push({ sel, text: text.slice(0, 20), ratio });
        }
      }
    }

    return {
      theme: document.documentElement.dataset.theme || '',
      checkedText,
      transparentLeaks,
      lowContrast,
    };
  });
}

async function verifyItem5Themes(browser, seed) {
  for (const theme of THEMES) {
    const section = `項目5-主題-${theme}`;
    const { context, page } = await openContext(browser, seed.state, {
      width: 1440,
      height: 900,
      touch: false,
      theme: 'forest',
    });
    try {
      // 透過設定頁 UI 實際切換主題（確保主題切換流程也一併驗證）
      await page.goto(`${BASE}/p/${seed.mainPid}/settings`, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.locator('[data-testid="settings-screen"]').waitFor({ state: 'visible', timeout: 15000 });
      await page.locator(`[data-testid="theme-option-${theme}"]`).click({ timeout: 8000 });
      await page.waitForTimeout(150);

      // 進時間線檢查三種模式
      await openTimelineViaNavCards(page);
      await page.locator('[data-testid="timeline-story-view"]').waitFor({ state: 'visible', timeout: 10000 });

      const storyTheme = await inspectThemeContrastAndOpaque(page);
      record(
        section,
        '故事順序無透明漏底與文字低對比',
        storyTheme.theme === theme &&
          storyTheme.checkedText > 0 &&
          storyTheme.transparentLeaks.length === 0 &&
          storyTheme.lowContrast.length === 0,
        `theme=${theme}, leaks=[], lowContrast=[]`,
        JSON.stringify(storyTheme),
      );

      await page.locator('[data-testid="timeline-tab-reading"]').click({ timeout: 8000 });
      await page.locator('[data-testid="timeline-reading-view"]').waitFor({ state: 'visible', timeout: 8000 });
      const readingTheme = await inspectThemeContrastAndOpaque(page);
      record(
        section,
        '章節順序無透明漏底與文字低對比',
        readingTheme.theme === theme &&
          readingTheme.checkedText > 0 &&
          readingTheme.transparentLeaks.length === 0 &&
          readingTheme.lowContrast.length === 0,
        `theme=${theme}, leaks=[], lowContrast=[]`,
        JSON.stringify(readingTheme),
      );

      await page.locator('[data-testid="timeline-tab-dual"]').click({ timeout: 8000 });
      await page.locator('[data-testid="timeline-dual-view"]').waitFor({ state: 'visible', timeout: 8000 });
      await page.waitForTimeout(250);
      const dualTheme = await inspectThemeContrastAndOpaque(page);
      record(
        section,
        '雙軸對照無透明漏底與文字低對比',
        dualTheme.theme === theme &&
          dualTheme.checkedText > 0 &&
          dualTheme.transparentLeaks.length === 0 &&
          dualTheme.lowContrast.length === 0,
        `theme=${theme}, leaks=[], lowContrast=[]`,
        JSON.stringify(dualTheme),
      );
      await capture(page, `item5-theme-${theme}-dual`);
    } finally {
      await context.close();
    }
  }
}

async function main() {
  let pw;
  try {
    pw = loadPlaywright();
  } catch (err) {
    const out = {
      work_order: 'WO-128',
      base: BASE,
      generated_at: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
      summary: { passed: 0, failed: 1 },
      results: [],
      screenshots: [],
    };
    fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(out, null, 2));
    console.error(out.error);
    process.exit(2);
  }

  const launchOpts = { headless: HEADLESS, args: ['--no-sandbox', '--disable-setuid-sandbox'] };
  const exe = chromiumPath();
  if (exe && fs.existsSync(exe)) {
    launchOpts.executablePath = exe;
  }

  const browser = await pw.chromium.launch(launchOpts);
  try {
    const seed = await createFogHotelSeed(browser);
    await verifyItem1Layouts(browser, seed);
    await verifyItem2DragAndAccessibleMove(browser, seed);
    await verifyItem3CardJumpAndDeleteChapterVolume(browser, seed);
    await verifyItem4DualAxis(browser, seed);
    await verifyItem5Themes(browser, seed);
  } catch (err) {
    record('執行', '腳本執行中斷', false, '完整執行完畢', err instanceof Error ? err.stack || err.message : String(err));
  } finally {
    await browser.close().catch(() => {});
  }

  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const report = {
    work_order: 'WO-128',
    base: BASE,
    generated_at: new Date().toISOString(),
    summary: { passed, failed },
    screenshots,
    results,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\nWO-128 四版面量測完成：通過 ${passed}、失敗 ${failed}；輸出於 ${OUT_DIR}`);
  process.exit(failed > 0 || passed === 0 ? 1 : 0);
}

main();
