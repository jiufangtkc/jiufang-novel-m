/**
 * 查字典：觀察輸入框選取的小 hook（WO-104）
 * 只觀察選取，不改輸入框、不攔組字、剪貼簿或鍵盤事件。
 * 每個來源（正文、卡片內容）共用同一個 tracker，以維持同時只有一顆。
 */

import { useCallback, useEffect, useState, type RefObject } from 'react';
import {
  createDictSelectionTracker,
  type DictSelectionState,
  type DictSelectionTracker,
  type DictSource,
} from './selectionTracker';

/** 全 App 共用一個，確保同一時間只有一個來源 */
export const dictSelectionTracker: DictSelectionTracker = createDictSelectionTracker();

function useTrackerState(tracker: DictSelectionTracker): DictSelectionState {
  const [state, setState] = useState<DictSelectionState>(() => tracker.getState());
  useEffect(() => {
    setState(tracker.getState());
    return tracker.subscribe(() => setState(tracker.getState()));
  }, [tracker]);
  return state;
}

/** 屬性標記：鍵盤移焦時用來辨識「查字典」按鈕 */
export const DICT_BUTTON_ATTR = 'data-dict-button';

/** 焦點移往的元素是不是查字典按鈕 */
export function isDictButtonTarget(t: unknown): boolean {
  const el = t as { closest?: (sel: string) => unknown } | null;
  return !!el && typeof el.closest === 'function' && !!el.closest(`[${DICT_BUTTON_ATTR}]`);
}

/**
 * 把輸入框的選取、組字、焦點事件接到 tracker；回傳解除函式。
 * 失焦時若焦點移往查字典按鈕（鍵盤 Tab／Shift+Tab），保留暫存與入口，讓 Enter／空白鍵能開窗；
 * 移往其他元素或沒有目標則照常清除。
 */
export function bindDictTextarea(
  el: HTMLTextAreaElement,
  doc: Pick<Document, 'activeElement' | 'addEventListener' | 'removeEventListener'> &
    Partial<Pick<Document, 'querySelector'>>,
  source: DictSource,
  tracker: DictSelectionTracker,
): () => void {
  const read = () =>
    tracker.update({
      source,
      focused: doc.activeElement === el,
      value: el.value,
      selectionStart: el.selectionStart,
      selectionEnd: el.selectionEnd,
    });
  const onCompositionStart = () => tracker.compositionStart(source);
  const onCompositionEnd = () => {
    tracker.compositionEnd(source);
    read();
  };
  const onBlur = (e: Event) => {
    if (isDictButtonTarget((e as FocusEvent).relatedTarget)) return;
    tracker.blur(source);
  };
  /**
   * 鍵盤 Tab／Shift+Tab：查字典按鈕可見且有合格選取時，直接把焦點移到按鈕，
   * 不經過中間的顏色、取消、搜尋等控制項（實際 DOM 順序中按鈕不在輸入框旁）。
   */
  const onKeyDown = (e: Event) => {
    const k = e as KeyboardEvent;
    if (k.key !== 'Tab' || k.ctrlKey || k.altKey || k.metaKey || k.isComposing) return;
    const st = tracker.getState();
    if (!st.canLookup || st.source !== source || doc.activeElement !== el) return;
    const btn = doc.querySelector?.(`[${DICT_BUTTON_ATTR}="${source}"]`) as HTMLElement | null | undefined;
    if (!btn || typeof btn.focus !== 'function') return;
    k.preventDefault();
    btn.focus();
  };
  const onSelectionChange = () => {
    if (doc.activeElement === el) read();
  };
  const events: Array<[string, (e: Event) => void]> = [
    ['select', read],
    ['pointerup', read],
    ['keyup', read],
    ['focus', read],
    ['blur', onBlur],
    ['keydown', onKeyDown],
    ['compositionstart', onCompositionStart],
    ['compositionend', onCompositionEnd],
  ];
  events.forEach(([name, fn]) => el.addEventListener(name, fn));
  doc.addEventListener('selectionchange', onSelectionChange);
  return () => {
    events.forEach(([name, fn]) => el.removeEventListener(name, fn));
    doc.removeEventListener('selectionchange', onSelectionChange);
    tracker.blur(source);
  };
}

export function useDictSelection(
  source: DictSource,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  tracker: DictSelectionTracker = dictSelectionTracker,
  /** 輸入框是後來才掛上（例如卡片切到編輯模式）時，用它通知重新綁定監聽 */
  rebindKey: unknown = null,
) {
  const state = useTrackerState(tracker);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return undefined;
    return bindDictTextarea(el, document, source, tracker);
  }, [source, textareaRef, tracker, rebindKey]);

  /** 按鈕 pointerdown：保住焦點與選取 */
  const onPointerDown = useCallback(
    (e: { preventDefault: () => void }) => {
      e.preventDefault();
      tracker.beginPress();
    },
    [tracker],
  );
  /** 按鈕 click（含鍵盤 Enter／空白）：同步開窗，回報結果供 105 顯示離線提示 */
  const onPress = useCallback(() => {
    const result = tracker.press();
    tracker.endPress();
    return result;
  }, [tracker]);

  /** 按鈕失焦（鍵盤 Tab 離開）：回到輸入框保留，移往其他地方就清掉 */
  const onButtonBlur = useCallback(
    (e: { relatedTarget?: unknown }) => {
      if (e.relatedTarget && e.relatedTarget === textareaRef.current) return;
      tracker.blur(source);
    },
    [tracker, source, textareaRef],
  );

  /** 只有目前暫存屬於這個來源才顯示 */
  const visible = state.canLookup && state.source === source;
  return { ...state, visible, onPointerDown, onPress, onButtonBlur };
}
