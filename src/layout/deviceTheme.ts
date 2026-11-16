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
): ThemeId {
  current = readTheme(store);
  applyTheme(current, root === undefined ? defaultRoot() : root);
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
): boolean {
  if (!isThemeId(theme)) return false;
  current = theme;
  applyTheme(theme, root === undefined ? defaultRoot() : root);
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
