/**
 * 查字典按鈕與沒網路提示（WO-105，規格 B-2、B-3、D2）
 * 純畫面元件：狀態由 useDictSelection／useDictNotice 提供，寫作頁與（106）卡片共用。
 * 視覺暫定，交視覺設計。
 */

import type { FocusEvent as ReactFocusEvent, PointerEvent as ReactPointerEvent } from 'react';
import { DICT_BUTTON_GAP, DICT_OFFLINE_NOTICE } from '../copy/dictionaryCopy';
import '../screens/focusMode.css';
import { dictButtonView } from '../dictionary/selectionRules';
import type { DictPressResult } from '../dictionary/dictLookup';

export function DictIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z" />
      <path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3" />
      <path d="M9 8h6" />
    </svg>
  );
}

export function NoNetworkIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0" />
      <path d="M12 19.5h.01M3 3l18 18" />
    </svg>
  );
}

export interface DictButtonProps {
  word: string;
  onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onPress: () => DictPressResult;
  /** 鍵盤移開按鈕時呼叫（回輸入框保留、去別處清除） */
  onBlur?: (e: ReactFocusEvent<HTMLButtonElement>) => void;
  /** 按下回報沒網路時呼叫（顯示提示） */
  onOffline: () => void;
  /** topbar：在頁首；floating：浮在左上角；card：卡片編輯標題列右端（WO-106） */
  placement: 'topbar' | 'floating' | 'card';
  testId?: string;
}

export function DictButton({ word, onPointerDown, onPress, onBlur, onOffline, placement, testId }: DictButtonProps) {
  const view = dictButtonView(word);
  return (
    <button
      type="button"
      className={
        placement === 'floating' ? 'dict-button is-floating' : placement === 'card' ? 'dict-button is-card' : 'dict-button'
      }
      aria-label={view.ariaLabel}
      onPointerDown={onPointerDown}
      onBlur={onBlur}
      data-dict-button={placement === 'card' ? 'card' : 'body'}
      onClick={() => {
        if (onPress() === 'offline') onOffline();
      }}
      data-testid={testId ?? 'dict-button'}
      data-placement={placement}
    >
      <DictIcon />
      <span className="dict-button-label" aria-hidden="true">{view.label}</span>
      <span className="dict-button-hint" aria-hidden="true">
        {DICT_BUTTON_GAP}
        {view.hint}
      </span>
    </button>
  );
}

/**
 * 沒網路提示：role="status"、polite，念同一句；不使用 .toast。
 * 容器一直在畫面上（空的時候不顯示），內容出現時朗讀才可靠。
 */
export function DictOfflineNotice({
  visible,
  placement,
  testId,
}: {
  visible: boolean;
  placement: 'topbar' | 'floating' | 'card';
  testId?: string;
}) {
  return (
    <div
      className="dict-offline-notice"
      role="status"
      aria-live="polite"
      data-placement={placement}
      data-visible={visible ? 'true' : 'false'}
      data-testid={testId ?? 'dict-offline-notice'}
    >
      {visible ? (
        <>
          <NoNetworkIcon />
          <span>{DICT_OFFLINE_NOTICE}</span>
        </>
      ) : null}
    </div>
  );
}
