import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  THEME_COLORS,
  THEME_IDS,
  THEME_STORAGE_KEY,
  THEME_MANIFEST_HREFS,
  applyThemeColor,
  applyThemeManifest,
  initDeviceTheme,
  setDeviceTheme,
} from './deviceTheme';

/** WO-102：開啟閃色與網址列色。全部用假本機儲存、假根節點、假 meta，不碰真資料。 */

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const viteConfig = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8');

function inlineScript(): string {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('index.html 找不到同步主題 script');
  return match[1]!;
}

interface Run {
  attrs: Map<string, string>;
  metaContent: string;
  writes: string[];
}

/** 像瀏覽器一樣在「模組／React 尚未載入」之前跑同步 script。 */
function runInline(options: { stored?: string | null; throws?: boolean; noStorage?: boolean }): Run {
  const attrs = new Map<string, string>();
  const writes: string[] = [];
  const meta = { content: '#121A16', setAttribute: (n: string, v: string) => void (n === 'content' && (meta.content = v)) };
  const documentStub = {
    documentElement: { setAttribute: (n: string, v: string) => void attrs.set(n, v) },
    querySelector: (selector: string) => (selector === 'meta[name="theme-color"]' ? meta : null),
  };
  const localStorageStub = {
    getItem: (key: string) => {
      if (options.throws) throw new Error('SecurityError（測試模擬）');
      return key === THEME_STORAGE_KEY ? (options.stored ?? null) : null;
    },
    setItem: (key: string) => void writes.push(key),
    removeItem: (key: string) => void writes.push(key),
  };
  const windowStub: Record<string, unknown> = {};
  Object.defineProperty(windowStub, 'localStorage', {
    get() {
      if (options.noStorage) throw new Error('SecurityError（測試模擬）');
      return localStorageStub;
    },
  });
  new Function('window', 'document', inlineScript())(windowStub, documentStub);
  return { attrs, metaContent: meta.content, writes };
}

describe('WO-102 一：開啟時同步套主題（首次繪製前）', () => {
  it('同步 script 在第一個樣式／模組載入之前，且不是 module、不延後', () => {
    const scriptAt = html.indexOf('<script>');
    expect(scriptAt).toBeGreaterThan(-1);
    expect(html.slice(scriptAt, html.indexOf('</script>', scriptAt))).not.toMatch(/defer|async|type="module"/);
    expect(scriptAt).toBeGreaterThan(html.indexOf('<meta name="theme-color"'));
    expect(scriptAt).toBeLessThan(html.indexOf('</head>'));
    expect(scriptAt).toBeLessThan(html.indexOf('<body>'));
    expect(scriptAt).toBeLessThan(html.indexOf('src="/src/main.tsx"'));
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/);
  });

  it('已選青瓷、經典深藍：接手前根節點就是該主題與色碼；已選森林綠亦同', () => {
    for (const theme of THEME_IDS) {
      const run = runInline({ stored: theme });
      expect(run.attrs.get('data-theme')).toBe(theme);
      expect(run.metaContent).toBe(THEME_COLORS[theme]);
    }
  });

  it('無鍵、無效值、大小寫不同、讀取拋錯、存取整個丟錯：都回森林綠', () => {
    for (const stored of [null, '', 'dark', 'Celadon', ' classic', 'CLASSIC']) {
      const run = runInline({ stored });
      expect(run.attrs.get('data-theme')).toBe('forest');
      expect(run.metaContent).toBe('#121A16');
    }
    expect(runInline({ throws: true }).attrs.get('data-theme')).toBe('forest');
    expect(runInline({ noStorage: true }).attrs.get('data-theme')).toBe('forest');
    expect(runInline({ noStorage: true }).metaContent).toBe('#121A16');
  });

  it('讀取過程不寫回任何本機鍵，只動 data-theme', () => {
    for (const stored of [null, 'celadon', 'bad']) {
      const run = runInline({ stored });
      expect(run.writes).toEqual([]);
      expect([...run.attrs.keys()]).toEqual(['data-theme']);
    }
  });

  it('同步 script 的鍵名、合法值、色碼與正式模組一致', () => {
    const script = inlineScript();
    expect(script).toContain(`'${THEME_STORAGE_KEY}'`);
    for (const theme of THEME_IDS) {
      expect(script).toContain(`'${theme}'`);
      expect(script).toContain(`${theme}: '${THEME_COLORS[theme]}'`);
    }
    expect(THEME_STORAGE_KEY).toBe('jiufang-novel-m.theme.v1');
  });

  it('React 接手（initDeviceTheme）不會先換成森林綠再換回：根節點屬性從頭到尾只被寫成選擇的主題', () => {
    const store = { getItem: (k: string) => (k === THEME_STORAGE_KEY ? 'celadon' : null) };
    const written: string[] = [];
    const root = { setAttribute: (_n: string, v: string) => void written.push(v) };
    const meta = { setAttribute: (_n: string, v: string) => void written.push(v) };
    initDeviceTheme(store, root, meta);
    expect(written).toEqual(['celadon', '#101D23']);
  });
});

