/**
 * WO-119：電腦專注模式按 Esc 離開。
 * 本檔只有純判斷與唯讀的 DOM 偵測，不執行離開、不碰正文內容與選取。
 * 監聽端（useFocusEscape）與測試共用 shouldExitFocusOnEscape。
 */
import type { LayoutMode } from '../layout';
import { hasOpenDialog } from './saveShortcuts';

export type FocusEscapeInput = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  /** KeyboardEvent.isComposing */
  isComposing?: boolean;
  keyCode?: number;
  /** 正文既有的組字狀態（EditorPane 的 isComposingRef） */
  bodyComposing?: boolean;
  focusMode: boolean;
  layoutMode: LayoutMode;
  /** (pointer: fine) 是否成立 */
  pointerFine: boolean;
  /** 既有操作方式設定：'touch' 或 'mouse' */
  pointer: 'touch' | 'mouse' | string;
  /** 按下當下是否已有可用 Esc 關閉的對象（對話框、卡片、搜尋、選單、提示、其他輸入框） */
  escapeTargetOpen: boolean;
  /** 本次按鍵是否已被其他行為處理（例如 defaultPrevented） */
  handled?: boolean;
};

/** 此版面與指標是否適用電腦鍵盤離開專注：medium／wide，且 fine 或 pointer !== 'touch'。 */
export function isKeyboardFocusEscapeLayout(
  layoutMode: LayoutMode,
  pointerFine: boolean,
  pointer: string,
): boolean {
  if (layoutMode !== 'medium' && layoutMode !== 'wide') return false;
  return pointerFine || pointer !== 'touch';
}

/** 這次 Escape 要不要離開專注模式（純函式，不讀 DOM）。 */
export function shouldExitFocusOnEscape(input: FocusEscapeInput): boolean {
  if (input.key !== 'Escape') return false;
  if (input.ctrlKey || input.metaKey || input.altKey || input.shiftKey) return false;
  if (input.repeat) return false;
  if (!input.focusMode) return false;
  if (input.isComposing || input.bodyComposing || input.keyCode === 229) return false;
  if (input.escapeTargetOpen || input.handled) return false;
  return isKeyboardFocusEscapeLayout(input.layoutMode, input.pointerFine, input.pointer);
}

function isDisplayed(el: Element): boolean {
  if (el.closest('[hidden], [aria-hidden="true"]')) return false;
  if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false;
  return true;
}

const OVERLAY_SELECTORS = [
  '[data-testid="writing-cards-drawer"]',
  '[data-testid="book-search-panel"]',
  '[data-testid="tree-title-tip"]',
  '[role="tooltip"]',
  '[role="menu"]',
  '[data-testid="progress-menu"]',
  '[data-testid="node-menu"]',
  '[data-testid="volume-menu"]',
];

/**
 * 按鍵當下（capture 階段，其他處理尚未執行）是否已有 Esc 關閉對象。
 * 其他輸入框（搜尋、卡片、改名）自有 Esc 行為，視為關閉對象；只有正文框不算。
 */
export function hasEscapeTarget(doc: Document, target: EventTarget | null): boolean {
  if (hasOpenDialog(doc)) return true;
  for (const selector of OVERLAY_SELECTORS) {
    for (const el of Array.from(doc.querySelectorAll(selector))) {
      if (isDisplayed(el)) return true;
    }
  }
  const el = target as HTMLElement | null;
  if (el && typeof el.closest === 'function') {
    const field = el.closest('input, textarea, select, [contenteditable="true"]');
    if (field && field.getAttribute('data-testid') !== 'writing-input') return true;
  }
  return false;
}
