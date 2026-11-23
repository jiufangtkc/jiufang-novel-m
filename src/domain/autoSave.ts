import { findNode, updateNode, type DemoProject } from '../data/demo';
import type { SaveMetaEntry } from '../state/deviceSaveRecord';

/**
 * WO-130：支援 File System Access 的桌面瀏覽器自動存檔純邏輯。
 * 不直接觸碰瀏覽器 DOM 或磁碟，只做資格判斷、狀態解析、變更檢查與寫前快照合併。
 */

/** 每 5 分鐘檢查並自動寫回一次（有變更才寫）。 */
export const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 自動存檔心跳間隔（3 秒，可整除 5 分鐘）。
 * 只做純記憶體時間比對，不觸發元件重繪，可在假時鐘與休眠喚醒後快速補齊寫回。
 */
export const AUTOSAVE_HEARTBEAT_MS = 3 * 1000;

/** 依目前時間與下次到期時間推進自動存檔週期；跨越休眠或節流僅觸發一次並對齊週期。 */
export function advanceAutoSaveDue(
  nowMs: number,
  nextDueAtMs: number,
  intervalMs: number = AUTOSAVE_INTERVAL_MS,
): { due: boolean; nextDueAtMs: number } {
  if (nowMs < nextDueAtMs) {
    return { due: false, nextDueAtMs };
  }
  const step = Math.max(1, intervalMs);
  const missedSteps = Math.floor((nowMs - nextDueAtMs) / step) + 1;
  return {
    due: true,
    nextDueAtMs: nextDueAtMs + missedSteps * step,
  };
}

export interface AutoSaveTimerHost<THandle = ReturnType<typeof setInterval>> {
  setInterval(handler: () => void, ms: number): THandle;
  clearInterval(handle: THandle): void;
  now(): number;
}

const DEFAULT_TIMER_HOST: AutoSaveTimerHost<ReturnType<typeof setInterval>> = {
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: (handle) => clearInterval(handle),
  now: () => Date.now(),
};

/** 啟動短心跳自動存檔排程器，回傳停止函式。 */
export function startAutoSaveScheduler<THandle = ReturnType<typeof setInterval>>(input: {
  intervalMs: number;
  heartbeatMs?: number;
  onDue: () => void;
  host?: AutoSaveTimerHost<THandle>;
}): () => void {
  const host = (input.host ?? DEFAULT_TIMER_HOST) as AutoSaveTimerHost<THandle>;
  const intervalMs = Math.max(1, input.intervalMs);
  const heartbeatMs = Math.max(1, Math.min(intervalMs, input.heartbeatMs ?? AUTOSAVE_HEARTBEAT_MS));
  let nextDueAtMs = host.now() + intervalMs;
  const timer = host.setInterval(() => {
    const stepped = advanceAutoSaveDue(host.now(), nextDueAtMs, intervalMs);
    if (!stepped.due) return;
    nextDueAtMs = stepped.nextDueAtMs;
    input.onDue();
  }, heartbeatMs);
  return () => host.clearInterval(timer);
}

export type AutoSaveStatus =
  | 'unsupported'
  | 'unsaved'
  | 'active'
  | 'paused-rename'
  | 'conflict'
  | 'needs-permission'
  | 'failed';

export type HandlePermissionState = 'none' | 'granted' | 'prompt' | 'denied';

export interface LiveDraftSnapshot {
  projectId: string;
  chapterId: string;
  text: string;
}

/** 是否已手動存過至少一次外部 .db 檔（App 空間暫存不算）。 */
export function hasSavedExternalFile(
  meta: Pick<SaveMetaEntry, 'lastProjectSaveMs' | 'lastExportMs'> | null | undefined,
): boolean {
  return meta?.lastProjectSaveMs != null || meta?.lastExportMs != null;
}

/** 最近一次外部 .db 存檔或另存的時間戳（沒有時回傳 null）。 */
export function lastExternalFileSaveMs(
  meta: Pick<SaveMetaEntry, 'lastProjectSaveMs' | 'lastExportMs'> | null | undefined,
): number | null {
  if (!meta) return null;
  const times = [meta.lastProjectSaveMs, meta.lastExportMs].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0,
  );
  if (times.length === 0) return null;
  return Math.max(...times);
}

