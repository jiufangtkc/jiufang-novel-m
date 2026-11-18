/**
 * WO-121：真選檔。有頭 Chromium + Xvfb + xdotool。
 * 用法：DISPLAY=:78 node qa/wo121-open-without-permission/run.cjs [BASE] [FILE] [OUT_DIR] [act]
 * act 預設 none：選完檔不要去點權限小視窗，應直接進入寫作頁。
 * 只用假 .db。不屬 npm test。
 */
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = (process.argv[2] || 'http://127.0.0.1:4325').replace(/\/$/, '');
const FILE = process.argv[3];
const OUT = process.argv[4] || path.resolve(__dirname, '../../../_delivery/qa-run');
const ACT = process.argv[5] || 'none';
const CHROME = process.env.CHROMIUM_PATH || '/home/box/.cache/ms-playwright/chromium-1148/chrome-linux/chrome';

if (!FILE || !fs.existsSync(FILE)) {
  console.error('需要一個存在的假 .db 路徑');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

const sh = (c) => {
  try {
    return execSync(c, { env: { ...process.env }, encoding: 'utf8' }).toString().trim();
  } catch {
    return '';
  }
};

(async () => {
  const logs = [];
  const rec = (item, ok, expected, actual) => {
    logs.push({ item, ok, expected, actual });
    console.log(`${ok ? '通過' : '失敗'} ${item} :: 預期 ${expected} / 實際 ${actual}`);
  };

  const browser = await chromium.launch({
    headless: false,
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    args: ['--window-size=1440,900', '--disable-gpu'],
  });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 800 } })).newPage();
  const consoleLines = [];
  page.on('console', (m) => consoleLines.push(`[console.${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message}`));

  await page.addInitScript(() => {
    window.addEventListener('unhandledrejection', (ev) => {
      console.error('UNHANDLED', String(ev.reason && (ev.reason.stack || ev.reason)));
    });
    const real = window.showOpenFilePicker;
    window.showOpenFilePicker = async (o) => {
      console.log('picker called');
      const r = await real.call(window, o);
      const h = r[0];
      if (h && h.requestPermission) {
        const orig = h.requestPermission.bind(h);
        h.requestPermission = async (d) => {
          console.log('requestPermission start', JSON.stringify(d));
          try {
            const s = await orig(d);
            console.log('requestPermission ->', s);
            return s;
          } catch (e) {
            console.log('requestPermission threw', e.name, e.message);
            throw e;
          }
        };
      }
      console.log('picker resolved', r.length, h && h.name);
      return r;
    };
  });

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const skip = page.locator('.welcome-skip').first();
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.waitForSelector('[data-testid="home-screen"]', { timeout: 20000 });

  await page.getByRole('button', { name: /開啟稿子/ }).first().click();
  let win = '';
  for (let i = 0; i < 40 && !win; i++) {
    await page.waitForTimeout(250);
    win = sh("xdotool search --name '^(Open File|開啟檔案|Open)$' | head -1");
  }
  logs.push({ item: '選檔視窗', ok: Boolean(win), expected: '出現', actual: win || '無' });
  console.log(`${win ? '通過' : '失敗'} 選檔視窗 :: ${win || '無'}`);

  if (win) {
    sh(`xdotool windowactivate --sync ${win}; xdotool key --window ${win} ctrl+l`);
    await page.waitForTimeout(400);
    sh(`xdotool type --delay 20 '${FILE}'`);
    await page.waitForTimeout(300);
    sh(`xdotool key Return`);
  }

  // 不要去點權限小視窗，等寫作頁出現
  let opened = false;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    if (/\/p\/[^/]+\/write/.test(page.url())) {
      opened = true;
      break;
    }
  }

  const shot = (name) => path.join(OUT, name);
  sh(`ffmpeg -loglevel error -y -f x11grab -video_size 1600x1000 -i ${process.env.DISPLAY} -frames:v 1 '${shot('real-open-none-prompt.png')}'`);
  await page.screenshot({ path: shot('real-open-none.png') });

  rec('選完檔不理權限視窗就進入寫作頁', opened, '/p/:id/write', page.url());
  rec(
    '開檔過程沒有呼叫 requestPermission',
    !consoleLines.some((l) => l.includes('requestPermission start')),
    '0 次',
    consoleLines.filter((l) => l.includes('requestPermission')).join(' | ') || '0 次',
  );

  const permPrompt = sh(
    "xdotool search --name '(Save changes|儲存變更|要儲存)' | head -1",
  );
  rec(
    '選完後即使權限小視窗可能還在，畫面已進入寫作頁',
    opened,
    '已進寫作頁',
    `url=${page.url()} permWin=${permPrompt || '無'}`,
  );

  const result = {
    label: 'wo121-none',
    base: BASE,
    file: FILE,
    act: ACT,
    finalUrl: page.url(),
    opened,
    permPrompt: permPrompt || null,
    console: consoleLines,
    checks: logs,
  };
  fs.writeFileSync(shot('real-open-none.json'), JSON.stringify(result, null, 2));

  const failed = logs.filter((x) => x.ok === false).length;
  console.log(`WO-121 真選檔：失敗 ${failed} 項`);
  await browser.close();
  process.exit(failed > 0 || !opened ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
