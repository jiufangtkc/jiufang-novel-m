import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import {
  APPEARANCE_ROW_ORDER,
  BODY_FONT_SCALE_DESCRIPTION,
  INPUT_MODE_DESCRIPTION,
  THEME_CAPTIONS,
  THEME_CHANGED_ANNOUNCE,
  THEME_DESCRIPTION,
  THEME_GROUP_ARIA,
  THEME_NAMES,
  THEME_OPTION_ARIA,
  THEME_TITLE,
} from '../copy/appearanceCopy';
import { readBookBytes, writeBookBytes } from '../db/library';
import { generateDesktopSampleBytes } from '../db/testing/desktopSampleDb';
import { openMemoryDb } from '../db/wasmDb';
import { BODY_FONT_SCALE_STORAGE_KEY } from './bodyFontScale';
import {
  applyTheme,
  commitTheme,
  getDeviceTheme,
  initDeviceTheme,
  parseTheme,
  readTheme,
  setDeviceTheme,
  subscribeDeviceTheme,
  THEME_DEFAULT,
  THEME_IDS,
  THEME_STORAGE_KEY,
  themeAfterArrow,
  type ThemeId,
} from './deviceTheme';
import { DEVICE_KIND_STORAGE_KEY, INPUT_MODE_STORAGE_KEY } from './inputMode';
import { LayoutProvider } from './layoutContext';
import { SettingsScreen } from '../screens/SettingsScreen';
import { SampleProvider } from '../state/sampleStore';
import { demoFixtureState } from '../state/testing/sampleFixture';

/**
 * WO-101：裝置本機主題。全部用程式產生的假本機儲存、假根節點與記憶體假 .db，
 * 不碰真稿子或真 .db。
 */

class MemoryStore {
  readonly data = new Map<string, string>();
  writes: string[] = [];
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.writes.push(key);
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  clear(): void {
    this.data.clear();
  }
}

class FakeRoot {
  readonly attrs = new Map<string, string>();
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
}

class BrokenStore {
  getItem(): string | null {
    throw new Error('本機儲存被擋');
  }
  setItem(): void {
    throw new Error('本機儲存被擋');
  }
}

/** 模擬重新整理：換一個新的根節點，從同一個本機儲存讀回來。 */
function reload(store: MemoryStore | BrokenStore | null): { theme: ThemeId; root: FakeRoot } {
  const root = new FakeRoot();
  const theme = initDeviceTheme(store, root);
  return { theme, root };
}

afterEach(() => {
  // 不讓模組記憶體裡的主題影響下一個測試。
  initDeviceTheme(new MemoryStore(), null);
});

