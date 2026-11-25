/**
 * WO-92：資料集卡片編輯 → 挑色，量測「完成」在視窗內且可點（elementFromPoint）。
 * 環境：BASE（預設 http://127.0.0.1:4173）、PLAYWRIGHT_MODULE、CHROMIUM_PATH。
 */
import { loadPlaywright, resolveChromiumExecutable } from '../playwright-env.mjs';

const VIEWPORTS = [
  { name: 'phone-portrait-390x844', width: 390, height: 844, touch: true },
  { name: 'phone-landscape-844x390', width: 844, height: 390, touch: true },
  { name: 'medium-900x900', width: 900, height: 900, touch: false },
  { name: 'wide-1280x900', width: 1280, height: 900, touch: false },
  { name: 'wide-1920x900', width: 1920, height: 900, touch: false },
];

const SAMPLE_BOOK_ID = 'wo92-sample-book';
const SAMPLE_CARD_ID = 'card-wo92-1';
const SAMPLE_PROJECTS = [
  {
    id: SAMPLE_BOOK_ID,
    title: '【範例】挑色視口量測',
    updatedLabel: '剛剛',
    bookGoal: 50000,
    shape: 'novel',
    nodes: [
      {
        id: 'ch-wo92-1',
        type: 'file',
        title: '第一章　測試',
        progress: 'Draft',
        content: '【範例】量測用假正文。',
        expanded: true,
      },
    ],
    cards: [
      {
        id: SAMPLE_CARD_ID,
        parent_id: null,
        category: 'character',
        title: '【範例】沈雨晴',
        content: '【範例】測試角色卡片內容',
        color: '#3C3F41',
        is_collapsed: 0,
        sort_order: 1,
      },
    ],
  },
];

async function seedSampleStorage(context) {
  await context.addInitScript(
    ({ projectsJson, onboardingJson }) => {
      try {
        window.localStorage.setItem('jiufang-novel-m.outline.v1', projectsJson);
        window.localStorage.setItem('jiufang-novel-m.onboarding.v1', onboardingJson);
        window.localStorage.setItem('jiufang-novel-m.whats-new-seen.v1', '999.0.0');
      } catch {
        // ignore
      }
    },
    {
      projectsJson: JSON.stringify(SAMPLE_PROJECTS),
      onboardingJson: JSON.stringify({ status: 'done', at: '2026-11-21T00:00:00+08:00' }),
    },
  );
}

async function tapOrClick(page, locator, touch) {
  if (touch) {
    await locator.first().tap({ timeout: 8000 });
  } else {
    await locator.first().click({ timeout: 8000 });
  }
}

async function openDatasetColorPicker(page, touch, baseUrl) {
  await page.goto(`${baseUrl}/p/${SAMPLE_BOOK_ID}/cards`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('[data-testid="cards-screen"]').first().waitFor({ state: 'visible', timeout: 15000 });

  const cat = page.locator('[data-testid="category-row-character"]').first();
  await cat.waitFor({ state: 'visible', timeout: 10000 });
  await tapOrClick(page, cat, touch);

  const card = page.locator(`[data-testid="card-select-${SAMPLE_CARD_ID}"]`).first();
  await card.waitFor({ state: 'visible', timeout: 10000 });
  await tapOrClick(page, card, touch);

  const editBtn = page.locator('[data-testid="card-editor-start-edit-btn"], .card-editor-edit-btn').first();
  await editBtn.waitFor({ state: 'visible', timeout: 10000 });
  await tapOrClick(page, editBtn, touch);

  const colorBtn = page.locator('[data-testid="card-editor-color-btn"]').first();
  await colorBtn.waitFor({ state: 'visible', timeout: 10000 });
  await tapOrClick(page, colorBtn, touch);

  await page.locator('[data-testid="color-action-done"]').first().waitFor({ state: 'visible', timeout: 10000 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

export async function measureColorDoneInViewport(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="color-action-done"]');
    if (!el) {
      return { ok: false, reason: 'no-done-button' };
    }
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const inViewport =
      rect.top >= -0.5 &&
      rect.left >= -0.5 &&
      rect.bottom <= vh + 0.5 &&
      rect.right <= vw + 0.5;
    const cx = Math.min(Math.max(rect.left + rect.width / 2, 1), vw - 1);
    const cy = Math.min(Math.max(rect.top + rect.height / 2, 1), vh - 1);
    const hit = document.elementFromPoint(cx, cy);
    const notCovered = hit === el || (hit instanceof Node && el.contains(hit));
    return {
      ok: inViewport && notCovered,
      inViewport,
      notCovered,
      bottom: rect.bottom,
      top: rect.top,
      vh,
      vw,
      hitTag: hit && 'tagName' in hit ? hit.tagName : null,
    };
  });
}

export async function runViewportChecks(options = {}) {
  const baseUrl = (options.baseUrl || process.env.BASE || 'http://127.0.0.1:4173').replace(/\/$/, '');
  const pw = loadPlaywright();
  const launchOpts = { headless: true, args: ['--no-sandbox'] };
  const cp = resolveChromiumExecutable(pw);
  if (cp) {
    launchOpts.executablePath = cp;
  }
  const browser = await pw.chromium.launch(launchOpts);
  const failures = [];

  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        hasTouch: vp.touch,
        isMobile: vp.touch,
        locale: 'zh-TW',
      });
      await seedSampleStorage(context);
      const page = await context.newPage();
      try {
        await openDatasetColorPicker(page, vp.touch, baseUrl);
        const result = await measureColorDoneInViewport(page);
        if (!result.ok) {
          failures.push({ viewport: vp.name, ...result });
        }
      } catch (err) {
        failures.push({ viewport: vp.name, ok: false, reason: err instanceof Error ? err.message : String(err) });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  return failures;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (isMain || process.env.WO92_COLOR_PICKER_VIEWPORT_MAIN === '1') {
  runViewportChecks()
    .then((failures) => {
      if (failures.length > 0) {
        console.error(JSON.stringify(failures, null, 2));
        process.exit(1);
      }
      console.log('WO-92 挑色「完成」視窗內檢查：全部通過');
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
