import {
  AUTOSAVE_FAILED_ARIA,
  AUTOSAVE_FAILED_BADGE,
  AUTOSAVE_RESUME_ARIA,
  AUTOSAVE_RESUME_BADGE,
  AUTOSAVE_UNSAVED_BADGE,
  autosaveUnsavedAria,
  autosavedAtLabel,
  lastFileSavedLabel,
} from '../copy/userFacing';
import type { HeaderSaveDisplayKind } from '../domain/autoSave';
import { formatLastProjectSave } from '../domain/saveClock';
import './saveReminder.css';

export interface SaveHeaderStatusProps {
  kind: HeaderSaveDisplayKind;
  canPickFiles: boolean;
  lastFileSaveMs: number | null;
  autoSaveActive: boolean;
  lastSaveWasAuto: boolean;
  onResumeAutoSave: () => void;
  onSave: () => void;
  now?: Date;
}

/**
 * WO-130：寫作頁頁首外部存檔狀態標示（獨立次列，與 StaleSaveReminder 互斥顯示）。
 * 四種版面輸出同一份 DOM 結構，不隨 layoutMode 切換元素。
 */
export function SaveHeaderStatus({
  kind,
  canPickFiles,
  lastFileSaveMs,
  autoSaveActive,
  lastSaveWasAuto,
  onResumeAutoSave,
  onSave,
  now,
}: SaveHeaderStatusProps) {
  if (kind === 'none' || kind === 'stale') return null;

  if (kind === 'needs-permission') {
    return (
      <button
        type="button"
        className="save-header-action is-permission"
        aria-label={AUTOSAVE_RESUME_ARIA}
        onClick={onResumeAutoSave}
        data-testid="save-header-status"
        data-save-header-kind="needs-permission"
      >
        {AUTOSAVE_RESUME_BADGE}
      </button>
    );
  }

  if (kind === 'failed') {
    return (
      <button
        type="button"
        className="save-header-action is-failed"
        aria-label={AUTOSAVE_FAILED_ARIA}
        onClick={onSave}
        data-testid="save-header-status"
        data-save-header-kind="failed"
      >
        {AUTOSAVE_FAILED_BADGE}
      </button>
    );
  }

  if (kind === 'unsaved') {
    return (
      <button
        type="button"
        className="save-header-action is-unsaved"
        aria-label={autosaveUnsavedAria(canPickFiles)}
        onClick={onSave}
        data-testid="save-header-status"
        data-save-header-kind="unsaved"
      >
        {AUTOSAVE_UNSAVED_BADGE}
      </button>
    );
  }

  if (lastFileSaveMs == null) return null;
  const timeText = formatLastProjectSave(lastFileSaveMs, now ?? new Date());
  const text = autoSaveActive && lastSaveWasAuto ? autosavedAtLabel(timeText) : lastFileSavedLabel(timeText);
  return (
    <span
      className="save-header-time"
      data-testid="save-header-status"
      data-save-header-kind="time"
    >
      {text}
    </span>
  );
}
