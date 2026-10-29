/**
 * 手機橫放：鍵盤收起與鍵盤開著各一張。只用範例正文，不另外打字。
 * NODE_PATH=/tmp/pw/node_modules node scripts/capture-landscape-writing.mjs
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const playwrightModule = process.env.PLAYWRIGHT_MODULE ?? 'playwright';
const imported = await import(playwrightModule);
const playwright = imported.webkit ? imported : imported.default;
const { webkit, devices } = playwright;

const base = process.env.SAMPLE_URL ?? 'http://127.0.0.1:4173';
const outDir = path.resolve('docs/samples/iphone-landscape-844x390');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await webkit.launch();
const iphone = devices['iPhone 13'];
const context = await browser.newContext({
  ...iphone,
  viewport: { width: 844, height: 390 },
  screen: { width: 844, height: 390 },
  locale: 'zh-TW',
  timezoneId: 'Asia/Taipei',
});
const page = await context.newPage();
await mkdir(outDir, { recursive: true });

async function shot(name) {
  await page.evaluate(() => document.fonts.ready);
  const file = path.join(outDir, name);
  await page.screenshot({ path: file });
  return file;
}

await page.goto(`${base}/p/fog/write/ch-1`, { waitUntil: 'networkidle' });
await page.getByTestId('writing-input').waitFor();
const closed = await page.evaluate(() => ({
  landscape: document.documentElement.classList.contains('landscape-writing'),
  rail: getComputedStyle(document.querySelector('[data-testid="nav-rail"]')).display,
  tree: getComputedStyle(document.querySelector('[data-testid="chapter-tree"]')).display,
  title: getComputedStyle(document.querySelector('[data-testid="editor"] .topbar')).display,
  status: getComputedStyle(document.querySelector('[data-testid="status-bar"]')).display,
}));
assert(!closed.landscape, '還沒打字不該進入橫放寫作');
assert(closed.rail !== 'none' && closed.tree !== 'none' && closed.title !== 'none' && closed.status !== 'none', `鍵盤收起時欄位不該藏：${JSON.stringify(closed)}`);
const closedShot = await shot('01-橫放-鍵盤收起.png');

const input = page.getByTestId('writing-input');
await input.click();
await page.evaluate(() => {
  document.documentElement.dataset.forceKeyboard = '1';
  document.documentElement.style.setProperty('--vv-height', '168px');
  window.dispatchEvent(new Event('jiufang-keyboard-sim'));
});
await page.waitForFunction(() => document.documentElement.classList.contains('landscape-writing'));
const open = await page.evaluate(() => {
  const textarea = document.querySelector('[data-testid="writing-input"]');
  const shell = document.querySelector('.app-shell');
  return {
    rail: getComputedStyle(document.querySelector('[data-testid="nav-rail"]')).display,
    tree: getComputedStyle(document.querySelector('[data-testid="chapter-tree"]')).display,
    title: getComputedStyle(document.querySelector('[data-testid="editor"] .topbar')).display,
    status: getComputedStyle(document.querySelector('[data-testid="status-bar"]')).display,
    inputHeight: textarea.getBoundingClientRect().height,
    shellHeight: shell.getBoundingClientRect().height,
    value: textarea.value,
  };
});
assert(open.rail === 'none' && open.tree === 'none' && open.title === 'none' && open.status === 'none', `鍵盤開著時周圍的欄還在：${JSON.stringify(open)}`);
assert(open.value.includes('【範例】'), '樣品只用範例正文');
assert(open.inputHeight > open.shellHeight * 0.7, `正文沒有佔滿可見區：${JSON.stringify(open)}`);
const openShot = await shot('02-橫放-鍵盤開著.png');

await browser.close();
console.log(JSON.stringify({ closedShot, openShot, open }, null, 2));
