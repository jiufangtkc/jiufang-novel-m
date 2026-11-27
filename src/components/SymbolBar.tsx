import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { keepBodyFocusOnPointerDown } from '../editor/bodyFocusGuard';
import { WRITING_SYMBOLS, type WritingSymbol } from '../editor/writingSymbols';
import {
  SYMBOL_BAR_ARIA,
  SYMBOL_BAR_COLLAPSE_ARIA,
  SYMBOL_BAR_COLLAPSE_LABEL,
} from '../copy/symbolBarCopy';
import './symbolBar.css';

interface SymbolBarProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onInsert: (symbolId: string) => void;
  onCollapse: () => void;
  /** 電腦（滑鼠）才顯示全形空白鍵的 title 提示；手機不出現，避免長按跳說明。 */
  showTitles: boolean;
}

/**
 * WO-142：寫作頁全形標點列。按鈕一律不搶正文焦點（鍵盤不收、游標不掉）：
 * pointerdown／mousedown 都擋掉預設動作，點擊才用 onClick 處理。
 */
export function SymbolBar({ textareaRef, onInsert, onCollapse, showTitles }: SymbolBarProps) {
  const guard = (event: ReactPointerEvent<HTMLButtonElement>) => {
    keepBodyFocusOnPointerDown(textareaRef.current, event);
    event.preventDefault();
  };
  const noSteal = {
    onPointerDown: guard,
    onMouseDown: (event: { preventDefault: () => void }) => event.preventDefault(),
  };

  return (
    <div className="symbol-bar" role="toolbar" aria-label={SYMBOL_BAR_ARIA} data-testid="symbol-bar">
      <button
        type="button"
        className="symbol-bar-collapse"
        aria-label={SYMBOL_BAR_COLLAPSE_ARIA}
        data-testid="symbol-bar-collapse"
        {...noSteal}
        onClick={onCollapse}
      >
        {SYMBOL_BAR_COLLAPSE_LABEL}
      </button>
      <div className="symbol-bar-scroll">
        <div className="symbol-bar-track">
          {WRITING_SYMBOLS.map((symbol: WritingSymbol, index) => (
            <span key={symbol.id} className="symbol-bar-slot">
              {index > 0 && WRITING_SYMBOLS[index - 1].group !== symbol.group ? (
                <span className="symbol-bar-sep" role="separator" aria-orientation="vertical" />
              ) : null}
              <button
                type="button"
                className={symbol.long ? 'symbol-key is-long' : 'symbol-key'}
                aria-label={symbol.ariaLabel}
                title={showTitles ? symbol.title : undefined}
                data-symbol-id={symbol.id}
                data-testid={`symbol-key-${symbol.id}`}
                {...noSteal}
                onClick={() => onInsert(symbol.id)}
              >
                {symbol.face}
              </button>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
