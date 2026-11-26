import { trashSelectionCountLabel } from '../copy/trashCopy';
import { shouldAutoCaptureDeletion } from '../domain/trash';

export interface TrashSelectionNoticeProps {
  wordCount: number;
}

/**
 * WO-138：正文選取字數即時角落提示（純資訊，不可點，達 100 字門檻時附帶提醒）。
 */
export function TrashSelectionNotice({ wordCount }: TrashSelectionNoticeProps) {
  const reachedThreshold = shouldAutoCaptureDeletion(wordCount);
  return (
    <div
      className={reachedThreshold ? 'trash-selection-notice is-threshold' : 'trash-selection-notice'}
      role="status"
      aria-live="polite"
      data-testid="trash-selection-notice"
      data-threshold={reachedThreshold ? 'true' : 'false'}
    >
      {trashSelectionCountLabel(wordCount)}
    </div>
  );
}
