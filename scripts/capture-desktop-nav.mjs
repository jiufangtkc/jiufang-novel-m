/**
 * 電腦寬度下左側選單（含「檔案」分頁）。
 * 執行：NODE_PATH=/tmp/pw/node_modules node scripts/capture-desktop-nav.mjs
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const playwrightModule = process.env.PLAYWRIGHT_MODULE ?? 'playwright';
const imported = await import(playwrightModule);
const playwright = imported.chromium ? imported : imported.default;
const { chromium } = playwright;

const base = process.env.SAMPLE_URL ?? 'http://127.0.0.1:4173';
const outDir = path.resolve('docs/samples/desktop-1280');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW' });
await mkdir(outDir, { recursive: true });
await page.goto(`${base}/p/fog/write`, { waitUntil: 'networkidle' });
await page.getByTestId('nav-rail').waitFor();
await page.evaluate(() => document.fonts.ready);
const file = path.join(outDir, '01-左側選單.png');
await page.screenshot({ path: file });
console.log(JSON.stringify({ file }));
await browser.close();
