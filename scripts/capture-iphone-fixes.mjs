/**
 * 補截：鍵盤開啟的寫作畫面、章展開／收合、新增幕。
 * PLAYWRIGHT_MODULE=/tmp/pw/node_modules/playwright/index.js node scripts/capture-iphone-fixes.mjs
 */
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

const playwrightModule = process.env.PLAYWRIGHT_MODULE ?? 'playwright';
const imported = await import(playwrightModule);
const playwright = imported.webkit ? imported : imported.default;
const { webkit, devices } = playwright;

const base = process.env.SAMPLE_URL ?? 'http://127.0.0.1:4173';
const outDir = path.resolve('docs/samples/iphone-390x844');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await webkit.launch();
const iphone = devices['iPhone 13'];
const context = await browser.newContext({
  ...iphone,
  viewport: { width: 390, height: 844 },
  screen: { width: 390, height: 844 },
  locale: 'zh-TW',
});
await context.addInitScript(() => {
  const apply = () => {
    const root = document.documentElement;
    if (!root) return;
    root.style.setProperty('--force-safe-top', '47px');
    root.style.setProperty('--force-safe-bottom', '34px');
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
});
const page = await context.newPage();

async function shot(name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(outDir, name) });
}

await mkdir(outDir, { recursive: true });
await page.goto(`${base}/p/fog/write`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '收合第二章　燈塔' }).waitFor();
await shot('11-章展開.png');

await page.getByRole('button', { name: '收合第一卷　霧港（示範）' }).click();
await page.getByRole('button', { name: '第一章　來信', exact: true }).waitFor({ state: 'hidden' });
await page.getByRole('button', { name: '展開第一卷　霧港（示範）' }).click();
await page.getByRole('button', { name: '第一章　來信', exact: true }).waitFor();

await page.getByRole('button', { name: '收合第二章　燈塔' }).click();
await page.getByRole('button', { name: '幕 1　上坡', exact: true }).waitFor({ state: 'hidden' });
assert(await page.getByRole('button', { name: '展開第二章　燈塔' }).count(), '收合後箭頭不見了');
await shot('12-章收合.png');

await page.getByRole('button', { name: '第三章　舊照片的更多操作' }).click();
await page.getByRole('button', { name: '在此章新增幕' }).click();
await page.getByRole('button', { name: '幕 1　新幕', exact: true }).waitFor();
await page.waitForFunction(() => localStorage.getItem('jiufang-novel-m.outline.v1')?.includes('幕 1　新幕'));
await page.reload({ waitUntil: 'networkidle' });
await page.getByRole('button', { name: '幕 1　新幕', exact: true }).waitFor();
await shot('13-新增幕.png');

await page.goto(`${base}/p/fog/write/ch-1`, { waitUntil: 'networkidle' });
await page.getByTestId('writing-input').click();
await page.evaluate(() => {
  document.documentElement.dataset.forceKeyboard = '1';
  document.documentElement.style.setProperty('--vv-height', '524px');
  window.dispatchEvent(new Event('jiufang-keyboard-sim'));
});
await page.getByTestId('daily-progress').waitFor();
await page.waitForFunction(() => document.documentElement.classList.contains('keyboard-open'));
assert((await page.getByTestId('daily-progress').getAttribute('data-compact')) === 'true', '鍵盤開啟時進度區沒有收合');
assert(await page.getByTestId('bottom-nav').isHidden(), '鍵盤開啟時底部分頁還在');
await shot('10-寫作-鍵盤開啟.png');

console.log('shots ok');
await browser.close();
