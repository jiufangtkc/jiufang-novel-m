import {
  VERSION_CLOSE_LABEL,
  VERSION_NOTICE_CLOSE_ARIA,
  VERSION_RESTORED_NOTICE_TITLE,
  VERSION_UNDO_BUTTON,
  VERSION_UNDO_WARNING,
} from '../copy/manuscriptVersionCopy';
import type { VersionRestoreUndoSnapshot } from '../editor/versionRestoreFlow';

export interface VersionRestoreNoticeProps {
  snapshot: VersionRestoreUndoSnapshot | null | undefined;
  projectId: string;
  chapterId: string;
  onUndo: () => void;
  onDismiss: () => void;
}

/**
 * WO-140 第 5 段：換成舊版後的持續性復原提示條（對齊 FormatNotice 風格）。
 * 僅在目前開啟的稿子與章節符合快照時顯示；在該章新打字不自動隱藏，專注模式隱藏。
 */
export function VersionRestoreNotice({
  snapshot,
  projectId,
  chapterId,
  onUndo,
  onDismiss,
}: VersionRestoreNoticeProps) {
  if (!snapshot || snapshot.projectId !== projectId || snapshot.chapterId !== chapterId) {
    return null;
  }

  return (
    <div
      className="version-restore-notice"
      role="status"
      aria-live="polite"
      data-testid="version-restore-notice"
    >
      <div className="version-restore-notice-row">
        <strong>{VERSION_RESTORED_NOTICE_TITLE}</strong>
        <button
          type="button"
          className="version-restore-notice-undo"
          data-testid="version-restore-undo"
          onClick={onUndo}
        >
          {VERSION_UNDO_BUTTON}
        </button>
        <button
          type="button"
          className="version-restore-notice-close"
          aria-label={VERSION_NOTICE_CLOSE_ARIA}
          data-testid="version-restore-notice-close"
          onClick={onDismiss}
        >
          {VERSION_CLOSE_LABEL}
        </button>
      </div>
      <p>{VERSION_UNDO_WARNING}</p>
    </div>
  );
}
