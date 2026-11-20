import type { SaveOutcome } from '../db/saveProject';
import type { AutoSaveStatus } from './autoSave';

/**
 * WO-130：溫和存檔提醒純函式狀態機。
 * - 未存過檔：累計變動 ≥ 500 字（或已有 ≥ 500 字且有編輯）或當次使用編輯起滿 30 分鐘。
 * - 存過檔後又改很多：累計修改量 ≥ 1,000 字，或自上次存檔後首次新編輯起滿 60 分鐘且顯著編輯。
 * - 同一份稿子同一次使用最多提醒 3 次；「晚點再說」後至少 30 分鐘內不再提醒，30 分鐘後還要有新編輯才再提醒。
 */

export const UNSAVED_REMINDER_WORDS = 500;
export const UNSAVED_REMINDER_MS = 30 * 60 * 1000;

export const CHANGED_REMINDER_WORDS = 1000;
export const CHANGED_REMINDER_MS = 60 * 60 * 1000;
export const CHANGED_REMINDER_MIN_CHURN_FOR_TIME = 100;

export const SNOOZE_REMINDER_MS = 30 * 60 * 1000;
export const MAX_SAVE_REMINDERS_PER_SESSION = 3;
export const TYPING_IDLE_FOR_REMINDER_MS = 3000;

export type SaveReminderReason = 'unsaved' | 'changed';

export interface ProjectReminderSession {
  firstEditAtMs: number | null;
  wordChurn: number;
  hasNonTextEdit: boolean;
  reminderCount: number;
  snoozedAtMs: number | null;
  editedSinceSnooze: boolean;
}

export function emptyReminderSession(): ProjectReminderSession {
  return {
    firstEditAtMs: null,
    wordChurn: 0,
    hasNonTextEdit: false,
    reminderCount: 0,
    snoozedAtMs: null,
    editedSinceSnooze: false,
  };
}

/** 記錄一次正文變動（累計絕對字數變化）。 */
export function recordReminderTextEdit(
  session: ProjectReminderSession,
  absWordDelta: number,
  nowMs: number,
): ProjectReminderSession {
  const delta = Number.isFinite(absWordDelta) && absWordDelta > 0 ? absWordDelta : 0;
  return {
    ...session,
    firstEditAtMs: session.firstEditAtMs ?? nowMs,
    wordChurn: session.wordChurn + delta,
    editedSinceSnooze: session.snoozedAtMs != null ? true : session.editedSinceSnooze,
  };
}

/** 記錄一次目錄、卡片或書名等結構異動。 */
export function recordReminderNonTextEdit(
  session: ProjectReminderSession,
  nowMs: number,
): ProjectReminderSession {
  return {
    ...session,
    firstEditAtMs: session.firstEditAtMs ?? nowMs,
    hasNonTextEdit: true,
    editedSinceSnooze: session.snoozedAtMs != null ? true : session.editedSinceSnooze,
  };
}

/** 按「晚點再說」或存檔對話框取消時進入冷卻，並計入本次使用已提醒次數。 */
export function snoozeReminderSession(
  session: ProjectReminderSession,
  nowMs: number,
): ProjectReminderSession {
  return {
    ...session,
    reminderCount: session.reminderCount + 1,
    snoozedAtMs: nowMs,
    editedSinceSnooze: false,
  };
}

/** 外部存檔成功後清零累計變動與冷卻記號；若由提醒視窗按「現在存」觸發則同步計入次數。 */
export function resetReminderAfterSave(
  session: ProjectReminderSession,
  countReminder = false,
): ProjectReminderSession {
  return {
    firstEditAtMs: null,
    wordChurn: 0,
    hasNonTextEdit: false,
    reminderCount: countReminder ? session.reminderCount + 1 : session.reminderCount,
    snoozedAtMs: null,
    editedSinceSnooze: false,
  };
}

export interface SaveReminderEvalInput {
  autoSaveStatus: AutoSaveStatus;
  isSample: boolean;
  hasExternalFileSaved: boolean;
  hasBody: boolean;
  bodyWords: number;
  session: ProjectReminderSession;
  nowMs: number;
}

