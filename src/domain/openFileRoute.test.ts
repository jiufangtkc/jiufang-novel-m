/**
 * WO-123：Windows 桌面開檔改走 input。node 環境，不依賴 jsdom／testing-library。
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decideOpenRoute,
  dispatchOpen,
  isWindowsDesktop,
  readBrowserRouteEnv,
  type OpenRouteEnv,
} from './openFileRoute';

const WIN10_EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0';
const WIN11_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const ANDROID_TABLET =
  'Mozilla/5.0 (Linux; Android 14; SM-X900) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const LINUX =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const WIN_PHONE =
  'Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1; Microsoft; Lumia 950) AppleWebKit/537.36 Chrome/52.0.2743.116 Mobile Safari/537.36 Edge/15.15254';

describe('isWindowsDesktop', () => {
  it('Windows 10／11 桌面 Edge、Chrome（只有 UA）為真', () => {
    expect(isWindowsDesktop({ userAgent: WIN10_EDGE })).toBe(true);
    expect(isWindowsDesktop({ userAgent: WIN11_CHROME })).toBe(true);
  });

  it('userAgentData.platform 為 Windows 且 mobile=false 為真（UA 可有可無）', () => {
    expect(isWindowsDesktop({ platform: 'Windows', mobile: false, userAgent: WIN10_EDGE })).toBe(true);
    expect(isWindowsDesktop({ platform: 'Windows', mobile: false })).toBe(true);
    expect(isWindowsDesktop({ platform: 'windows' })).toBe(true);
  });

  it('iPhone、iPad、Android、macOS、Linux 為假', () => {
    for (const userAgent of [IPHONE, IPAD, ANDROID, ANDROID_TABLET, MAC, LINUX]) {
      expect(isWindowsDesktop({ userAgent })).toBe(false);
    }
    expect(isWindowsDesktop({ platform: 'macOS', mobile: false, userAgent: MAC })).toBe(false);
    expect(isWindowsDesktop({ platform: 'Linux', mobile: false, userAgent: LINUX })).toBe(false);
    expect(isWindowsDesktop({ platform: 'Android', mobile: true, userAgent: ANDROID })).toBe(false);
    expect(isWindowsDesktop({ platform: 'iOS', mobile: true, userAgent: IPHONE })).toBe(false);
  });

  it('Windows Phone（UA 含 Windows 字串）為假', () => {
    expect(isWindowsDesktop({ userAgent: WIN_PHONE })).toBe(false);
    expect(isWindowsDesktop({ userAgent: 'Mozilla/5.0 (compatible; MSIE 10.0; Windows Phone 8.0; IEMobile/10.0)' })).toBe(false);
  });

  it('mobile=true 優先於 Windows 平台', () => {
    expect(isWindowsDesktop({ platform: 'Windows', mobile: true, userAgent: WIN10_EDGE })).toBe(false);
  });

  it('UA 有手機／平板標記時，即使 userAgentData 說 Windows 也排除（排除優先）', () => {
    expect(isWindowsDesktop({ platform: 'Windows', mobile: false, userAgent: WIN_PHONE })).toBe(false);
    expect(isWindowsDesktop({ platform: 'Windows', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Tablet; Win64)' })).toBe(false);
  });

  it('資訊皆缺漏或無法辨識判為非 Windows', () => {
    expect(isWindowsDesktop({})).toBe(false);
    expect(isWindowsDesktop({ platform: '', mobile: null, userAgent: '' })).toBe(false);
    expect(isWindowsDesktop({ platform: null, userAgent: null })).toBe(false);
    expect(isWindowsDesktop({ userAgent: 'SomeUnknownBrowser/1.0' })).toBe(false);
  });

  it('平台與 UA 衝突（無手機標記）：採可用的 userAgentData 平台', () => {
    expect(isWindowsDesktop({ platform: 'Linux', userAgent: WIN10_EDGE })).toBe(false);
    expect(isWindowsDesktop({ platform: 'Windows', userAgent: LINUX })).toBe(true);
  });

  it('平台是空白字串時退回看 UA', () => {
    expect(isWindowsDesktop({ platform: '  ', userAgent: WIN11_CHROME })).toBe(true);
    expect(isWindowsDesktop({ platform: '  ', userAgent: MAC })).toBe(false);
  });

  it('觸控 Windows 筆電（桌面 UA、無手機標記）仍是桌面；不看螢幕與觸控', () => {
    const touchLaptop: OpenRouteEnv = { platform: 'Windows', mobile: false, userAgent: WIN11_CHROME };
    expect(isWindowsDesktop(touchLaptop)).toBe(true);
    const source = readFileSync('src/domain/openFileRoute.ts', 'utf8');
    expect(source).not.toMatch(/maxTouchPoints|innerWidth|screen\.|matchMedia/);
  });
});

describe('readBrowserRouteEnv（邊界）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('node 沒有 navigator 也不拋錯，回空資訊並判為非 Windows', () => {
    vi.stubGlobal('navigator', undefined);
    expect(readBrowserRouteEnv()).toEqual({});
    expect(isWindowsDesktop(readBrowserRouteEnv())).toBe(false);
  });

  it('讀取 navigator 拋錯時回空資訊，不拋錯', () => {
    vi.stubGlobal('navigator', {
      get userAgent(): string {
        throw new Error('不可讀');
      },
    });
    expect(readBrowserRouteEnv()).toEqual({});
  });

  it('讀得到 userAgentData 與 UA 時原樣帶出', () => {
    vi.stubGlobal('navigator', {
      userAgent: WIN10_EDGE,
      userAgentData: { platform: 'Windows', mobile: false },
    });
    const env = readBrowserRouteEnv();
    expect(env).toEqual({ platform: 'Windows', mobile: false, userAgent: WIN10_EDGE });
    expect(isWindowsDesktop(env)).toBe(true);
  });
});

describe('decideOpenRoute／dispatchOpen', () => {
  const win: OpenRouteEnv = { platform: 'Windows', mobile: false, userAgent: WIN10_EDGE };
  const mac: OpenRouteEnv = { platform: 'macOS', mobile: false, userAgent: MAC };

  function run(canPick: boolean, env: OpenRouteEnv) {
    const calls = { picker: 0, input: 0 };
    const route = dispatchOpen({
      canPick,
      env,
      runPicker: () => {
        calls.picker += 1;
      },
      clickInput: () => {
        calls.input += 1;
      },
    });
    return { route, calls };
  }

  it('Windows 桌面且支援 picker：只點 input 一次，picker 為 0', () => {
    const { route, calls } = run(true, win);
    expect(route).toBe('input');
    expect(calls).toEqual({ picker: 0, input: 1 });
  });

  it('Windows 桌面不支援 picker：同樣點 input', () => {
    expect(run(false, win).calls).toEqual({ picker: 0, input: 1 });
  });

  it('非 Windows 且支援 picker：走 picker 一次，input 為 0', () => {
    for (const env of [mac, { platform: 'Linux', userAgent: LINUX }, { userAgent: ANDROID }, {}]) {
      const { route, calls } = run(true, env);
      expect(route).toBe('picker');
      expect(calls).toEqual({ picker: 1, input: 0 });
    }
  });

  it('非 Windows 不支援 picker：走 input', () => {
    expect(run(false, mac).calls).toEqual({ picker: 0, input: 1 });
    expect(decideOpenRoute({ canPick: false, env: {} })).toBe('input');
  });

  it('分派是同步的：呼叫回來時動作已經執行（留在點擊的有效操作時機內）', () => {
    let fired = false;
    dispatchOpen({ canPick: true, env: mac, runPicker: () => { fired = true; }, clickInput: () => undefined });
    expect(fired).toBe(true);
  });
});

describe('hook 真的接上同一個決策、所有入口共用', () => {
  const src = (path: string) => readFileSync(path, 'utf8');

  it('useOpenManuscriptFile 用 dispatchOpen，並以 readBrowserRouteEnv 讀瀏覽器資訊；沒有直接用 canPick 決定走 picker', () => {
    const hook = src('src/screens/useOpenManuscriptFile.tsx');
    expect(hook).toContain("from '../domain/openFileRoute'");
    expect(hook).toContain('dispatchOpen({');
    expect(hook).toContain('canPick: canPickLocalFiles(),');
    expect(hook).toContain('env: readBrowserRouteEnv(),');
    expect(hook).not.toContain('if (canPickLocalFiles())');
    // picker 只在 runPicker 裡呼叫；Windows 路徑（clickInput）只點 input。
    expect(hook.match(/\.openWithPicker\(\)/g)?.length).toBe(1);
    expect(hook).not.toMatch(/showOpenFilePicker\s*\(/);
    expect(hook).toContain('clickInput: () => inputRef.current?.click(),');
    expect(hook).toContain('data-testid="open-db"');
    expect(hook).toContain('.importFile(file)');
  });

  it('首頁、檔案頁、歡迎導覽、再看一次都經過共用 hook，自己不碰 picker／判定', () => {
    for (const file of [
      'src/screens/HomeScreen.tsx',
      'src/screens/FilesScreen.tsx',
      'src/screens/WelcomeRevisitScreen.tsx',
    ]) {
      const text = src(file);
      expect(text).toContain('useOpenManuscriptFile()');
      expect(text).not.toContain('showOpenFilePicker');
      expect(text).not.toContain('openWithPicker');
      expect(text).not.toContain('isWindowsDesktop');
    }
    const tour = src('src/screens/WelcomeTour.tsx');
    expect(tour).not.toContain('openWithPicker');
    expect(tour).not.toContain('showOpenFilePicker');
  });

  it('canPickLocalFiles 沒有被改成看平台（存檔能力與手機分流不受影響）', () => {
    const disk = src('src/db/browserDisk.ts');
    const fn = disk.slice(disk.indexOf('export function canPickLocalFiles'), disk.indexOf('export function diskFileFromHandle'));
    expect(fn).not.toMatch(/userAgent|platform|navigator|openFileRoute/);
  });

  it('非 Windows picker 的開檔路徑仍不索取寫入權限', () => {
    const disk = src('src/db/browserDisk.ts');
    const pick = disk.slice(disk.indexOf('export async function pickExistingDatabase'), disk.indexOf('async function pickSaveOnce'));
    expect(pick).not.toContain('requestPermission');
    expect(pick).not.toContain('queryPermission');
    expect(src('src/screens/useOpenManuscriptFile.tsx')).not.toContain('requestPermission');
  });
});
