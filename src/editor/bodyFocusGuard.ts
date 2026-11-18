/**
 * WO-82：按專注模式、看卡片等按鈕時，正文的焦點與游標不要跑掉。
 *
 * 瀏覽器按下按鈕時，預設會把焦點從正文搶走。正文原本有焦點時，
 * 在 pointerdown 就擋掉這個預設動作（點擊仍會照常送出），
 * 焦點留在正文，游標不動，使用者不必再點一次正文才能續寫。
 * 這裡只管焦點，不改選取範圍，所以不會把游標放到文末，也不會蓋掉使用者後來選的位置。
 */
import type { WritingCaretSnapshot } from '../domain/writingCards';

export interface FocusableBody {
  selectionStart: number | null;
  selectionEnd: number | null;
  scrollTop: number;
  focus(options?: { preventScroll?: boolean }): void;
}

export interface PreventableEvent {
  preventDefault(): void;
}

function isActive(textarea: FocusableBody | null): boolean {
  return Boolean(textarea) && typeof document !== 'undefined' && document.activeElement === textarea;
}

/**
 * 按鈕 pointerdown：正文正有焦點就擋掉按鈕搶焦點。回傳「按下當下正文是否有焦點」。
 * 正文沒有焦點（例如正在編輯卡片、或使用者本來就沒在打字）時什麼都不做，不主動把焦點交給正文。
 */
export function keepBodyFocusOnPointerDown(
  textarea: FocusableBody | null,
  event: PreventableEvent,
): boolean {
  if (!isActive(textarea)) return false;
  event.preventDefault();
  return true;
}

/**
 * 切換完成後的保險：按下當下正文有焦點、但現在焦點不在正文，就立即叫回正文。
 * 只叫回焦點，不動選取範圍（原游標瀏覽器自己保留）。回傳是否真的叫回。
 */
export function refocusBodyIfLost(textarea: FocusableBody | null, hadFocus: boolean): boolean {
  if (!textarea || !hadFocus || isActive(textarea)) return false;
  try {
    textarea.focus({ preventScroll: true });
  } catch {
    textarea.focus();
  }
  return true;
}

/**
 * 關閉看卡片時用的還原快照：焦點狀態取開啟時的記錄，
 * 位置與捲動則以「現在」為準——僅查看時使用者可能繼續打字或移動游標，不可被舊快照蓋掉。
 */
export function snapshotForCardsClose(
  textarea: FocusableBody | null,
  opened: WritingCaretSnapshot | null,
): WritingCaretSnapshot | null {
  if (!textarea || !opened) return opened;
  return {
    selectionStart: textarea.selectionStart ?? opened.selectionStart,
    selectionEnd: textarea.selectionEnd ?? opened.selectionEnd,
    scrollTop: textarea.scrollTop ?? opened.scrollTop,
    wasFocused: opened.wasFocused || isActive(textarea),
  };
}
