import {
  TRASH_CLOSE_LABEL,
  TRASH_CORNER_CLOSE_ARIA,
  TRASH_CORNER_VIEW,
} from '../copy/trashCopy';

export interface TrashCornerNoticeProps {
  message: string;
  onOpen: () => void;
  onDismiss: () => void;
}

/**
 * WO-138：刪稿自動收進／手動送入後的非打斷角落提示（約 5 秒自動收起）。
 * 不影響既有 <Toast />；點擊提示內容或「查看」直接開啟刪稿暫存區。
 */
export function TrashCornerNotice({ message, onOpen, onDismiss }: TrashCornerNoticeProps) {
  return (
    <div
      className="trash-corner-notice"
      role="status"
      aria-live="polite"
      data-testid="trash-corner-notice"
    >
      <button
        type="button"
        className="trash-corner-main"
        data-testid="trash-corner-open"
        onClick={onOpen}
      >
        <span className="trash-corner-text">{message}</span>
        <span className="trash-corner-view">{TRASH_CORNER_VIEW}</span>
      </button>
      <button
        type="button"
        className="trash-corner-close"
        aria-label={TRASH_CORNER_CLOSE_ARIA}
        data-testid="trash-corner-close"
        onClick={onDismiss}
      >
        {TRASH_CLOSE_LABEL}
      </button>
    </div>
  );
}
