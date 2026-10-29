/**
 * 用 WebKit 證明：第一次打開並等服務程式存好之後，伺服器真的連不上，
 * 重新載入首頁與寫作畫面仍然打得開、打得了字、芫荽還在。
 *
 * 不使用瀏覽器的「模擬斷線」。這個環境的 WebKit 一模擬斷線，
 * 連沒有服務程式的空白頁也會內部錯誤，測不到快取。
 *
 * 執行：node scripts/offline-webkit.mjs
 * Playwright 模組：PLAYWRIGHT_MODULE=/tmp/pw/node_modules/playwright/index.js
 */
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const port = 4179;
const base = `http://127.0.0.1:${port}`;
const playwrightModule = process.env.PLAYWRIGHT_MODULE ?? 'playwright';
const imported = await import(playwrightModule);
const playwright = imported.webkit ? imported : imported.default;
const { webkit, devices } = playwright;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const preview = spawn(
  'npx',
  ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'] },
);
let previewLog = '';
preview.stdout.on('data', (chunk) => {
  previewLog += chunk;
});
preview.stderr.on('data', (chunk) => {
  previewLog += chunk;
});

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    try {
      const response = await fetch(base);
      if (response.ok) return;
    } catch {
      // 伺服器還沒起來
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`預覽伺服器沒有起來：${previewLog.slice(-500)}`);
}

const browser = await webkit.launch();
const iphone = devices['iPhone 13'];
const context = await browser.newContext({
  ...iphone,
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();

try {
  await waitForServer();
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '九方小說編輯器M' }).waitFor();
  await page.waitForFunction(
    async () => {
      const registration = await navigator.serviceWorker?.ready;
      if (registration?.active?.state !== 'activated') return false;
      let fonts = 0;
      for (const name of await caches.keys()) {
        const keys = await (await caches.open(name)).keys();
        fonts += keys.filter((request) => request.url.includes('.woff2')).length;
      }
      return fonts >= 300;
    },
    null,
    { timeout: 60000 },
  );

  function stopPreview() {
    try {
      execSync(`pkill -f "vite preview --host 127.0.0.1 --port ${port}"`);
    } catch {
      // 沒有剩行程也沒關係
    }
    if (!preview.killed) preview.kill('SIGTERM');
  }
  stopPreview();
  let serverGone = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await fetch(base);
    } catch {
      serverGone = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert(serverGone, '伺服器還連得上，這個測試不能代表斷網');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 8000 });
  await page.getByRole('heading', { name: '九方小說編輯器M' }).waitFor();
  const homeFont = await page.evaluate(() => document.fonts.check('18px Iansui', '九方小說編輯器'));
  assert(homeFont, '斷網後首頁不是芫荽');

  await page.goto(`${base}/p/fog/write/ch-1`, { waitUntil: 'domcontentloaded', timeout: 8000 });
  const input = page.getByTestId('writing-input');
  await input.waitFor();
  await page.getByRole('heading', { name: '第一章　來信' }).waitFor();
  const before = await input.inputValue();
  await input.click();
  await input.evaluate((element) => {
    element.setSelectionRange(element.value.length, element.value.length);
  });
  await input.pressSequentially('測', { delay: 30 });
  const after = await input.inputValue();
  assert(after === `${before}測`, '斷網後寫作畫面打不了字');
  const writingFont = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('16px Iansui', '霧氣自港口緩緩爬上石階測');
  });
  assert(writingFont, '斷網後寫作畫面的正文不是芫荽');

  console.log(JSON.stringify({ ok: true, homeFont, writingFont, typed: true }, null, 2));
} finally {
  await browser.close();
  try {
    execSync(`pkill -f "vite preview --host 127.0.0.1 --port ${port}"`);
  } catch {
    // 已經關掉
  }
}
