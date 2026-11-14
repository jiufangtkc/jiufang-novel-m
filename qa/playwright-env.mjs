/**
 * 供 qa 腳本載入 Playwright，不把本機安裝路徑寫死在個別測試裡。
 *
 * 環境變數（與 scripts/ 目錄既有截圖腳本相同習慣）：
 *   PLAYWRIGHT_MODULE  Playwright 模組路徑（例如 playwright 套件的 index.js）
 *   CHROMIUM_PATH 或 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
 *                      選用，指定 Chromium 執行檔；未設則由 Playwright 自行尋找
 */
import { createRequire } from 'node:module';
import path from 'node:path';

export function loadPlaywright() {
  const modulePath = process.env.PLAYWRIGHT_MODULE;
  if (modulePath) {
    const hint = modulePath.endsWith('.js') || modulePath.endsWith('.mjs')
      ? modulePath
      : path.join(modulePath, 'package.json');
    const req = createRequire(hint);
    return req(modulePath.endsWith('.js') || modulePath.endsWith('.mjs') ? modulePath : 'playwright');
  }
  try {
    return createRequire(import.meta.url)('playwright');
  } catch (err) {
    const error = new Error('找不到 Playwright。請設定 PLAYWRIGHT_MODULE（與 scripts/ 目錄既有腳本相同），指向本機 playwright 套件。');
    error.cause = err;
    throw error;
  }
}

export function chromiumPath() {
  return process.env.CHROMIUM_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '';
}
