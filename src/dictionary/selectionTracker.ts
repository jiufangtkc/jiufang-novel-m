/**
 * 查字典：暫存選取（WO-104，規格 E-2、E-4、來源互斥）
 * 框架無關的小控制器；每次把「清理後的詞、是否可查、來源」存起來，按下時只用這份暫存。
 * 同一時間只有一個來源（正文或卡片內容）。
 */

import { evaluateSelection } from './selectionRules';
import { pressDictLookup, type DictPressDeps, type DictPressResult } from './dictLookup';

export type DictSource = 'body' | 'card';

export interface DictSelectionState {
  word: string;
  canLookup: boolean;
  source: DictSource | null;
}

export interface DictSelectionReading {
  source: DictSource;
  /** 輸入框是否有焦點 */
  focused: boolean;
  /** 輸入框內容、選取起訖 */
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

const EMPTY: DictSelectionState = { word: '', canLookup: false, source: null };

export function createDictSelectionTracker() {
  let state: DictSelectionState = EMPTY;
  let pressing = false;
  const composing = new Set<DictSource>();
  const listeners = new Set<() => void>();

  const set = (next: DictSelectionState) => {
    if (next.word === state.word && next.canLookup === state.canLookup && next.source === state.source) return;
    state = next;
    listeners.forEach((fn) => fn());
  };

  /** 清掉該來源的暫存；現在的暫存屬於別的來源就不動 */
  const clear = (source: DictSource) => {
    if (state.source === source) set(EMPTY);
  };

  return {
    getState: (): DictSelectionState => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    /** 依輸入框目前的狀況重新判斷並暫存 */
    update(r: DictSelectionReading) {
      if (!r.focused && !pressing) return clear(r.source);
      const hasRange = r.selectionStart !== r.selectionEnd;
      if (!hasRange) return clear(r.source);
      const lo = Math.min(r.selectionStart, r.selectionEnd);
      const hi = Math.max(r.selectionStart, r.selectionEnd);
      const ev = evaluateSelection(r.value.slice(lo, hi), composing.has(r.source));
      if (!ev.canLookup) return clear(r.source);
      set({ word: ev.word, canLookup: true, source: r.source });
    },

    compositionStart(source: DictSource) {
      composing.add(source);
      clear(source);
    },
    /** 組字結束後，呼叫端要接著 update 重新判斷 */
    compositionEnd(source: DictSource) {
      composing.delete(source);
    },

    /** 失焦：正在按查字典時不藏，否則清掉 */
    blur(source: DictSource) {
      if (!pressing) clear(source);
    },
    beginPress() {
      pressing = true;
    },
    endPress() {
      pressing = false;
    },

    /** 按下：只用暫存，不再讀選取；同步開窗 */
    press(deps?: DictPressDeps): DictPressResult {
      return pressDictLookup(state.word, state.canLookup, deps);
    },
  };
}

export type DictSelectionTracker = ReturnType<typeof createDictSelectionTracker>;
