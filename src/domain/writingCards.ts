import { revealCaret } from '../editor/caret';
import { isCategoryHidden, isLegacyCardId, isLegacyCategoryId } from './cards';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 預設打開的分類代碼（文字創作者意見：角色） */
export const DEFAULT_WRITING_CARD_CATEGORY = 'character';

/** 稿件卡片閱讀位置之儲存前綴 */
export const WRITING_CARDS_STORAGE_PREFIX = 'jiufang:writing-cards:';

export interface WritingCardsViewState {
  categoryId: string | null;
  cardId: string | null;
}

export interface WritingCaretSnapshot {
  selectionStart: number;
  selectionEnd: number;
  scrollTop: number;
  wasFocused: boolean;
}

export type OpenCardsDecision =
  | { action: 'open-immediately' }
  | { action: 'defer-until-composition-end' };

// 記憶體備援（若 storage 不可用或在測試環境）
const memoryCardViewState = new Map<string, WritingCardsViewState>();

function storageKey(projectId: string): string {
  return `${WRITING_CARDS_STORAGE_PREFIX}${projectId}`;
}

function normalizeStoredWritingCardsView(
  parsed: Partial<WritingCardsViewState>,
): WritingCardsViewState {
  const rawCategoryId = typeof parsed.categoryId === 'string' ? parsed.categoryId.trim() : '';
  if (!rawCategoryId || isLegacyCategoryId(rawCategoryId) || isCategoryHidden(rawCategoryId)) {
    return {
      categoryId: DEFAULT_WRITING_CARD_CATEGORY,
      cardId: null,
    };
  }
  const rawCardId = typeof parsed.cardId === 'string' ? parsed.cardId.trim() : '';
  const validCardId = rawCardId && !isLegacyCardId(rawCardId) ? rawCardId : null;
  return {
    categoryId: rawCategoryId,
    cardId: validCardId,
  };
}

/**
 * 取得指定稿件上次閱讀的分類與卡片；若尚未看過或遇到舊代碼則退回預設「角色」分類。
 * 不同稿件之間絕對隔離，不沿用彼此的閱讀位置。
 */
export function getStoredWritingCardsView(
  projectId: string,
  storage?: KeyValueStorage | null,
): WritingCardsViewState {
  if (!projectId) {
    return { categoryId: DEFAULT_WRITING_CARD_CATEGORY, cardId: null };
  }

  // 1. 嘗試從 storage 讀取
  if (storage) {
    try {
      const raw = storage.getItem(storageKey(projectId));
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<WritingCardsViewState>;
        return normalizeStoredWritingCardsView(parsed);
      }
    } catch {
      // 略過 storage 例外
    }
  }

  // 2. 嘗試從記憶體讀取
  const mem = memoryCardViewState.get(projectId);
  if (mem) {
    return normalizeStoredWritingCardsView(mem);
  }

  // 3. 預設值：打開「角色」分類
  return {
    categoryId: DEFAULT_WRITING_CARD_CATEGORY,
    cardId: null,
  };
}

/**
 * 儲存指定稿件上次閱讀的分類與卡片位置。
 */
export function saveStoredWritingCardsView(
  projectId: string,
  state: WritingCardsViewState,
  storage?: KeyValueStorage | null,
): void {
  if (!projectId) return;

  const data: WritingCardsViewState = {
    categoryId: state.categoryId ?? null,
    cardId: state.cardId ?? null,
  };

  memoryCardViewState.set(projectId, data);

  if (storage) {
    try {
      storage.setItem(storageKey(projectId), JSON.stringify(data));
    } catch {
      // 略過 storage 例外
    }
  }
}

/**
 * 清除指定稿件之卡片閱讀狀態（供測試或稿件清理使用）。
 */
export function clearStoredWritingCardsView(
  projectId: string,
  storage?: KeyValueStorage | null,
): void {
  memoryCardViewState.delete(projectId);
  if (storage) {
    try {
      storage.removeItem(storageKey(projectId));
    } catch {
      // 略過
    }
  }
}

/** 組字逾時時間：3 秒內未等到 compositionend 則自動清理待開啟標記 */
export const COMPOSITION_TIMEOUT_MS = 3000;

export interface PointerDownCardsResult {
  preventDefault: boolean;
  isPendingOpen: boolean;
}

/**
 * 處理看卡片按鈕之 pointerdown / mousedown：
 * - 若正處於注音組字中，呼叫 preventDefault 避免輸入框失焦打斷組字，並設定待開啟狀態
 * - 若未在組字中，不阻止預設行為（允許焦點正常轉移，避免軟體鍵盤持續遮擋面板）
 */
export function handleCardsPointerDown(isComposing: boolean): PointerDownCardsResult {
  if (isComposing) {
    return {
      preventDefault: true,
      isPendingOpen: true,
    };
  }
  return {
    preventDefault: false,
    isPendingOpen: false,
  };
}

/**
 * 判斷正文失焦（onBlur）、換章節、收起或逾時時是否應取消待開啟標記。
 * 避免待開啟狀態在輸入中斷後永久殘留，於日後打字時突然彈出。
 */
export function shouldCancelPendingOpen(
  trigger: 'blur' | 'chapter-change' | 'close' | 'timeout',
): boolean {
  return Boolean(trigger);
}

/**
 * 判斷是否可立即打開卡片面板。
 * 注音或組字進行中（compositionstart 到 compositionend 之間）不可打斷或吃掉正在組的字，
 * 須暫緩開啟，待 compositionend 完成後再開。
 */
export function decideOpenCards(isComposing: boolean): OpenCardsDecision {
  if (isComposing) {
    return { action: 'defer-until-composition-end' };
  }
  return { action: 'open-immediately' };
}

/**
 * 擷取當前正文 textarea 的游標位置、選取範圍、捲動高度及聚焦狀態。
 */
export function captureCaretSnapshot(
  textarea: HTMLTextAreaElement | null,
  isFocused: boolean,
): WritingCaretSnapshot | null {
  if (!textarea) return null;
  const active =
    typeof document !== 'undefined' && document.activeElement === textarea;
  return {
    selectionStart: textarea.selectionStart ?? 0,
    selectionEnd: textarea.selectionEnd ?? 0,
    scrollTop: textarea.scrollTop ?? 0,
    wasFocused: isFocused || active,
  };
}

/**
 * 收起卡片面板時，於使用者手勢處理函式中同步還原游標、選取範圍、捲動高度與焦點。
 * iOS Safari 必須在手勢事件當下同步呼叫 focus() 才能叫出虛擬鍵盤，絕不可用 setTimeout 延後。
 */
export function restoreCaretSnapshot(
  textarea: HTMLTextAreaElement | null,
  snapshot: WritingCaretSnapshot | null,
): void {
  if (!textarea || !snapshot) return;

  if (snapshot.wasFocused) {
    textarea.focus();
  }

  try {
    textarea.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
  } catch {
    // 容錯防護
  }

  textarea.scrollTop = snapshot.scrollTop;

  if (snapshot.wasFocused) {
    try {
      revealCaret(textarea);
    } catch {
      // 容錯防護（如無 DOM/getComputedStyle 之環境）
    }
  }
}
