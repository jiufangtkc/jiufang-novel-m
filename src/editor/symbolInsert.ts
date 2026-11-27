/**
 * WO-142：把符號「像打字一樣」插進正文的核心流程（可用假輸入框測試）。
 *
 * 主路徑：document.execCommand('insertText') 一次插入，瀏覽器會送出真正的
 * beforeinput／input，既有 onInput → process → 自動存檔 → revealCaret 全部照走，
 * 也進入瀏覽器原生復原堆疊（一次復原整個回去）。
 * 後備路徑：execCommand 不存在、回傳 false、或沒有讓內容改變時，改用 setRangeText 並手動
 * 走一次與 onInput 相同的處理。這條路徑不保證進原生復原堆疊。
 */
import { findWritingSymbol, planSymbolInsert } from './writingSymbols';
import type { WrapRecord } from './symbolWrap';

export type InsertSymbolResult = 'inserted' | 'composing' | 'unavailable';

export interface SymbolInsertTarget {
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  readOnly?: boolean;
  disabled?: boolean;
  setRangeText(text: string, start: number, end: number, mode: 'end'): void;
  setSelectionRange(start: number, end: number): void;
  focus(options?: { preventScroll?: boolean }): void;
}

export interface SymbolInsertDeps {
  target: SymbolInsertTarget | null;
  isComposing: () => boolean;
  isFocused: () => boolean;
  /** document.execCommand('insertText', false, text) 的包裝；沒有就走後備路徑。 */
  execInsert?: (text: string) => boolean;
  /**
   * 包選取的成對符號：插入前呼叫，把這次編輯（改前／改後全文、左右符號）交給統計與刪稿暫存辨識，
   * 讓它只算兩個符號、不被當成大段刪除（見 symbolWrap.ts）。
   */
  beginWrap: (record: WrapRecord) => void;
  /** 插入流程結束（不論成敗）時呼叫，清掉尚未用掉的待套用標記。 */
  endWrap: () => void;
  /** 後備路徑：內容已改，請走與 onInput 相同的處理（含刪稿暫存追蹤）。 */
  onFallbackInput: (selection: { start: number; end: number }) => void;
  /** 游標位置在插入後又被移動時（成對符號停中間），讓游標所在行保持可見。 */
  onCaretMoved?: () => void;
}

export function insertSymbolInto(symbolId: string, deps: SymbolInsertDeps): InsertSymbolResult {
  const { target } = deps;
  const symbol = findWritingSymbol(symbolId);
  if (!target || !symbol || target.readOnly || target.disabled) return 'unavailable';
  if (deps.isComposing()) return 'composing';

  const remembered = {
    start: target.selectionStart ?? target.value.length,
    end: target.selectionEnd ?? target.selectionStart ?? target.value.length,
  };
  if (!deps.isFocused()) {
    try {
      target.focus({ preventScroll: true });
    } catch {
      target.focus();
    }
    // 取得焦點時有些瀏覽器會動到選取範圍，以記住的為準。
    target.setSelectionRange(remembered.start, remembered.end);
  }

  const start = Math.min(remembered.start, target.value.length);
  const end = Math.min(Math.max(remembered.end, start), target.value.length);
  const before = target.value;
  const plan = planSymbolInsert({ text: before, start, end, symbol });

  try {
    if (plan.wrapsSelection && symbol.right !== undefined) {
      deps.beginWrap({
        beforeText: before,
        afterText: before.slice(0, start) + plan.insertText + before.slice(end),
        left: symbol.left,
        right: symbol.right,
      });
    }
    let done = false;
    if (deps.execInsert) {
      let ok = false;
      try {
        ok = deps.execInsert(plan.insertText);
      } catch {
        ok = false;
      }
      done = ok && target.value !== before;
    }
    if (!done) {
      target.setRangeText(plan.insertText, start, end, 'end');
      deps.onFallbackInput({ start, end });
    }
    const caret = start + plan.caretOffsetInInsert;
    if (caret !== start + plan.insertText.length) {
      target.setSelectionRange(caret, caret);
      deps.onCaretMoved?.();
    } else if (!done) {
      target.setSelectionRange(caret, caret);
    }
  } finally {
    deps.endWrap();
  }
  return 'inserted';
}
