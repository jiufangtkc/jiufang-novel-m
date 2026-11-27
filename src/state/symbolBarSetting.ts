import { useSyncExternalStore } from 'react';
import type { PointerMode } from '../layout/layoutMode';

/**
 * WO-142：「全形標點列」開關。只存在這個瀏覽器（localStorage），不寫進 .db。
 * 沒存過：用手指的裝置預設開、用滑鼠的預設關。存過以使用者選的為準；壞值當作沒存過。
 */

export const SYMBOL_BAR_STORAGE_KEY = 'jiufang-novel-m.symbol-bar.v1';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): Store | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** 讀已存的選擇：'1'→true、'0'→false，其他（沒存、壞值、讀不到）→null。 */
export function readSymbolBarStored(store: Pick<Storage, 'getItem'> | null = storage()): boolean | null {
  try {
    const raw = store?.getItem(SYMBOL_BAR_STORAGE_KEY);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return null;
  } catch {
    return null;
  }
}

export function resolveSymbolBarEnabled(stored: boolean | null, pointer: PointerMode): boolean {
  return stored ?? pointer === 'touch';
}

const listeners = new Set<() => void>();
let current: boolean | null | undefined;

export function writeSymbolBarSetting(on: boolean, store: Store | null = storage()): void {
  try {
    store?.setItem(SYMBOL_BAR_STORAGE_KEY, on ? '1' : '0');
  } catch {
    // 存不進去就只在這次有效。
  }
  current = on;
  for (const listener of listeners) listener();
}

function snapshot(): boolean | null {
  if (current === undefined) current = readSymbolBarStored();
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 回傳 [目前是否開著, 設定函式]；沒存過時依裝置操作方式（pointer）決定預設。 */
export function useSymbolBarSetting(pointer: PointerMode): [boolean, (on: boolean) => void] {
  const stored = useSyncExternalStore(subscribe, snapshot, () => null);
  return [resolveSymbolBarEnabled(stored, pointer), writeSymbolBarSetting];
}

/** 測試用：模擬重新打開 App。 */
export function resetSymbolBarSession(): void {
  current = undefined;
}
