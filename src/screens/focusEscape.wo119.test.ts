import { describe, expect, it, vi } from 'vitest';
import { createSaveShortcutHandler } from './saveShortcuts';
import {
  hasEscapeTarget,
  isKeyboardFocusEscapeLayout,
  shouldExitFocusOnEscape,
  type FocusEscapeInput,
} from './focusEscape';

const base: FocusEscapeInput = {
  key: 'Escape',
  focusMode: true,
  layoutMode: 'wide',
  pointerFine: true,
  pointer: 'mouse',
  escapeTargetOpen: false,
};

/** 假的 exitFocusMode 呼叫端：與監聽相同流程（判斷成立才呼叫一次）。 */
function press(input: FocusEscapeInput, exit: () => void) {
  if (shouldExitFocusOnEscape(input)) exit();
}

describe('WO-119：Esc 離開專注的純判斷', () => {
  it('已專注、適用版面、無關閉對象、非組字：Escape 離開；其他鍵與未專注不離開', () => {
    expect(shouldExitFocusOnEscape(base)).toBe(true);
    expect(shouldExitFocusOnEscape({ ...base, key: 'Enter' })).toBe(false);
    expect(shouldExitFocusOnEscape({ ...base, key: 'a' })).toBe(false);
    expect(shouldExitFocusOnEscape({ ...base, focusMode: false })).toBe(false);
  });

  it('關閉對象開著時第一次不離開；同一次已處理也不離開；下一次全清才離開', () => {
    const exit = vi.fn();
    // 第一次：按下當下有對象（即使稍後已關閉，判斷在按下當下已定）
    press({ ...base, escapeTargetOpen: true }, exit);
    expect(exit).not.toHaveBeenCalled();
    press({ ...base, handled: true }, exit);
    expect(exit).not.toHaveBeenCalled();
    // 第二次：全清
    press(base, exit);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('多層對象逐層處理：每層各吃一次 Esc，最後才離開', () => {
    const exit = vi.fn();
    for (const open of [true, true, false]) press({ ...base, escapeTargetOpen: open }, exit);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('組字中（isComposing、正文組字、keyCode 229）不離開，包含 overlay 開著；結束後恢復', () => {
    expect(shouldExitFocusOnEscape({ ...base, isComposing: true })).toBe(false);
    expect(shouldExitFocusOnEscape({ ...base, bodyComposing: true })).toBe(false);
    expect(shouldExitFocusOnEscape({ ...base, keyCode: 229 })).toBe(false);
    expect(shouldExitFocusOnEscape({ ...base, isComposing: true, escapeTargetOpen: true })).toBe(false);
    expect(shouldExitFocusOnEscape({ ...base, isComposing: false, bodyComposing: false, keyCode: 27 })).toBe(true);
  });

  it('適用版面：medium／wide 的 fine 路徑與 coarse＋mouse 路徑成立', () => {
    for (const layoutMode of ['medium', 'wide'] as const) {
      expect(shouldExitFocusOnEscape({ ...base, layoutMode, pointerFine: true, pointer: 'touch' })).toBe(true);
      expect(shouldExitFocusOnEscape({ ...base, layoutMode, pointerFine: false, pointer: 'mouse' })).toBe(true);
      expect(isKeyboardFocusEscapeLayout(layoutMode, false, 'touch')).toBe(false);
      expect(shouldExitFocusOnEscape({ ...base, layoutMode, pointerFine: false, pointer: 'touch' })).toBe(false);
    }
  });

  it('手機直拿／橫拿一律不離開，即使 fine 或 mouse', () => {
    for (const layoutMode of ['phone-portrait', 'phone-landscape'] as const) {
      expect(shouldExitFocusOnEscape({ ...base, layoutMode })).toBe(false);
      expect(shouldExitFocusOnEscape({ ...base, layoutMode, pointerFine: true, pointer: 'mouse' })).toBe(false);
    }
  });

  it('虛擬鍵盤高度變動不在輸入內，不改變結果；修飾鍵與 repeat 不離開', () => {
    expect(shouldExitFocusOnEscape({ ...base, pointerFine: false, pointer: 'touch' })).toBe(false);
    expect(shouldExitFocusOnEscape({ ...base, ctrlKey: true })).toBe(false);
    expect(shouldExitFocusOnEscape({ ...base, metaKey: true })).toBe(false);
    expect(shouldExitFocusOnEscape({ ...base, altKey: true })).toBe(false);
    expect(shouldExitFocusOnEscape({ ...base, shiftKey: true })).toBe(false);
    expect(shouldExitFocusOnEscape({ ...base, repeat: true })).toBe(false);
  });

  it('只呼叫一次離開，不動文字與選取、不 blur', () => {
    const el = { value: '【範例】測試', selectionStart: 2, selectionEnd: 4, selectionDirection: 'backward', blur: vi.fn(), setSelectionRange: vi.fn() };
    const before = { ...el };
    const exit = vi.fn();
    press(base, exit);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(el.value).toBe(before.value);
    expect(el.selectionStart).toBe(2);
    expect(el.selectionEnd).toBe(4);
    expect(el.selectionDirection).toBe('backward');
    expect(el.blur).not.toHaveBeenCalled();
    expect(el.setSelectionRange).not.toHaveBeenCalled();
  });

  it('Ctrl/Cmd+S 與 Ctrl/Cmd+Shift+S 不被 Esc 判斷消耗，存檔處理照常', () => {
    expect(shouldExitFocusOnEscape({ ...base, key: 's', ctrlKey: true })).toBe(false);
    expect(shouldExitFocusOnEscape({ ...base, key: 'S', metaKey: true, shiftKey: true })).toBe(false);
    const saveProject = vi.fn(async () => undefined);
    const saveProjectAs = vi.fn(async () => undefined);
    const handler = createSaveShortcutHandler({
      getActions: () => ({ saveProject, saveProjectAs }),
      isDialogOpen: () => false,
    });
    const preventDefault = vi.fn();
    handler({ key: 's', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, preventDefault });
    expect(saveProject).toHaveBeenCalledTimes(1);
  });
});

type FakeEl = Record<string, unknown>;

function fakeDoc(visible: string[], hidden: string[] = []): Document {
  const shown: FakeEl = {
    hidden: false,
    closest: () => null,
    getAttribute: () => null,
    getClientRects: () => [{}],
  };
  const gone: FakeEl = { ...shown, getClientRects: () => [] };
  return {
    querySelector: (selector: string) => (selector === 'dialog[open]' && visible.includes('dialog') ? shown : null),
    querySelectorAll: (selector: string) => {
      if (visible.includes(selector)) return [shown];
      if (hidden.includes(selector)) return [gone];
      return [];
    },
  } as unknown as Document;
}

function fakeTarget(testId: string | null, isField: boolean): EventTarget {
  return {
    closest: () => (isField ? { getAttribute: () => testId } : null),
  } as unknown as EventTarget;
}

describe('WO-119：關閉對象偵測（假 DOM）', () => {
  it('卡片、搜尋、目錄提示、選單、對話框各自開啟都算有關閉對象', () => {
    for (const sel of [
      '[data-testid="writing-cards-drawer"]',
      '[data-testid="book-search-panel"]',
      '[data-testid="tree-title-tip"]',
      '[data-testid="progress-menu"]',
      '[role="menu"]',
    ]) {
      expect(hasEscapeTarget(fakeDoc([sel]), null), sel).toBe(true);
    }
    expect(hasEscapeTarget(fakeDoc(['dialog']), null)).toBe(true);
  });

  it('隱藏的搜尋面板（例如專注時收起）不算；全清為 false', () => {
    expect(hasEscapeTarget(fakeDoc([], ['[data-testid="book-search-panel"]']), null)).toBe(false);
    expect(hasEscapeTarget(fakeDoc([]), null)).toBe(false);
  });

  it('其他輸入框（搜尋、卡片、改名）算有對象；正文框不算', () => {
    expect(hasEscapeTarget(fakeDoc([]), fakeTarget('search-input', true))).toBe(true);
    expect(hasEscapeTarget(fakeDoc([]), fakeTarget(null, true))).toBe(true);
    expect(hasEscapeTarget(fakeDoc([]), fakeTarget('writing-input', true))).toBe(false);
    expect(hasEscapeTarget(fakeDoc([]), fakeTarget(null, false))).toBe(false);
  });
});
