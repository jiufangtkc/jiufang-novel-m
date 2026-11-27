/**
 * WO-142：「用成對符號把選取文字包起來」的統計與復原辨識（純邏輯，不碰 DOM）。
 *
 * 包選取時，正文實際只多了左右兩個符號；但逐字比對前後全文會把整段選取文字
 * 當成「刪掉再貼上」。這裡記住這次編輯（改前全文、改後全文、左右符號），讓：
 *  - 緊接著的那一次 input（包起來）、
 *  - 之後剛好是它逆操作的 input（復原）、剛好重做的 input（重做），
 * 都只算兩個符號的增減，也不會被當成大段刪除收進刪稿暫存。
 * 使用者做了任何其他編輯，記憶就清掉；換章時整個追蹤器隨章節重建。
 */
import { classifyTextDelta, type TextDelta } from '../domain/writingLog';
import { countWords } from '../domain/wordCount';

export interface WrapRecord {
  beforeText: string;
  afterText: string;
  left: string;
  right: string;
}

export type WrapEditKind = 'apply' | 'revert';

export interface WrapResolution {
  kind: WrapEditKind;
  delta: TextDelta;
}

/** 這次編輯是否剛好是該筆包選取（apply，含重做）或它的逆操作（revert，即復原）。 */
export function matchWrapEdit(record: WrapRecord | null, before: string, after: string): WrapEditKind | null {
  if (!record) return null;
  if (before === record.beforeText && after === record.afterText) return 'apply';
  if (before === record.afterText && after === record.beforeText) return 'revert';
  return null;
}

/** 只算左右兩個符號的統計；整章字數增減照既有算法（兩個符號是否算字依 wordCount 規則）。 */
export function wrapDelta(record: WrapRecord, kind: WrapEditKind, before: string, after: string): TextDelta {
  const symbolWords = countWords(record.left + record.right);
  return {
    wordDelta: classifyTextDelta(before, after).wordDelta,
    insertedChars: kind === 'apply' ? symbolWords : 0,
    deletedChars: kind === 'revert' ? symbolWords : 0,
    largeInsert: false,
    largeDelete: false,
  };
}

export interface WrapTracker {
  /** 插入流程開始：下一次 input 若剛好是這筆包選取，就套用。 */
  begin: (record: WrapRecord) => void;
  /** 插入流程結束（finally）：未被用掉的待套用標記一定清除；已確認的記憶（供復原／重做）保留。 */
  end: () => void;
  /** 每次內容改變時呼叫；回傳 null 代表一般編輯（此時會清掉記憶）。 */
  resolve: (before: string, after: string) => WrapResolution | null;
  clear: () => void;
  /** 測試用。 */
  peek: () => { pending: WrapRecord | null; last: WrapRecord | null };
}

export function createWrapTracker(): WrapTracker {
  let pending: WrapRecord | null = null;
  let last: WrapRecord | null = null;
  return {
    begin(record) {
      pending = record;
    },
    end() {
      pending = null;
    },
    resolve(before, after) {
      const fromPending = matchWrapEdit(pending, before, after);
      if (pending && fromPending === 'apply') {
        const record = pending;
        pending = null;
        last = record;
        return { kind: 'apply', delta: wrapDelta(record, 'apply', before, after) };
      }
      pending = null;
      const kind = matchWrapEdit(last, before, after);
      if (last && kind) return { kind, delta: wrapDelta(last, kind, before, after) };
      last = null;
      return null;
    },
    clear() {
      pending = null;
      last = null;
    },
    peek: () => ({ pending, last }),
  };
}
