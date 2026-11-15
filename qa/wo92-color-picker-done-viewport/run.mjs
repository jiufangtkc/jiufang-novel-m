/**
 * WO-92：資料集卡片編輯 → 挑色，量測「完成」在視窗內且可點（elementFromPoint）。
 * 環境：BASE（預設 http://127.0.0.1:4173）、PLAYWRIGHT_MODULE、CHROMIUM_PATH。
 */
import { chromiumPath, loadPlaywright } from '../playwright-env.mjs';

const VIEWPORTS = [
  { name: 'phone-portrait-390x844', width: 390, height: 844, touch: true },
  { name: 'phone-landscape-844x390', width: 844, height: 390, touch: true },
  { name: 'medium-900x900', width: 900, height: 900, touch: false },
  { name: 'wide-1280x900', width: 1280, height: 900, touch: false },
  { name: 'wide-1920x900', width: 1920, height: 900, touch: false },
];

const BASE = (process.env.BASE || 'http://127.0.0.1:4173').replace(/\/$/, '');

async function tapOrClick(page, locator, touch) {
  if (touch) {
    await locator.first().tap({ timeout: 8000 });
  } else {
    await locator.first().click({ timeout: 8000 });
  }
}

async function openDatasetColorPicker(page, touch) {
  await page.goto(`${BASE}/p/fog/cards`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('[data-testid="cards-screen"]', { timeout: 15000 }).catch(() => null);

  const cat =
    (await page.locator('[data-testid="category-row-character"]').first().isVisible().catch(() => false))
      ? page.locator('[data-testid="category-row-character"]').first()
      : page.locator('[data-testid^="category-row-"]').first();

  await cat.waitFor({ state: 'visible', timeout: 8000 });
  await tapOrClick(page, cat, touch);
  await page.waitForTimeout(500);

  const card = page.locator('[data-testid^="card-select-"]').first();
  await card.waitFor({ state: 'visible', timeout: 8000 });
  await tapOrClick(page, card, touch);
  await page.waitForTimeout(500);

  const editPortrait = page.locator('[data-testid="card-editor-start-edit-btn"]').first();
  const editHeader = page.locator('[data-testid="card-editor-start-edit-btn"], .card-editor-edit-btn').first();
  if (await editPortrait.isVisible().catch(() => false)) {
    await tapOrClick(page, editPortrait, touch);
  } else if (await editHeader.isVisible().catch(() => false)) {
    await tapOrClick(page, editHeader, touch);
  } else {
    throw new Error('找不到「編輯」按鈕');
  }
  await page.waitForTimeout(400);

  const colorBtn = page.locator('[data-testid="card-editor-color-btn"]').first();
  await colorBtn.waitFor({ state: 'visible', timeout: 8000 });
  await tapOrClick(page, colorBtn, touch);

  await page.locator('[data-testid="color-action-done"]').first().waitFor({ state: 'visible', timeout: 8000 });
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

export async function runViewportChecks() {
  const { chromium } = loadPlaywright();
  const launchOpts = { headless: true };
  const cp = chromiumPath();
  if (cp) {
    launchOpts.executablePath = cp;
  }
  const browser = await chromium.launch(launchOpts);
  const failures = [];

  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        hasTouch: vp.touch,
        isMobile: vp.touch,
        locale: 'zh-TW',
      });
      const page = await context.newPage();
      try {
        await openDatasetColorPicker(page, vp.touch);
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