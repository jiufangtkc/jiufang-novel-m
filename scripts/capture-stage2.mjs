/**
 * 第 2 階段章節目錄樣品（假資料）與長目錄捲動檢查。
 * NODE_PATH=/tmp/pw/node_modules node scripts/capture-stage2.mjs
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const playwrightModule = process.env.PLAYWRIGHT_MODULE ?? 'playwright';
const imported = await import(playwrightModule);
const playwright = imported.webkit ? imported : imported.default;
const { webkit, devices } = playwright;

const base = process.env.SAMPLE_URL ?? 'http://127.0.0.1:4173';
const phoneDir = path.resolve('docs/samples/stage2-chapter-tree/iphone-390x844');
const deskDir = path.resolve('docs/samples/stage2-chapter-tree/desktop-1280x800');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await webkit.launch();
const iphone = devices['iPhone 13'];
const phone = await browser.newContext({
  ...iphone,
  viewport: { width: 390, height: 844 },
  locale: 'zh-TW',
  timezoneId: 'Asia/Taipei',
});
const page = await phone.newPage();
await mkdir(phoneDir, { recursive: true });
await mkdir(deskDir, { recursive: true });

async function shot(dir, name) {
  await page.evaluate(() => document.fonts.ready);
  const file = path.join(dir, name);
  await page.screenshot({ path: file });
  return file;
}

const shots = [];

await page.goto(`${base}/p/long/write`, { waitUntil: 'networkidle' });
await page.getByTestId('chapter-tree').waitFor();
const scrolled = await page.locator('.tree-pane .scroll-pane').evaluate((element) => {
  const canScroll = element.scrollHeight > element.clientHeight + 40;
  element.scrollTop = element.scrollHeight;
  const atEnd = element.scrollTop + element.clientHeight >= element.scrollHeight - 2;
  const last = element.innerText.includes('第41章');
  return { canScroll, atEnd, last, scrollTop: element.scrollTop };
});
assert(scrolled.canScroll && scrolled.atEnd && scrolled.last, `長目錄捲不到底：${JSON.stringify(scrolled)}`);
shots.push(await shot(phoneDir, '08-長目錄底部.png'));

await page.goto(`${base}/p/fog/write`, { waitUntil: 'networkidle' });
await page.getByRole('heading', { name: '【示範】霧港紀事' }).waitFor();
const handleHidden = await page.locator('.tree-handle.is-hidden').count();
assert(handleHidden > 0, '平常目錄不該出現拖曳把手');
shots.push(await shot(phoneDir, '01-目錄主畫面.png'));

await page.getByTestId('organize-toggle').click();
await page.getByRole('heading', { name: '整理目錄' }).waitFor();
const touch = await page.locator('.tree-handle').first().evaluate((element) => getComputedStyle(element).touchAction);
assert(touch === 'none', '只有拖曳把手該取消觸控捲動');
await page.getByRole('button', { name: '第二章　燈塔', exact: true }).click();
shots.push(await shot(phoneDir, '02-整理模式.png'));

await page.getByRole('button', { name: '更多' }).click();
await page.getByTestId('node-menu').waitFor();
shots.push(await shot(phoneDir, '03-更多.png'));
await page.getByRole('button', { name: '刪除這章…' }).click();
await page.getByTestId('delete-confirm').waitFor();
const confirmText = await page.getByTestId('delete-confirm').innerText();
assert(confirmText.includes('留著') && confirmText.includes('幕'), '刪除確認要寫出子項目');
assert(confirmText.includes('找回刪掉的章'), '刪除確認要寫之後還能找回');
shots.push(await shot(phoneDir, '05-刪除確認.png'));
await page.getByRole('button', { name: '留著' }).click();

await page.getByRole('button', { name: '改名' }).click();
await page.getByTestId('rename-dialog').waitFor();
shots.push(await shot(phoneDir, '04-改名.png'));
await page.getByRole('button', { name: '取消' }).click();

await page.getByRole('button', { name: '第二章　燈塔的進度' }).click();
await page.getByTestId('progress-menu').waitFor();
shots.push(await shot(phoneDir, '07-進度選單.png'));
await page.locator('.sheet-backdrop').click({ position: { x: 12, y: 80 } });

await page.getByRole('button', { name: '更多' }).click();
await page.getByRole('button', { name: '刪除這章…' }).click();
await page.getByRole('button', { name: '刪除', exact: true }).click();
await page.getByTestId('tree-undo').waitFor();
shots.push(await shot(phoneDir, '06-刪除後復原.png'));
await page.getByRole('button', { name: '復原' }).click();
await page.getByRole('button', { name: '第二章　燈塔', exact: true }).waitFor();

await page.getByTestId('organize-done').click();
await page.getByTestId('add-chapter').click();
await page.getByTestId('rename-dialog').waitFor();
const caret = await page.getByTestId('rename-title').evaluate((element) => ({
  value: element.value,
  start: element.selectionStart,
  end: element.selectionEnd,
}));
assert(caret.value === '第八章\u3000' && caret.start === caret.value.length && caret.end === caret.value.length, `新章游標應在章號後：${JSON.stringify(caret)}`);
shots.push(await shot(phoneDir, '09-新章改名.png'));
await page.getByRole('button', { name: '取消' }).click();
assert((await page.getByTestId('writing-input').count()) === 0, '取消改名應留在目錄');

await page.getByTestId('add-chapter').click();
await page.getByTestId('rename-dialog').waitFor();
await page.getByRole('button', { name: '儲存名稱' }).click();
await page.getByTestId('writing-input').waitFor();
assert(page.url().includes('/write/'), '儲存名稱後應進入正文');

await page.goto(`${base}/p/fog/write/ch-2`, { waitUntil: 'networkidle' });
await page.getByTestId('chapter-jump').waitFor();
const prevOn = await page.getByTestId('chapter-prev').isEnabled();
const nextOn = await page.getByTestId('chapter-next').isEnabled();
assert(prevOn && nextOn, '中間章的上一章、下一章都可按');
shots.push(await shot(phoneDir, '10-上一章下一章.png'));
await page.getByTestId('chapter-next').click();
await page.getByRole('heading', { name: '第三章　舊照片' }).waitFor();
await page.goto(`${base}/p/fog/write/ch-1`, { waitUntil: 'networkidle' });
assert(await page.getByTestId('chapter-prev').isDisabled(), '第一章沒有上一章');

const input = page.getByTestId('writing-input');
await input.click();
await input.press('End');
await page.keyboard.type('甲');
await page.getByRole('button', { name: '返回目錄' }).click();
await page.getByRole('button', { name: '第一章　來信的更多操作' }).click();
await page.getByRole('button', { name: '找回之前的版本' }).click();
await page.getByTestId('version-sheet').getByRole('button', { name: '預覽' }).first().waitFor();
shots.push(await shot(phoneDir, '11-找回版本.png'));
await page.getByRole('button', { name: '預覽' }).last().click();
await page.getByTestId('version-preview').waitFor();
const readOnly = await page.locator('[data-testid="version-preview"] textarea').evaluate((element) => element.readOnly);
assert(readOnly, '版本預覽只能看');
await page.getByRole('button', { name: '用這一版' }).click();
await page.getByTestId('version-sheet').waitFor({ state: 'hidden' });

await page.getByRole('button', { name: '第四章　（刪去的岔路）的更多操作' }).click();
await page.getByRole('button', { name: '刪除這章…' }).click();
await page.getByRole('button', { name: '刪除', exact: true }).click();
await page.getByTestId('tree-undo').waitFor();
await page.waitForTimeout(11000);
assert((await page.getByTestId('tree-undo').count()) === 0, '十秒後復原列應消失');
await page.getByTestId('find-deleted').click();
await page.getByTestId('deleted-sheet').waitFor();
shots.push(await shot(phoneDir, '12-找回刪掉的章.png'));
await page.getByRole('button', { name: '放到最後面' }).click();
await page.getByRole('button', { name: '第四章　（刪去的岔路）', exact: true }).waitFor();

await page.goto(`${base}/p/second/write/second-ch`, { waitUntil: 'networkidle' });
await page.getByTestId('writing-input').evaluate((element) => {
  element.focus();
  element.setSelectionRange(4, 4);
  element.blur();
});
await page.waitForFunction(() => {
  const raw = localStorage.getItem('jiufang-novel-m.outline.v1');
  if (!raw) return false;
  const projects = JSON.parse(raw);
  const second = projects.find((item) => item.id === 'second');
  return Boolean(second && second.lastCursor === 4 && second.lastOpenedNodeId === 'second-ch');
});
await page.goto(`${base}/`, { waitUntil: 'networkidle' });
await page.getByRole('link', { name: /第二本假專案/ }).click();
await page.getByTestId('writing-input').waitFor();
const resumed = await page.getByTestId('writing-input').evaluate((element) => element.selectionStart);
assert(resumed === 4, `再開應回到游標 4，實際 ${resumed}`);

await page.goto(`${base}/`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '開新稿子' }).click();
await page.getByTestId('shape-single').click();
shots.push(await shot(phoneDir, '13-單篇開新稿.png'));
await page.getByRole('button', { name: '建立' }).click();
await page.getByTestId('writing-input').waitFor();
assert(page.url().includes('/write/'), '單篇應直接進入正文');

await page.goto(`${base}/p/fog/write`, { waitUntil: 'networkidle' });
await page.getByTestId('chapter-tree').waitFor();
const touchAgain = await page.locator('.tree-handle').first().evaluate((element) => getComputedStyle(element).touchAction);
assert(touchAgain === 'none', '拖曳把手仍應取消觸控捲動，避免選字與返回手勢');

await phone.close();

const desk = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  locale: 'zh-TW',
  timezoneId: 'Asia/Taipei',
});
const deskPage = await desk.newPage();
await deskPage.goto(`${base}/p/fog/write`, { waitUntil: 'networkidle' });
await deskPage.getByTestId('nav-rail').waitFor();
await deskPage.getByRole('button', { name: '第一章　來信的更多操作' }).click({ button: 'right' });
await deskPage.getByTestId('node-menu').waitFor();
const deskMenu = await deskPage.getByTestId('node-menu').innerText();
assert(deskMenu.includes('F2') && deskMenu.includes('Alt+'), '電腦版選單要標快速鍵');
assert((await deskPage.getByTestId('organize-toggle').count()) === 0, '電腦版不顯示整理模式');
await deskPage.evaluate(() => document.fonts.ready);
const deskFile = path.join(deskDir, '01-目錄與右鍵.png');
await deskPage.screenshot({ path: deskFile });
shots.push(deskFile);

await browser.close();
console.log(JSON.stringify({ scrolled, shots }, null, 2));
