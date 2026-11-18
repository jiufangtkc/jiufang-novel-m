/**
 * WO-118：手機直拿（390）正文聚焦後，可見高度縮小→恢復→再縮小，底部選單「隱藏→可見→隱藏」。
 *
 * 作法：載入前用 addInitScript 把 innerHeight 與 visualViewport.height 換成測試替身，
 * 之後只改替身數值並送出 resize 事件；不呼叫 blur、不點別處、不直接改 class。
 * 只用本趟用介面新開、書名含【範例】的假稿與假文字，不碰真書稿或任何 .db。
 * 另驗：恢復前後正文仍是 activeElement、選取範圍與文字不變（組字另需真機輸入法，待實機）。
 *
 * 環境變數：BASE、ENGINE（chromium 預設）、PLAYWRIGHT_MODULE、CHROMIUM_PATH。
 * 這支腳本不屬於 npm test；需先 build 並 vite preview。
 */
import { chromiumPath, loadPlaywright } from '../playwright-env.mjs';

const pw = loadPlaywright();
const BASE = (process.env.BASE || 'http://127.0.0.1:4173').replace(/\/$/, '');
const browser = await pw.chromium.launch({
  headless: true,
  ...(chromiumPath() ? { executablePath: chromiumPath() } : {}),
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  screen: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});
await context.addInitScript(() => {
  try {
    localStorage.setItem(
      'jiufang-novel-m.onboarding.v1',
      JSON.stringify({ status: 'skipped', at: '2026-11-18T04:00:00.000Z', appVersion: '0.1.0' }),
    );
    localStorage.setItem('jiufang-novel-m.theme.v1', 'forest');
  } catch {}
});
await context.addInitScript(() => {
  window.__fakeHeight = 844;
  Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => window.__fakeHeight });
  if (window.visualViewport) {
    Object.defineProperty(window.visualViewport, 'height', {
      configurable: true,
      get: () => window.__fakeHeight,
    });
  }
});
// 只改 innerHeight getter 時 Chromium 的 (orientation: landscape) 不會自己翻，
// 所以換成替身：高度 < 寬度時 matches 為 true（模擬鍵盤把可用區域壓成寬大於高），變化時由 setHeight 呼叫 change。
await context.addInitScript(() => {
  const real = window.matchMedia.bind(window);
  const listeners = new Set();
  const fake = {
    media: '(orientation: landscape)',
    get matches() {
      return window.innerHeight < window.innerWidth;
    },
    onchange: null,
    addEventListener: (type, fn) => type === 'change' && listeners.add(fn),
    removeEventListener: (type, fn) => type === 'change' && listeners.delete(fn),
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    dispatchEvent: () => true,
  };
  window.__fireLandscapeChange = () => {
    for (const fn of [...listeners]) fn({ type: 'change', matches: fake.matches, media: fake.media });
  };
  window.matchMedia = (q) => (q.replace(/\s/g, '') === '(orientation:landscape)' ? fake : real(q));
});
const page = await context.newPage();

let failed = 0;
const check = (name, ok, actual) => {
  if (!ok) failed += 1;
  console.log(`${ok ? '通過' : '失敗'} ${name} :: ${actual}`);
};
const setHeight = async (h) => {
  await page.evaluate((v) => {
    window.__fakeHeight = v;
    window.__fireLandscapeChange?.();
    window.dispatchEvent(new Event('resize'));
    window.visualViewport?.dispatchEvent(new Event('resize'));
  }, h);
  await page.waitForTimeout(250);
};
const state = () =>
  page.evaluate(() => {
    const nav = document.querySelector('[data-testid="bottom-nav"]');
    const input = document.querySelector('[data-testid="writing-input"]');
    const r = nav ? nav.getBoundingClientRect() : null;
    const style = nav ? getComputedStyle(nav) : null;
    return {
      navVisible: !!nav && style.display !== 'none' && style.visibility !== 'hidden' && !!r && r.width > 0 && r.height > 0,
      keyboardOpen: document.documentElement.classList.contains('keyboard-open'),
      focused: document.activeElement === input,
      start: input?.selectionStart,
      end: input?.selectionEnd,
      value: input?.value,
    };
  });

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="home-screen"], h1', { timeout: 15000 });
await page.locator('button:has-text("開新稿子")').click();
await page.waitForSelector('form.dialog, [role="dialog"]', { timeout: 5000 });
await page.locator('form.dialog input, [role="dialog"] input').first().fill('【範例】WO118假稿');
await page.locator('form.dialog button[type="submit"]:has-text("建立"), [role="dialog"] button:has-text("建立")').click();
await page.waitForURL(/\/p\/[^/]+\/write/, { timeout: 10000 });