/** 評估該稿目前是否應該跳出溫和存檔提醒；不跳時回傳 null。 */
export function evaluateSaveReminder(input: SaveReminderEvalInput): SaveReminderReason | null {
  if (input.isSample) return null;
  if (!input.hasBody) return null;
  if (input.autoSaveStatus === 'active') return null;

  const { session, nowMs } = input;
  if (session.reminderCount >= MAX_SAVE_REMINDERS_PER_SESSION) return null;

  if (session.snoozedAtMs != null) {
    const elapsedSinceSnooze = nowMs - session.snoozedAtMs;
    const timeReady = elapsedSinceSnooze >= SNOOZE_REMINDER_MS && session.editedSinceSnooze;
    if (!timeReady) return null;
  }

  if (!input.hasExternalFileSaved) {
    const wordsReached =
      session.wordChurn >= UNSAVED_REMINDER_WORDS ||
      (input.bodyWords >= UNSAVED_REMINDER_WORDS && session.firstEditAtMs != null);
    const timeReached =
      session.firstEditAtMs != null && nowMs - session.firstEditAtMs >= UNSAVED_REMINDER_MS;
    return wordsReached || timeReached ? 'unsaved' : null;
  }

  const changedWordsReached = session.wordChurn >= CHANGED_REMINDER_WORDS;
  const changedTimeReached =
    session.firstEditAtMs != null &&
    nowMs - session.firstEditAtMs >= CHANGED_REMINDER_MS &&
    (session.wordChurn >= CHANGED_REMINDER_MIN_CHURN_FOR_TIME || session.hasNonTextEdit);
  return changedWordsReached || changedTimeReached ? 'changed' : null;
}

export interface SaveReminderOverlayGateInput {
  deviceLoaded: boolean;
  pathname: string;
  focusMode: boolean;
  isComposing: boolean;
  keyboardOpen: boolean;
  lastInputAtMs: number | null;
  nowMs: number;
  dialogOpen: boolean;
  welcomeActive: boolean;
  whatsNewPending: boolean;
  idleDelayMs?: number;
}

/** 判斷目前場景是否適合浮出存檔提醒視窗（不打斷打字、專注模式與其他視窗）。 */
export function canShowSaveReminderOverlay(input: SaveReminderOverlayGateInput): boolean {
  if (!input.deviceLoaded) return false;
  if (!input.pathname.includes('/write')) return false;
  if (input.focusMode) return false;
  if (input.isComposing) return false;
  if (input.keyboardOpen) return false;
  if (input.dialogOpen) return false;
  if (input.welcomeActive) return false;
  if (input.whatsNewPending) return false;
  const idleDelay = input.idleDelayMs ?? TYPING_IDLE_FOR_REMINDER_MS;
  if (input.lastInputAtMs != null && input.nowMs - input.lastInputAtMs < idleDelay) return false;
  return true;
}

export interface SaveReminderSyncInput {
  hasProject: boolean;
  focusMode: boolean;
  savingFromReminder: boolean;
  currentOpenReason: SaveReminderReason | null;
  evalInput: SaveReminderEvalInput;
  overlayGate: SaveReminderOverlayGateInput;
}

/**
 * 計算寫作頁溫和存檔提醒對話框的下一個狀態：
 * - 正從「現在存」觸發非同步存檔（savingFromReminder）時，期間維持關閉、不重跳。
 * - 對話框開啟期間若條件不再成立（例如存檔成功、進入冷卻、切到專注模式或自動存檔恢復），立即回 null 關閉。
 */
export function nextSaveReminderOpenReason(input: SaveReminderSyncInput): SaveReminderReason | null {
  if (!input.hasProject || input.focusMode || input.savingFromReminder) {
    return null;
  }
  const reason = evaluateSaveReminder(input.evalInput);
  if (!reason) {
    return null;
  }
  if (input.currentOpenReason !== null) {
    return input.currentOpenReason;
  }
  return canShowSaveReminderOverlay(input.overlayGate) ? reason : null;
}

/** 判斷從存檔提醒按「現在存」後，回傳結果是否代表外部存檔／分享已完成。 */
export function isSaveOutcomeCompleted(
  outcome: SaveOutcome | null | undefined,
): boolean {
  return (
    outcome != null &&
    (outcome.kind === 'saved' ||
      outcome.kind === 'saved-under-new-title' ||
      outcome.kind === 'saved-as' ||
      outcome.kind === 'handed-off')
  );
}
