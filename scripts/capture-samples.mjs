/**
 * 用 WebKit、390×844 截下樣品畫面，並順手操作寫作、貼上與今日目標。
 * 執行：NODE_PATH=/tmp/pw/node_modules node scripts/capture-samples.mjs
 * 不納入 Cloudflare 的建置。
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const playwrightModule = process.env.PLAYWRIGHT_MODULE ?? 'playwright';
const imported = await import(playwrightModule);
const playwright = imported.webkit ? imported : imported.default;
const { webkit, devices } = playwright;

const base = process.env.SAMPLE_URL ?? 'http://127.0.0.1:4173';
const outDir = path.resolve('docs/samples/iphone-390x844');
const shots = [];

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
  timezoneId: 'Asia/Taipei',
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
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

async function shot(name) {
  await page.evaluate(() => document.fonts.ready);
  const file = path.join(outDir, name);
  await page.screenshot({ path: file });
  shots.push(file);
}

async function openEditor() {
  await page.goto(`${base}/p/fog/write/ch-1`, { waitUntil: 'networkidle' });
  await page.getByTestId('writing-input').waitFor();
}

await mkdir(outDir, { recursive: true });

await page.goto(base, { waitUntil: 'networkidle' });
await page.getByRole('heading', { name: '九方小說編輯器M' }).waitFor();
const fontReady = await page.evaluate(async () => {
  await document.fonts.ready;
  return document.fonts.check('18px Iansui');
});
assert(fontReady, '芫荽沒有載入');
await shot('01-首頁.png');

await page.getByRole('link', { name: /霧港紀事/ }).click();
await page.getByTestId('chapter-tree').waitFor();
const treeText = await page.getByTestId('chapter-tree').innerText();
for (const word of ['Draft', 'Final', '1st Edit', '2nd Edit', 'Discarded', 'Scene']) {
  assert(!treeText.includes(word), `目錄仍出現英文：${word}`);
}
assert(treeText.includes('完稿') && treeText.includes('草稿') && treeText.includes('棄稿'), '目錄缺少中文標記');
await shot('02-章節目錄.png');

await page.getByRole('button', { name: '第一章　來信的更多操作' }).click();
await page.getByTestId('node-menu').waitFor();
const menuText = await page.getByTestId('node-menu').innerText();
assert(menuText.includes('型別：章'), '選單沒有把 file 顯示成章');
for (const label of ['草稿', '一修', '再修', '完稿', '棄稿']) {
  assert(menuText.includes(label), `選單缺少${label}`);
}
await shot('08-進度標記選單.png');
await page.locator('.sheet-backdrop').click({ position: { x: 10, y: 10 } });

await openEditor();
await page.getByTestId('daily-progress').waitFor();
assert((await page.getByTestId('daily-progress').getAttribute('data-met')) === 'false', '起初不該達標');
const beforeCount = await page.getByTestId('status-bar').innerText();
await shot('03-寫作-進度未達標.png');

await page.getByTestId('bottom-nav').getByTestId('nav-stats').click();
await page.getByTestId('stats-screen').waitFor();
const statsText = await page.getByTestId('stats-screen').innerText();
assert(!statsText.includes('AI'), '統計頁不該出現 AI');
assert((await page.getByTestId('achievement-count').innerText()).includes('5'), '達成次數應為 5');
await shot('05-統計.png');

await page.getByTestId('bottom-nav').getByTestId('nav-settings').click();
await page.getByTestId('settings-screen').waitFor();
await shot('06-設定.png');

await page.getByRole('link', { name: '寫作過程紀錄' }).click();
await page.getByTestId('logs-screen').waitFor();
const logsText = await page.getByTestId('logs-screen').innerText();
assert(logsText.includes('大量貼上') && logsText.includes('寫作時間'), '紀錄頁缺少欄位');
assert(!logsText.includes('Draft'), '紀錄頁不該出現英文標記');
await shot('07-寫作過程紀錄.png');

await page.getByTestId('bottom-nav').getByTestId('nav-cards').click();
await page.getByTestId('cards-screen').waitFor();
await shot('09-資料集.png');

await page.getByTestId('bottom-nav').getByTestId('nav-settings').click();
await page.getByRole('button', { name: '修改目標' }).click();
await page.getByTestId('daily-goal-input').fill('299');
await page.getByTestId('apply-goal').click();
await page.getByText('至少 300').waitFor();
await page.getByTestId('daily-goal-input').fill('300');
await page.getByTestId('apply-goal').click();
await page.getByTestId('bottom-nav').getByTestId('nav-write').click();
await page.getByRole('button', { name: '第一章　來信', exact: true }).click();
await page.getByTestId('daily-progress').waitFor();
await page.locator('.toast').waitFor({ state: 'detached', timeout: 4000 }).catch(() => {});
assert((await page.getByTestId('daily-progress').getAttribute('data-met')) === 'true', '調到 300 字後應該達標發光');
await shot('04-寫作-進度達標發光.png');

await openEditor();
const input = page.getByTestId('writing-input');
await input.click();
await input.evaluate((element) => {
  element.setSelectionRange(element.value.length, element.value.length);
});
await input.pressSequentially('加一句。', { delay: 20 });
await page.waitForTimeout(900);
const afterTyping = await page.getByTestId('status-bar').innerText();
assert(afterTyping !== beforeCount, '停筆後字數沒有更新');
assert((await page.getByTestId('save-button').getAttribute('data-dirty')) === 'false', '停筆後仍顯示未儲存');

const pasteResult = await page.evaluate(async () => {
  const wait = () => new Promise((resolve) => setTimeout(resolve, 20));
  const textarea = document.querySelector('[data-testid="writing-input"]');
  if (!(textarea instanceof HTMLTextAreaElement)) return { ok: false, reason: '沒有文字框' };
  textarea.focus();
  textarea.setSelectionRange(0, 6);
  const copyData = new DataTransfer();
  const copyEvent = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: copyData });
  textarea.dispatchEvent(copyEvent);
  const marker = copyData.getData('text/plain');
  const external = new DataTransfer();
  external.setData('text/plain', '外面的句子不該出現');
  const pasteOut = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: external });
  textarea.dispatchEvent(pasteOut);
  const blocked = !textarea.value.includes('外面的句子不該出現');
  await wait();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  const internal = new DataTransfer();
  internal.setData('text/plain', marker);
  const before = textarea.value.length;
  const pasteIn = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: internal });
  textarea.dispatchEvent(pasteIn);
  return {
    ok: true,
    marker,
    blocked,
    before,
    after: textarea.value.length,
    grew: textarea.value.length > before,
  };
});
assert(pasteResult.ok && pasteResult.blocked, '外部貼上沒有被擋下');
assert(pasteResult.grew, '編輯器內複製後無法貼回');
assert(pasteResult.marker.includes('jiufang-novel-m'), '剪貼簿應改成內部標記');

await input.press('End');
const beforeEnter = await input.inputValue();
await input.press('Enter');
const afterEnter = await input.inputValue();
assert(afterEnter === `${beforeEnter}\n`, '一般 Enter 應該可以換行');

await page.getByTestId('bottom-nav').getByTestId('nav-stats').click();
assert((await page.getByTestId('achievement-count').innerText()).includes('5'), '改今日目標後，已結算次數不該變');

assert(pageErrors.length === 0, `頁面錯誤：${pageErrors.join('；')}`);
console.log(JSON.stringify({ fontReady, shots, pasteResult, pageErrors }, null, 2));
console.log('離線請另跑 scripts/offline-webkit.mjs。這個 WebKit 的模擬斷線會內部錯誤，不能拿來證明。');
await browser.close();
