import { useEffect, useRef, type MutableRefObject } from 'react';
import type { LayoutMode } from '../layout';
import { hasEscapeTarget, shouldExitFocusOnEscape } from './focusEscape';

export type FocusEscapeOptions = {
  layoutMode: LayoutMode;
  pointer: string;
  focusMode: boolean;
  /** 既有的 exitFocusMode（與「離開專注模式」按鈕同一個）。 */
  exitFocusMode: () => void;
  isComposingRef: MutableRefObject<boolean>;
};

/**
 * WO-119：寫作頁掛上期間，window capture 監聽 Escape。
 * 在 capture 階段先記下「按下當下有沒有關閉對象」，不受其他處理器順序或關閉後 DOM 已空影響。
 * 只在判定成立時呼叫既有 exitFocusMode 並 preventDefault；不 stopPropagation、不碰正文焦點與選取。
 */
export function useFocusEscape(options: FocusEscapeOptions): void {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const o = latest.current;
      const pointerFine =
        typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
      const exit = shouldExitFocusOnEscape({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        repeat: event.repeat,
        isComposing: event.isComposing,
        keyCode: event.keyCode,
        bodyComposing: o.isComposingRef.current,
        focusMode: o.focusMode,
        layoutMode: o.layoutMode,
        pointerFine,
        pointer: o.pointer,
        escapeTargetOpen: hasEscapeTarget(document, event.target),
        handled: event.defaultPrevented,
      });
      if (!exit) return;
      event.preventDefault();
      o.exitFocusMode();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
}