/** 解析某份稿子目前的自動存檔狀態。 */
export function resolveAutoSaveStatus(input: {
  canPickFiles: boolean;
  isSample: boolean;
  removed: boolean;
  hasSavedFile: boolean;
  needsNewName: boolean;
  permission: HandlePermissionState;
  lastAutoSaveFailed: boolean;
  hasExternalConflict?: boolean;
}): AutoSaveStatus {
  if (!input.canPickFiles) return 'unsupported';
  if (input.isSample || input.removed || !input.hasSavedFile) return 'unsaved';
  if (input.needsNewName) return 'paused-rename';
  if (input.hasExternalConflict) return 'conflict';
  if (input.permission === 'prompt' || input.permission === 'denied') return 'needs-permission';
  if (input.permission === 'none') return 'unsaved';
  if (input.lastAutoSaveFailed) return 'failed';
  return 'active';
}

/** 5 分鐘週期到點或剛恢復權限時，判斷是否需要執行背景寫回。 */
export function shouldRunAutoSaveTick(input: {
  status: AutoSaveStatus;
  dirtySinceFileSave: boolean;
  currentRev: number;
  lastSavedRev: number;
  hasUncommittedDiff: boolean;
  isInflight: boolean;
}): boolean {
  if ((input.status !== 'active' && input.status !== 'failed') || input.isInflight) return false;
  return input.dirtySinceFileSave || input.currentRev !== input.lastSavedRev || input.hasUncommittedDiff;
}

/** 寫入期間若沒有新的實質編輯，才可清除 dirty 標記。 */
export function shouldClearDirtyAfterSave(revAtStart: number, currentRev: number): boolean {
  return revAtStart === currentRev;
}

/**
 * 檢查編輯框是否仍有尚未送進 state 的正文，若非組字中則併入本次快照用 project（不碰游標與焦點）。
 */
export function applyUncommittedDraftToProject(
  project: DemoProject,
  liveDraft: LiveDraftSnapshot | null,
  isComposing: boolean,
): { project: DemoProject; hasDiff: boolean } {
  if (isComposing || !liveDraft || liveDraft.projectId !== project.id) {
    return { project, hasDiff: false };
  }
  const node = findNode(project.nodes, liveDraft.chapterId);
  if (!node || (node.content ?? '') === liveDraft.text) {
    return { project, hasDiff: false };
  }
  return {
    project: {
      ...project,
      nodes: updateNode(project.nodes, liveDraft.chapterId, (current) => ({
        ...current,
        content: liveDraft.text,
      })),
    },
    hasDiff: true,
  };
}

export type HeaderSaveDisplayKind =
  | 'conflict'
  | 'stash-failed'
  | 'needs-permission'
  | 'failed'
  | 'stale'
  | 'unsaved'
  | 'time'
  | 'none';

/**
 * 寫作頁頁首次列單一互斥狀態解析：
 * 1. conflict → 檔案已被外部更新
 * 2. stashFailed → 暫存沒成功
 * 3. needs-permission → 恢復自動存檔
 * 4. failed → 自動存檔沒成功
 * 5. staleDays != null → 沿用 WO-98「已經 N 天沒存檔了」
 * 6. 未存成外部檔（非範例書） → 還沒存成檔案
 * 7. 已存過外部檔（非範例書） → 最後存檔時間（已自動存檔／上次存檔）
 */
export function resolveHeaderSaveDisplay(input: {
  isSample: boolean;
  autoSaveStatus: AutoSaveStatus;
  staleDays: number | null;
  lastFileSaveMs: number | null;
  stashFailed?: boolean;
}): HeaderSaveDisplayKind {
  if (input.autoSaveStatus === 'conflict') return 'conflict';
  if (input.stashFailed) return 'stash-failed';
  if (input.autoSaveStatus === 'needs-permission') return 'needs-permission';
  if (input.autoSaveStatus === 'failed') return 'failed';
  if (input.staleDays != null) return 'stale';
  if (input.isSample) return 'none';
  if (input.lastFileSaveMs == null) return 'unsaved';
  return 'time';
}