describe('WO-101：第一次與舊裝置預設', () => {
  it('鍵名與合法值', () => {
    expect(THEME_STORAGE_KEY).toBe('jiufang-novel-m.theme.v1');
    expect(THEME_IDS).toEqual(['forest', 'celadon', 'classic']);
    expect(THEME_DEFAULT).toBe('forest');
  });

  it('空的本機儲存是森林綠，而且只讀不寫', () => {
    const store = new MemoryStore();
    const { theme, root } = reload(store);
    expect(theme).toBe('forest');
    expect(root.attrs.get('data-theme')).toBe('forest');
    expect(store.writes).toEqual([]);
    expect(store.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('舊版裝置：有其他本機鍵但沒有主題鍵，也是森林綠，不會被記成經典深藍', () => {
    const store = new MemoryStore();
    store.data.set(INPUT_MODE_STORAGE_KEY, 'touch');
    store.data.set(DEVICE_KIND_STORAGE_KEY, 'phone');
    store.data.set(BODY_FONT_SCALE_STORAGE_KEY, '120');
    store.data.set('jiufang-novel-m.half-width-reminder.v1', 'off');
    const { theme, root } = reload(store);
    expect(theme).toBe('forest');
    expect(root.attrs.get('data-theme')).toBe('forest');
    expect(store.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(store.writes).toEqual([]);
    // 其他舊鍵原封不動
    expect(store.getItem(INPUT_MODE_STORAGE_KEY)).toBe('touch');
    expect(store.getItem(BODY_FONT_SCALE_STORAGE_KEY)).toBe('120');
  });

  it('不認得的值一律回森林綠', () => {
    for (const raw of ['', 'dark', 'Classic', ' celadon', 'celadon ', 'FOREST', 'light', 'null', '1']) {
      expect(parseTheme(raw)).toBeNull();
      const store = new MemoryStore();
      store.data.set(THEME_STORAGE_KEY, raw);
      expect(reload(store).theme).toBe('forest');
    }
    expect(parseTheme(null)).toBeNull();
    expect(parseTheme(undefined)).toBeNull();
  });

  it('本機儲存不能用時不丟錯：開得起來、用森林綠；選了這一頁仍換色', () => {
    const broken = new BrokenStore();
    expect(() => reload(broken)).not.toThrow();
    expect(reload(broken).theme).toBe('forest');
    expect(reload(null).theme).toBe('forest');
    expect(readTheme(undefined)).toBe('forest');
    const root = new FakeRoot();
    expect(() => setDeviceTheme('classic', broken, root)).not.toThrow();
    expect(setDeviceTheme('celadon', broken, root)).toBe(false);
    expect(root.attrs.get('data-theme')).toBe('celadon');
    expect(getDeviceTheme()).toBe('celadon');
    expect(commitTheme(null, 'classic')).toBe(false);
  });
});

describe('WO-101：記得選擇', () => {
  it.each(['celadon', 'classic'] as const)('選 %s 後重新整理仍記得；只寫主題鍵', (choice) => {
    const store = new MemoryStore();
    store.data.set(INPUT_MODE_STORAGE_KEY, 'mouse');
    reload(store);
    const root = new FakeRoot();
    expect(setDeviceTheme(choice, store, root)).toBe(true);
    expect(root.attrs.get('data-theme')).toBe(choice);
    expect(store.writes).toEqual([THEME_STORAGE_KEY]);
    expect(store.getItem(THEME_STORAGE_KEY)).toBe(choice);
    expect(store.getItem(INPUT_MODE_STORAGE_KEY)).toBe('mouse');

    expect(reload(store).theme).toBe(choice);
    expect(reload(store).root.attrs.get('data-theme')).toBe(choice);
  });

  it('清掉其他測試資料但保留主題鍵仍讀回原選擇；清掉全部本機資料回森林綠', () => {
    const store = new MemoryStore();
    setDeviceTheme('classic', store, new FakeRoot());
    store.data.set(INPUT_MODE_STORAGE_KEY, 'touch');
    store.data.set('jiufang-novel-m.outline.v1', '[]');
    for (const key of [...store.data.keys()]) {
      if (key !== THEME_STORAGE_KEY) store.removeItem(key);
    }
    expect(reload(store).theme).toBe('classic');

    store.clear();
    expect(reload(store).theme).toBe('forest');
    // 換裝置＝全新的本機儲存
    expect(reload(new MemoryStore()).theme).toBe('forest');
  });

  it('選回森林綠也寫進本機（之後重開仍是森林綠）', () => {
    const store = new MemoryStore();
    setDeviceTheme('celadon', store, new FakeRoot());
    setDeviceTheme('forest', store, new FakeRoot());
    expect(store.getItem(THEME_STORAGE_KEY)).toBe('forest');
    expect(reload(store).theme).toBe('forest');
  });
});

describe('WO-101：即時換色、根節點屬性', () => {
  it('只改 data-theme，不碰 data-layout、data-pointer', () => {
    const root = new FakeRoot();
    root.setAttribute('data-layout', 'wide');
    root.setAttribute('data-pointer', 'mouse');
    applyTheme('celadon', root);
    expect(root.attrs.get('data-theme')).toBe('celadon');
    expect(root.attrs.get('data-layout')).toBe('wide');
    expect(root.attrs.get('data-pointer')).toBe('mouse');
    applyTheme('nope' as ThemeId, root);
    expect(root.attrs.get('data-theme')).toBe('forest');
  });

  it('選了立刻通知畫面，不必重開', () => {
    const store = new MemoryStore();
    initDeviceTheme(store, new FakeRoot());
    const seen: ThemeId[] = [];
    const off = subscribeDeviceTheme(() => seen.push(getDeviceTheme()));
    setDeviceTheme('celadon', store, new FakeRoot());
    setDeviceTheme('classic', store, new FakeRoot());
    off();
    setDeviceTheme('forest', store, new FakeRoot());
    expect(seen).toEqual(['celadon', 'classic']);
  });

  it('方向鍵在三套之間移動，頭尾相接', () => {
    expect(themeAfterArrow('forest', 'ArrowDown')).toBe('celadon');
    expect(themeAfterArrow('celadon', 'ArrowRight')).toBe('classic');
    expect(themeAfterArrow('classic', 'ArrowDown')).toBe('forest');
    expect(themeAfterArrow('forest', 'ArrowUp')).toBe('classic');
    expect(themeAfterArrow('celadon', 'ArrowLeft')).toBe('forest');
    expect(themeAfterArrow('forest', 'Enter')).toBeNull();
    expect(themeAfterArrow('forest', 'Tab')).toBeNull();
  });

  it('啟動入口先套用主題再畫畫面', () => {
    const main = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');
    const init = main.indexOf('initDeviceTheme()');
    const render = main.indexOf('createRoot(');
    expect(init).toBeGreaterThan(-1);
    expect(render).toBeGreaterThan(init);
  });
});

function renderSettings(): string {
  return renderToStaticMarkup(
    createElement(
      SampleProvider,
      { initialState: demoFixtureState() },
      createElement(
        LayoutProvider,
        { initialMode: 'phone-portrait', initialPointer: 'touch', initialDeviceKind: 'phone', initialBodyFontScale: 100 },
        createElement(
          MemoryRouter,
          { initialEntries: ['/p/fog/settings'] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: '/p/:projectId/settings', element: createElement(SettingsScreen) }),
          ),
        ),
      ),
    ),
  );
}

describe('WO-101：設定頁「外觀」主題列與定稿用字', () => {
  it('定稿用字逐字', () => {
    expect(THEME_TITLE).toBe('主題');
    expect(THEME_DESCRIPTION).toBe(
      '換整個 App 的顏色。每一套的正文欄都跟四周不同色，一看就知道哪裡可以打字。只會套用在這個裝置。',
    );
    expect(THEME_NAMES).toEqual({ forest: '森林綠（預設）', celadon: '青瓷', classic: '經典深藍' });
    expect(THEME_CAPTIONS).toEqual({
      forest: '深墨綠四周、森林綠正文欄、淺青綠按鈕',
      celadon: '深藍青四周、天青正文欄、淺天青按鈕',
      classic: '深灰四周、深藍正文欄、亮藍按鈕',
    });
    for (const caption of Object.values(THEME_CAPTIONS)) {
      expect([...caption].length).toBeLessThanOrEqual(20);
      expect(caption).not.toMatch(/[。．.]$/);
    }
    expect(THEME_GROUP_ARIA).toBe('主題，只會套用在這個裝置');
    expect(THEME_OPTION_ARIA).toEqual({
      forest: '森林綠，預設主題。深墨綠四周、森林綠正文欄、淺青綠按鈕。選了馬上換成這套顏色',
      celadon: '青瓷主題。深藍青四周、天青正文欄、淺天青按鈕。選了馬上換成這套顏色',
      classic: '經典深藍主題。深灰四周、深藍正文欄、亮藍按鈕。選了馬上換成這套顏色',
    });
    for (const aria of Object.values(THEME_OPTION_ARIA)) {
      expect(aria).not.toContain('已選取');
      expect(aria).not.toMatch(/[・／]/);
    }
    expect(THEME_CHANGED_ANNOUNCE).toEqual({
      forest: '已換成森林綠主題',
      celadon: '已換成青瓷主題',
      classic: '已換成經典深藍主題',
    });
    expect(BODY_FONT_SCALE_DESCRIPTION).toBe('調整寫作時正文的字有多大。只會套用在這個裝置。');
    expect(INPUT_MODE_DESCRIPTION).toBe(
      '依你操作的方式調整列和按鈕的間距。要調正文的字有多大，請用上面的「正文字級」。只會套用在這個裝置。',
    );
  });

  it('外觀依序：主題、正文字級、操作方式；預設選森林綠，三個選項有朗讀標籤與選取狀態', () => {
    expect(APPEARANCE_ROW_ORDER).toEqual(['theme', 'body-font-scale', 'input-mode']);
    const html = renderSettings();
    const theme = html.indexOf('data-testid="theme-setting"');
    const font = html.indexOf('data-testid="body-font-setting"');
    const input = html.indexOf('data-testid="input-mode-setting"');
    expect(theme).toBeGreaterThan(-1);
    expect(font).toBeGreaterThan(theme);
    expect(input).toBeGreaterThan(font);

    expect(html).toContain(`role="radiogroup" aria-label="${THEME_GROUP_ARIA}"`);
    expect(html).toContain(`>${THEME_DESCRIPTION}<`);
    for (const id of THEME_IDS) {
      const option = html.match(new RegExp(`<button[^>]*data-testid="theme-option-${id}"[^>]*>`))?.[0] ?? '';
      expect(option).toContain('role="radio"');
      expect(option).toContain(`aria-label="${THEME_OPTION_ARIA[id]}"`);
      expect(option).toContain(`aria-checked="${id === 'forest'}"`);
      expect(option).toContain(`tabindex="${id === 'forest' ? 0 : -1}"`);
      expect(html).toContain(`<strong>${THEME_NAMES[id]}</strong>`);
      expect(html).toContain(`<small>${THEME_CAPTIONS[id]}</small>`);
      // 小色塊：掛那一套的 data-theme，純裝飾、朗讀跳過，不加文字
      expect(html).toContain(`<span class="theme-swatch" data-theme="${id}" aria-hidden="true"><span></span></span>`);
    }
    // 圖上的黃色註記不是介面文字
    expect(html).not.toContain('預設：森林綠');
    expect(html).not.toContain('警告：這次還沒存成檔案');
    expect(html).not.toContain('跟著手機設定');
  });

  it('選青瓷後：青瓷選取、森林綠仍顯示（預設）', () => {
    setDeviceTheme('celadon', new MemoryStore(), null);
    const html = renderSettings();
    expect(html).toMatch(/data-testid="theme-option-celadon"[^>]*aria-checked="true"/);
    expect(html).toMatch(/data-testid="theme-option-forest"[^>]*aria-checked="false"/);
    expect(html).toContain('<strong>森林綠（預設）</strong>');
  });

  it('畫面只引用 copy 常數，不在 JSX 重複寫文案', () => {
    const src = readFileSync(new URL('../screens/AppearanceSettings.tsx', import.meta.url), 'utf8');
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const text of [
      THEME_DESCRIPTION,
      THEME_GROUP_ARIA,
      ...Object.values(THEME_NAMES),
      ...Object.values(THEME_CAPTIONS),
      ...Object.values(THEME_OPTION_ARIA),
      ...Object.values(THEME_CHANGED_ANNOUNCE),
      '這個裝置',
      '森林綠',
      '青瓷',
      '經典深藍',
    ]) {
      expect(codeOnly).not.toContain(text);
    }
    expect(src).toContain('THEME_DESCRIPTION');
    expect(src).toContain('THEME_OPTION_ARIA[id]');
  });
});

/** src 底下所有正式程式（不含測試、型別宣告）。 */
function listSource(): string[] {
  // import.meta.glob 的路徑相對這個測試檔
  return Object.keys(import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../**/*.d.ts']))
    .map((rel) => new URL(rel, import.meta.url).pathname)
    .sort();
}

describe('WO-101：主題不污染稿子與 .db', () => {
  it('主題只由 deviceTheme 讀寫；稿子狀態與 .db 程式不碰主題鍵', () => {
    const files = listSource();
    expect(files.length).toBeGreaterThan(50);
    const users = files.filter((file) => readFileSync(file, 'utf8').includes('jiufang-novel-m.theme'));
    expect(users.map((file) => file.replace(/.*\/src\//, 'src/'))).toEqual(['src/layout/deviceTheme.ts']);
    for (const file of files) {
      if (!/\/src\/(db|state)\//.test(file)) continue;
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toContain('deviceTheme');
      expect(text, file).not.toContain('setDeviceTheme');
    }
  });

  it('切主題後存回假 .db 再重開：正文、卡片原始色（含 #e5c07b）、current_theme 與其他資料不變，主題鍵沒寫進檔', async () => {
    const sample = await generateDesktopSampleBytes();
    const db = await openMemoryDb(sample);
    let prepared: Uint8Array;
    try {
      db.sql.run('UPDATE project_info SET current_theme = ?', ['電腦版自己的主題值']);
      db.sql.run("UPDATE cards SET color = '#e5c07b' WHERE rowid = (SELECT MIN(rowid) FROM cards)");
      prepared = db.exportBytes();
    } finally {
      db.close();
    }

    const before = await readBookBytes('假稿.db', prepared, 'fake-a');
    const store = new MemoryStore();
    initDeviceTheme(store, new FakeRoot());
    setDeviceTheme('celadon', store, new FakeRoot());
    // 開另一份假 .db：主題不變
    const other = await readBookBytes('另一份假稿.db', await generateDesktopSampleBytes(), 'fake-b');
    expect(other.info.currentTheme).toBe('');
    expect(getDeviceTheme()).toBe('celadon');
    setDeviceTheme('classic', store, new FakeRoot());

    const saved = await writeBookBytes(before.bytes, before.info, before.tree, before.cards, before.logs);
    const after = await readBookBytes('假稿.db', saved, 'fake-a');

    expect(after.info.currentTheme).toBe('電腦版自己的主題值');
    expect(after.info).toEqual(before.info);
    expect(after.tree).toEqual(before.tree);
    expect(after.cards).toEqual(before.cards);
    expect(after.cards.some((card) => card.color === '#e5c07b')).toBe(true);
    expect(after.logs).toEqual(before.logs);

    const text = new TextDecoder('latin1').decode(saved);
    expect(text).not.toContain(THEME_STORAGE_KEY);
    expect(text).not.toContain('celadon');
    expect(text).not.toContain('classic');
    // 本機只多了主題鍵
    expect([...store.data.keys()]).toEqual([THEME_STORAGE_KEY]);
    expect(getDeviceTheme()).toBe('classic');
  });
});
