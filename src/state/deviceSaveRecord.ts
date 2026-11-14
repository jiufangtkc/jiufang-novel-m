import { withClock, type GoalSchedule } from '../domain/dailyGoal';
import type { WritingLogRow } from '../domain/writingLog';
import type { KeyValueStore } from '../domain/outline';

/**
 * WO-77：只存在這台裝置（瀏覽器本機儲存）的存檔紀錄。
 *
 * - 每份稿子（以稿子代號對應）的暫存、另存、儲存時間。
 * - 還沒升格成檔案的新稿子，自己的寫作紀錄與每日目標結算狀態。
 * - 這台裝置另存出去的檔案指紋與另存時間，開回同一份檔時用來對上「上次另存」。
 *
 * 這些都不寫進 .db，不會跟著檔案傳到電腦版。
 */
export const DEVICE_SAVE_RECORD_KEY = 'jiufang-novel-m.save-record.v1';

/** 另存檔案指紋最多記幾筆；超過就丟掉最舊的。 */
const MAX_EXPORTED_FILES = 30;

export interface SaveMetaEntry {
  lastAutoSaveMs: number | null;
  lastManualSaveMs: number | null;
  lastExportMs: number | null;
  lastProjectSaveMs: number | null;
}

export interface DeviceSaveRecord {
  saveMeta: Record<string, SaveMetaEntry>;
  logsById: Record<string, WritingLogRow[]>;
  goalById: Record<string, GoalSchedule>;
  exportedFiles: Record<string, number>;
}

function emptyRecord(): DeviceSaveRecord {
  return { saveMeta: {}, logsById: {}, goalById: {}, exportedFiles: {} };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRaw(store: KeyValueStore): DeviceSaveRecord {
  try {
    const raw = store.getItem(DEVICE_SAVE_RECORD_KEY);
    if (!raw) return emptyRecord();
    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed)) return emptyRecord();
    return {
      saveMeta: isObject(parsed.saveMeta) ? (parsed.saveMeta as DeviceSaveRecord['saveMeta']) : {},
      logsById: isObject(parsed.logsById) ? (parsed.logsById as DeviceSaveRecord['logsById']) : {},
      goalById: isObject(parsed.goalById) ? (parsed.goalById as DeviceSaveRecord['goalById']) : {},
      exportedFiles: isObject(parsed.exportedFiles)
        ? (parsed.exportedFiles as DeviceSaveRecord['exportedFiles'])
        : {},
    };
  } catch {
    return emptyRecord();
  }
}

/** 重新載入時讀回紀錄。結算狀態依現在時間補結算，跨日後今天從 0 開始、昨天照常結算。 */
export function loadDeviceSaveRecord(store: KeyValueStore | null, now: Date): DeviceSaveRecord {
  if (!store) return emptyRecord();
  const record = readRaw(store);
  const goalById: Record<string, GoalSchedule> = {};
  for (const [id, schedule] of Object.entries(record.goalById)) {
    try {
      goalById[id] = withClock(schedule, now);
    } catch {
      // 壞掉的結算狀態就不還原，該稿子改從 0 開始，不影響其他稿子。
    }
  }
  const logsById: Record<string, WritingLogRow[]> = {};
  for (const [id, logs] of Object.entries(record.logsById)) {
    if (Array.isArray(logs) && goalById[id]) logsById[id] = logs;
  }
  return { ...record, goalById, logsById };
}

/**
 * 寫入這台裝置的紀錄。寫作紀錄只留「還沒升格成檔案的新稿子」的（傳進來的 draftIds）；
 * 範例書照舊用範例紀錄，從檔案開的稿子照舊讀檔案裡的紀錄。
 */
export function saveDeviceSaveRecord(
  store: KeyValueStore,
  input: {
    saveMeta: Record<string, SaveMetaEntry>;
    logsById: Record<string, WritingLogRow[]>;
    goalById: Record<string, GoalSchedule>;
    draftIds: readonly string[];
  },
): void {
  const previous = readRaw(store);
  const logsById: DeviceSaveRecord['logsById'] = {};
  const goalById: DeviceSaveRecord['goalById'] = {};
  for (const id of input.draftIds) {
    const schedule = input.goalById[id];
    if (!schedule) continue;
    goalById[id] = schedule;
    logsById[id] = input.logsById[id] ?? [];
  }
  const record: DeviceSaveRecord = {
    saveMeta: input.saveMeta,
    logsById,
    goalById,
    exportedFiles: previous.exportedFiles,
  };
  store.setItem(DEVICE_SAVE_RECORD_KEY, JSON.stringify(record));
}

/** 記下這台裝置另存出去的那份檔案（以內容指紋對應）與另存時間。 */
export function rememberExportedFile(store: KeyValueStore, fingerprint: string, atMs: number): void {
  const record = readRaw(store);
  const entries = Object.entries({ ...record.exportedFiles, [fingerprint]: atMs })
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_EXPORTED_FILES);
  store.setItem(
    DEVICE_SAVE_RECORD_KEY,
    JSON.stringify({ ...record, exportedFiles: Object.fromEntries(entries) }),
  );
}

/** 開回檔案時查：這份檔是不是這台裝置另存出去的，另存時間是幾點。內容不同就查不到。 */
export function recallExportedFile(store: KeyValueStore, fingerprint: string): number | null {
  const atMs = readRaw(store).exportedFiles[fingerprint];
  return typeof atMs === 'number' ? atMs : null;
}

/** 檔案內容指紋（SHA-256）。瀏覽器不提供時回傳 null，只是開回時對不上另存時間。 */
export async function fingerprintBytes(bytes: Uint8Array): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const digest = await subtle.digest('SHA-256', copy);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}