const input = page.locator('[data-testid="writing-input"]').first();
await input.waitFor({ timeout: 10000 });
// 未聚焦時先讓 hook 量到可信基準（844）
await setHeight(844);
const before = await state();
check('未聚焦：底部選單可見', before.navVisible && !before.keyboardOpen, JSON.stringify(before));

await input.tap();
await input.pressSequentially('假資料第一行', { delay: 20 });
const focusedState = await state();
check('聚焦、高度未變（iOS 型）：精簡版面，選單隱藏', focusedState.focused && focusedState.keyboardOpen && !focusedState.navVisible, JSON.stringify(focusedState));

await setHeight(500);
const s1 = await state();
check('高度縮小：選單仍隱藏', s1.focused && s1.keyboardOpen && !s1.navVisible, JSON.stringify(s1));

await setHeight(780); // 基準 844，恢復門檻 H−80＝764
const s2 = await state();
check('高度恢復（780 ≥ 844−80）：選單可見、keyboard-open 拿掉、正文仍聚焦且內容與選取不變',
  s2.focused && !s2.keyboardOpen && s2.navVisible && s2.value === s1.value && s2.start === s1.start && s2.end === s1.end,
  JSON.stringify(s2));

await setHeight(500);
const s3 = await state();
check('再次縮小：選單再隱藏', s3.focused && s3.keyboardOpen && !s3.navVisible, JSON.stringify(s3));

// 媒體查詢誤判案例（替身見檔首 init script）：高度 < 寬度時 (orientation: landscape) matches 為 true。
// 沿用同一次聚焦（不 blur、不重新聚焦）；s3 後為 shrunk，先恢復到 800（> 基準 844−80＝764）。
await setHeight(800);
const m0 = await state();
check('接續：恢復 800（媒體查詢 false）選單可見', m0.focused && !m0.keyboardOpen && m0.navVisible, JSON.stringify(m0));
const mq = () => page.evaluate(() => window.matchMedia('(orientation: landscape)').matches);
await setHeight(350); // 寬 390 > 高 350 → 替身 matches=true
const mqOn = await mq();
const m1 = await state();
check('高度 350、媒體查詢 true：仍聚焦、精簡版面（選單隱藏）', mqOn === true && m1.focused && m1.keyboardOpen && !m1.navVisible, JSON.stringify({ mqOn, ...m1 }));
await setHeight(800); // matches 回到 false
const mqOff = await mq();
const m2 = await state();
check('高度恢復 800、媒體查詢 false：選單可見、仍聚焦、文字與選取不變',
  mqOff === false && m2.focused && !m2.keyboardOpen && m2.navVisible && m2.value === m1.value && m2.start === m1.start && m2.end === m1.end,
  JSON.stringify({ mqOff, ...m2 }));
await setHeight(350);
const m3 = await state();
check('再縮到 350（媒體查詢 true）：選單再隱藏，文字與選取不變',
  m3.focused && m3.keyboardOpen && !m3.navVisible && m3.value === m2.value && m3.start === m2.start && m3.end === m2.end,
  JSON.stringify(m3));

await browser.close();
console.log(failed ? `共 ${failed} 項失敗` : '全部通過（無頭模擬，非真機驗證）');
process.exit(failed ? 1 : 0);