describe('WO-102 二：網址列／PWA 色', () => {
  it('三套色碼', () => {
    expect(THEME_COLORS).toEqual({ forest: '#121A16', celadon: '#101D23', classic: '#252526' });
  });

  it('HTML 預設 theme-color 與靜態 manifest 預設都是森林綠，不再用 #1E1E1E', () => {
    expect(html).toContain('<meta name="theme-color" content="#121A16" />');
    expect(viteConfig).toContain("background_color: '#121A16'");
    expect(viteConfig).toContain("theme_color: '#121A16'");
    expect(html).not.toContain('#1E1E1E');
    expect(viteConfig).not.toContain('#1E1E1E');
  });

  it('不任意改 black-translucent', () => {
    expect(html).toContain('content="black-translucent"');
  });

  it('初始化與切換主題都更新 theme-color；找不到 meta 不丟錯', () => {
    const content: string[] = [];
    const meta = { setAttribute: (n: string, v: string) => void (n === 'content' && content.push(v)) };
    const root = { setAttribute: () => undefined };
    const store = { getItem: () => 'classic', setItem: () => undefined };
    initDeviceTheme(store, root, meta);
    setDeviceTheme('celadon', store, root, meta);
    setDeviceTheme('forest', store, root, meta);
    setDeviceTheme('classic', store, root, meta);
    expect(content).toEqual(['#252526', '#101D23', '#121A16', '#252526']);
    expect(() => applyThemeColor('forest', null)).not.toThrow();
  });

  it('重開一致：切換後的本機值再初始化，meta 色碼對得上', () => {
    const data = new Map<string, string>();
    const store = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
    const root = { setAttribute: () => undefined };
    setDeviceTheme('celadon', store, root, { setAttribute: () => undefined });
    let color = '';
    initDeviceTheme(store, root, { setAttribute: (_n, v) => void (color = v) });
    expect(color).toBe('#101D23');
  });
});

describe('WO-102 返工：隨目前主題更新的 manifest', () => {
  const manifestColors: Record<string, string> = { forest: '#121A16', celadon: '#101D23', classic: '#252526' };

  it('三份 manifest 網址；森林綠是預設那份', () => {
    expect(THEME_MANIFEST_HREFS).toEqual({
      forest: '/manifest.webmanifest',
      celadon: '/manifest-celadon.webmanifest',
      classic: '/manifest-classic.webmanifest',
    });
  });

  it('manifest link 由建置外掛注入（在同步 script 之後），所以交給模組初始化切換；HTML 不自帶第二個 link', () => {
    expect(html).not.toContain('rel="manifest"');
  });

  it('初始化與切換主題都更新 manifest link；找不到 link 不丟錯', () => {
    const hrefs: string[] = [];
    const link = { setAttribute: (n: string, v: string) => void (n === 'href' && hrefs.push(v)) };
    const root = { setAttribute: () => undefined };
    const meta = { setAttribute: () => undefined };
    const store = { getItem: () => 'classic', setItem: () => undefined };
    initDeviceTheme(store, root, meta, link);
    setDeviceTheme('celadon', store, root, meta, link);
    setDeviceTheme('forest', store, root, meta, link);
    expect(hrefs).toEqual(['/manifest-classic.webmanifest', '/manifest-celadon.webmanifest', '/manifest.webmanifest']);
    expect(() => applyThemeManifest('celadon', null)).not.toThrow();
  });

  it('建置設定：兩份主題 manifest 色碼與 deviceTheme 一致，且由同一份基底產生', () => {
    expect(viteConfig).toContain('manifest: baseManifest');
    for (const theme of ['celadon', 'classic'] as const) {
      expect(viteConfig).toContain(`file: 'manifest-${theme}.webmanifest', color: '${THEME_COLORS[theme]}'`);
    }
    expect(manifestColors).toEqual(THEME_COLORS);
  });
});
