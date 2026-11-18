/**
 * 查字典：按下之後的流程（WO-104，規格 B-3、E-1）
 * 先看連線，再在同一個同步呼叫堆疊內 window.open。不可有 await、setTimeout、Promise。
 * 不記錄查詢、不寫任何資料、不改稿子。
 */

import { buildDictUrl } from './selectionRules';

export type DictPressResult =
  /** 已呼叫 window.open（noopener 回 null 不算失敗） */
  | 'opened'
  /** 沒網路，沒開分頁，由 105 顯示提示 */
  | 'offline'
  /** 暫存裡沒有可查的詞，什麼都不做 */
  | 'nothing';

export interface DictPressDeps {
  isOnline: () => boolean;
  open: (url: string, target: string, features: string) => unknown;
}

const defaultDeps: DictPressDeps = {
  isOnline: () => navigator.onLine !== false,
  open: (url, target, features) => window.open(url, target, features),
};

/** word 取自暫存的選取（清理後），不在按下時再讀選取 */
export function pressDictLookup(
  word: string,
  canLookup: boolean,
  deps: DictPressDeps = defaultDeps,
): DictPressResult {
  if (!canLookup || word === '') return 'nothing';
  if (!deps.isOnline()) return 'offline';
  deps.open(buildDictUrl(word), '_blank', 'noopener');
  return 'opened';
}
