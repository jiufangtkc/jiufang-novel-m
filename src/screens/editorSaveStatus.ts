import {
  AUTOSAVE_FAILED_BADGE,
  AUTOSAVE_RESUME_BADGE,
  AUTOSAVE_UNSAVED_BADGE,
  SAVE_CONFLICT_BADGE,
  STASH_FAILED_BADGE,
  autosavedAtLabel,
  lastFileSavedLabel,
  staleSaveReminder,
} from '../copy/userFacing';
import type { HeaderSaveDisplayKind } from '../domain/autoSave';
import { formatClockTime, formatLastProjectSave } from '../domain/saveClock';

function sameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/** 頁首無外部存檔標示時（範例書／管理頁等），底下或管理區塊使用的本機暫存狀態。 */
export function editorSaveStatus(options: {
  directWriteback: boolean;
  lastSaveMs: number | null;
  lastExportMs: number | null;
  now: Date;
}): { label: string; openFiles: boolean } {
  const exportedToday =
    options.lastExportMs != null && sameDay(new Date(options.lastExportMs), options.now);
  if (!options.directWriteback && !exportedToday) {
    return { label: '今天還沒另存', openFiles: true };
  }
  if (options.lastSaveMs != null) {
    return { label: `已暫存 ${formatClockTime(new Date(options.lastSaveMs))}`, openFiles: false };
  }
  return { label: '尚未暫存', openFiles: false };
}

/**
 * WO-132 嚴-7：專注模式與手機橫拿打字時（頁首隱藏），.focus-bottom-status 是唯一狀態列，
 * 非範例書統一使用與頁首相同的單一存檔狀態說法；範例書顯示本機暫存狀態。
 */
export function unifiedFocusSaveLabel(options: {
  headerKind: HeaderSaveDisplayKind;
  isSample: boolean;
  staleDays: number | null;
  lastFileSaveMs: number | null;
  autoSaveActive: boolean;
  lastSaveWasAuto: boolean;
  lastLocalSaveMs: number | null;
  now?: Date;
}): string {
  const now = options.now ?? new Date();
  if (options.isSample || options.headerKind === 'none') {
    return options.lastLocalSaveMs != null
      ? `已暫存 ${formatClockTime(new Date(options.lastLocalSaveMs))}`
      : '尚未暫存';
  }
  switch (options.headerKind) {
    case 'conflict':
      return SAVE_CONFLICT_BADGE;
    case 'stash-failed':
      return STASH_FAILED_BADGE;
    case 'needs-permission':
      return AUTOSAVE_RESUME_BADGE;
    case 'failed':
      return AUTOSAVE_FAILED_BADGE;
    case 'stale':
      return staleSaveReminder(options.staleDays ?? 3);
    case 'unsaved':
      return AUTOSAVE_UNSAVED_BADGE;
    case 'time': {
      if (options.lastFileSaveMs == null) return AUTOSAVE_UNSAVED_BADGE;
      const timeText = formatLastProjectSave(options.lastFileSaveMs, now);
      return options.autoSaveActive && options.lastSaveWasAuto
        ? autosavedAtLabel(timeText)
        : lastFileSavedLabel(timeText);
    }
  }
}
