import {
  extractDeletedRange,
  extractTrashAnchor,
  shouldAutoCaptureDeletion,
  type SelectionSnapshot,
} from '../domain/trash';
import {
  classifyTextDelta,
  type TextChangeSource,
} from '../domain/writingLog';

/** WO-138：系統復原自動撤回時間窗（15 秒）。 */
export const TRASH_UNDO_WINDOW_MS = 15_000;

export interface LastAutoTrash {
  itemId: string;
  chapterId: string;
  beforeText: string;
  afterText: string;
  capturedAtMs: number;
  deletionWordDelta: number;
}

export interface TrashCapturePayload {
  deletedText: string;
  wordCount: number;
  beforeAnchor: string;
  afterAnchor: string;
  charOffset: number;
  beforeText: string;
  afterText: string;
  capturedAtMs: number;
  deletionWordDelta: number;
}

export type TrashEditOutcome =
  | { kind: 'none' }
  | { kind: 'undo'; itemId: string }
  | { kind: 'capture'; payload: TrashCapturePayload };

export interface TrashCaptureTracker {
  noteSelection: (start: number, end: number, beforeLength: number) => void;
  noteHistoryUndo: () => void;
  handleEdit: (input: {
    chapterId: string;
    before: string;
    after: string;
    source: TextChangeSource;
    nowMs: number;
  }) => TrashEditOutcome;
  rememberAutoTrash: (itemId: string, chapterId: string, payload: TrashCapturePayload) => void;
  getLastAutoTrash: () => LastAutoTrash | null;
  clear: () => void;
}

/**
 * WO-138：編輯器正文刪除自動收集與系統復原雙層撤回追蹤器（純記憶體、依附單次章節編輯生命週期）。
 */
export function createTrashCaptureTracker(): TrashCaptureTracker {
  let pendingSelection: SelectionSnapshot | null = null;
  let pendingHistoryUndo = false;
  let lastAutoTrash: LastAutoTrash | null = null;

  return {
    noteSelection(start, end, beforeLength) {
      pendingHistoryUndo = false;
      if (end > start && start >= 0 && beforeLength >= end) {
        pendingSelection = { start, end, beforeLength };
      } else {
        pendingSelection = null;
      }
    },

    noteHistoryUndo() {
      pendingSelection = null;
      pendingHistoryUndo = true;
    },

    handleEdit({ chapterId, before, after, source, nowMs }) {
      const selection = pendingSelection;
      const isHistoryUndo = pendingHistoryUndo;
      pendingSelection = null;
      pendingHistoryUndo = false;

      if (lastAutoTrash) {
        const withinWindow = nowMs - lastAutoTrash.capturedAtMs <= TRASH_UNDO_WINDOW_MS;
        const sameChapter = lastAutoTrash.chapterId === chapterId;
        if (sameChapter && withinWindow) {
          // 第 1 層：明確 historyUndo 且正文精確回到刪前內容
          if (isHistoryUndo && after === lastAutoTrash.beforeText) {
            const itemId = lastAutoTrash.itemId;
            lastAutoTrash = null;
            return { kind: 'undo', itemId };
          }
          // 第 2 層：行動鍵盤無 historyUndo 補底（15 秒內、非 paste、單次從 afterText 精確變回 beforeText）
          if (
            source !== 'paste' &&
            before === lastAutoTrash.afterText &&
            after === lastAutoTrash.beforeText
          ) {
            const itemId = lastAutoTrash.itemId;
            lastAutoTrash = null;
            return { kind: 'undo', itemId };
          }
        }
        // 切章、超過 15 秒或進行了其他文字編輯即清除最近自動收錄紀錄
        lastAutoTrash = null;
      }

      const range = extractDeletedRange(before, after, selection);
      if (range.end <= range.start) {
        return { kind: 'none' };
      }

      const anchor = extractTrashAnchor(before, range.start, range.end);
      if (!shouldAutoCaptureDeletion(anchor.wordCount)) {
        return { kind: 'none' };
      }

      const withoutDeleted = before.slice(0, range.start) + before.slice(range.end);
      const deletionWordDelta = classifyTextDelta(before, withoutDeleted).wordDelta;

      return {
        kind: 'capture',
        payload: {
          ...anchor,
          beforeText: before,
          afterText: after,
          capturedAtMs: nowMs,
          deletionWordDelta,
        },
      };
    },

    rememberAutoTrash(itemId, chapterId, payload) {
      lastAutoTrash = {
        itemId,
        chapterId,
        beforeText: payload.beforeText,
        afterText: payload.afterText,
        capturedAtMs: payload.capturedAtMs,
        deletionWordDelta: payload.deletionWordDelta,
      };
    },

    getLastAutoTrash() {
      return lastAutoTrash;
    },

    clear() {
      pendingSelection = null;
      pendingHistoryUndo = false;
      lastAutoTrash = null;
    },
  };
}
