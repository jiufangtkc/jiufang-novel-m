import { useSyncExternalStore } from 'react';

/**
 * 整個 App 的深色主題（WO-101）。
 *
 * - 只存在這台裝置的瀏覽器本機儲存（localStorage），鍵名見 THEME_STORAGE_KEY。
 *   不寫進稿子、不寫進 .db（電腦版的 current_theme 欄位也不碰），不同步。
 *   換稿子、開別的 .db 都不換主題。
 * - 沒存過（新安裝、舊版升上來）一律森林綠；讀的時候不替使用者寫入任何值，
 *   舊版原本的經典深藍不會被記成使用者的選擇。
 * - 值不認得也回森林綠。本機儲存不能用（私人瀏覽、被擋）時照樣開得起來，
 *   這一頁先換色，下次打開回森林綠。
 * - 套用方式：<html data-theme="…">，CSS 依這個屬性換整組色彩變數。
 *   跟 data-layout、data-pointer 是不同屬性，互不覆蓋。
 */

export const THEME_STORAGE_KEY = 'jiufang-novel-m.theme.v1';

/** 由上到下就是設定頁的順序。 */
export const THEME_IDS = ['forest', 'celadon', 'classic'] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const THEME_DEFAULT: ThemeId = 'forest';

export const THEME_ROOT_ATTRIBUTE = 'data-theme';

/**
 * 網址列／PWA 外框色（WO-102）。與各主題寫作頁四周色一致：
 * 森林綠、青瓷取各自的 --bg，經典深藍取 --panel（C 案四周色）。
 * index.html 的同步小 script 與 vite.config.ts 的 manifest 預設要和這裡同一組（測試會比對）。
 */
export const THEME_COLORS: Record<ThemeId, string> = {
  forest: '#121A16',
  celadon: '#101D23',
  classic: '#252526',
};

/**
 * 各主題的 manifest 網址（WO-102 補強）。森林綠就是建置產生的預設 manifest；
 * 青瓷、經典深藍是同內容、只換 theme_color／background_color 的兩份（vite.config.ts 一併輸出）。
 * 執行中換主題時，把 <link rel="manifest"> 指到對應那份，之後安裝或重讀 manifest 的流程就拿到所選色。
 */
export const THEME_MANIFEST_HREFS: Record<ThemeId, string> = {
  forest: '/manifest.webmanifest',
  celadon: '/manifest-celadon.webmanifest',
  classic: '/manifest-classic.webmanifest',
};

export const THEME_MANIFEST_LINK_SELECTOR = 'link[rel="manifest"]';

export const THEME_COLOR_META_SELECTOR = 'meta[name="theme-color"]';

export interface ThemeReadStore {
  getItem(key: string): string | null;
}

export interface ThemeWriteStore {
  setItem(key: string, value: string): void;
}

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}

/** 只認三個值（大小寫、前後空白都要完全一樣）。其他都當作沒選過。 */
export function parseTheme(raw: string | null | undefined): ThemeId | null {
  return isThemeId(raw) ? raw : null;
}

/** 讀本機主題。沒存過、不認得、讀不到都回森林綠。只讀不寫。 */
export function readTheme(store: ThemeReadStore | null | undefined): ThemeId {
  if (!store) return THEME_DEFAULT;
  try {
    return parseTheme(store.getItem(THEME_STORAGE_KEY)) ?? THEME_DEFAULT;
  } catch {
    return THEME_DEFAULT;
  }
}

/** 檢查本機是否曾存過主題偏好鍵。只讀不寫，讀取失敗回傳 false。 */
export function hasStoredDeviceTheme(
  store: ThemeReadStore | null | undefined = defaultStore(),
): boolean {
  if (!store) return false;
  try {
    return store.getItem(THEME_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/** 寫入本機主題。只寫這一把鍵。寫不進去回傳 false，不丟錯。 */
export function commitTheme(store: ThemeWriteStore | null | undefined, theme: ThemeId): boolean {
  if (!store || !isThemeId(theme)) return false;
  try {
    store.setItem(THEME_STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

/** 把主題掛到根節點。只動 data-theme，不碰 data-layout、data-pointer 等其他屬性。 */
export function applyTheme(
  theme: ThemeId,
  root: { setAttribute(name: string, value: string): void } | null | undefined = defaultRoot(),
): void {
  if (!root) return;
  root.setAttribute(THEME_ROOT_ATTRIBUTE, isThemeId(theme) ? theme : THEME_DEFAULT);
}

/** 更新這一頁的 <meta name="theme-color">。找不到 meta（或不在瀏覽器）就略過，不丟錯。 */
export function applyThemeColor(
  theme: ThemeId,
  meta: { setAttribute(name: string, value: string): void } | null | undefined = defaultThemeColorMeta(),
): void {
  if (!meta) return;
  meta.setAttribute('content', THEME_COLORS[isThemeId(theme) ? theme : THEME_DEFAULT]);
}

/** 更新 <link rel="manifest"> 指向所選主題那一份。找不到 link（或不在瀏覽器）就略過，不丟錯。 */
export function applyThemeManifest(
  theme: ThemeId,
  link: { setAttribute(name: string, value: string): void } | null | undefined = defaultManifestLink(),
): void {
  if (!link) return;
  link.setAttribute('href', THEME_MANIFEST_HREFS[isThemeId(theme) ? theme : THEME_DEFAULT]);
}

/** 方向鍵在三套之間移動，頭尾相接；其他鍵不動。 */
export function themeAfterArrow(current: ThemeId, key: string): ThemeId | null {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown') {
    return null;
  }
  const index = Math.max(0, THEME_IDS.indexOf(current));
  const delta = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1;
  const next = (index + delta + THEME_IDS.length) % THEME_IDS.length;
  return THEME_IDS[next] ?? current;
}

function defaultRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.documentElement ?? null;
}

function defaultThemeColorMeta(): Element | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector(THEME_COLOR_META_SELECTOR);
}

function defaultManifestLink(): Element | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector(THEME_MANIFEST_LINK_SELECTOR);
}

function defaultStore(): (ThemeReadStore & ThemeWriteStore) | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // 有些瀏覽器光是讀 localStorage 就會丟錯。
    return null;
  }
}

/* ---------- 這一頁目前的主題（集中管理，畫面只訂閱這裡） ---------- */

let current: ThemeId = THEME_DEFAULT;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** 啟動時呼叫一次：讀本機、掛到根節點。回傳實際用的主題。 */
export function initDeviceTheme(
  store: ThemeReadStore | null | undefined = defaultStore(),
  root?: { setAttribute(name: string, value: string): void } | null,
  meta?: { setAttribute(name: string, value: string): void } | null,
  manifestLink?: { setAttribute(name: string, value: string): void } | null,
): ThemeId {
  current = readTheme(store);
  applyTheme(current, root === undefined ? defaultRoot() : root);
  applyThemeColor(current, meta === undefined ? defaultThemeColorMeta() : meta);
  applyThemeManifest(current, manifestLink === undefined ? defaultManifestLink() : manifestLink);
  notify();
  return current;
}

export function getDeviceTheme(): ThemeId {
  return current;
}

/**
 * 使用者選了主題：立刻換色、寫進本機。不重載、不碰稿子。
 * 寫不進去時這一頁仍換過去，回傳是否已寫進本機。
 */
export function setDeviceTheme(
  theme: ThemeId,
  store: ThemeWriteStore | null | undefined = defaultStore(),
  root?: { setAttribute(name: string, value: string): void } | null,
  meta?: { setAttribute(name: string, value: string): void } | null,
  manifestLink?: { setAttribute(name: string, value: string): void } | null,
): boolean {
  if (!isThemeId(theme)) return false;
  current = theme;
  applyTheme(theme, root === undefined ? defaultRoot() : root);
  applyThemeColor(theme, meta === undefined ? defaultThemeColorMeta() : meta);
  applyThemeManifest(theme, manifestLink === undefined ? defaultManifestLink() : manifestLink);
  const saved = commitTheme(store, theme);
  notify();
  return saved;
}

export function subscribeDeviceTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 畫面用：目前主題。換主題時會重新繪製。 */
export function useDeviceTheme(): ThemeId {
  return useSyncExternalStore(subscribeDeviceTheme, getDeviceTheme, getDeviceTheme);
}
