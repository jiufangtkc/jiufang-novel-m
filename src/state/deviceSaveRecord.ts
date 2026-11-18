import { MIN_DAILY_GOAL, withClock, type GoalSchedule } from '../domain/dailyGoal';
import type { WritingLogRow } from '../domain/writingLog';
import type { KeyValueStore } from '../domain/outline';

/**
 * WO-77：只存在這台裝置（瀏覽器本機儲存）的存檔紀錄。
 *
 * - 每份稿子（以稿子代號對應）的暫存、另存、儲存時間。
 * - 還沒升格成檔案的新稿子，自己的寫作紀錄與每日目標結算狀態。
 * - 這台裝置另存出去的檔案指紋與另存時間，開回同一份檔時用來對上「上次另存」。
 * - WO-111：還沒開任何稿子時（例如第一次用、在歡迎導覽第 1 關選的）的每日目標 homeGoal。
 *   和設定頁是同一個每日目標的規則（最少 300 的整數、當天以最後一次為準），只是補上「沒有稿子時」
 *   重開後還記得；放在這把既有的鍵裡，不另開每日目標的鍵。
 * - WO-111 返工1：開著 .db 檔案稿時在歡迎導覽第 1 關選的每日目標 tourGoalById（以稿子代號對應）。
 *   導覽不寫 .db，所以按「下一關」當下先記在這裡；重新載入時這份稿子從手機暫存回復，就用它蓋過檔案裡的舊值。
 *   之後這份稿子的每日目標又被改成別的值（例如設定頁），下一次寫這把鍵時就把這一格拿掉，以後照稿子自己的值。
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
  /** WO-98：每份稿子（以代號對應）在這台裝置的建立或第一次遇到的時間，用來算「沒存檔幾天」。 */
  startedById: Record<string, number>;
  /** WO-111：沒有開著的稿子時的每日目標；沒設過或不合法時不帶這一格。 */
  homeGoal?: number;
  /** WO-111 返工1：檔案稿在歡迎導覽選的每日目標（稿子代號 → 目標）；沒有時不帶這一格。 */
  tourGoalById?: Record<string, number>;
}

/** WO-111：合法的每日目標（和 dailyGoal.assertDailyGoal 同規則：300 以上的整數）。 */
function isDailyGoal(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= MIN_DAILY_GOAL;
}

function emptyRecord(): DeviceSaveRecord {
  return { saveMeta: {}, logsById: {}, goalById: {}, exportedFiles: {}, startedById: {} };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanStarted(value: unknown): Record<string, number> {
  if (!isObject(value)) return {};
  const out: Record<string, number> = {};
  for (const [id, ms] of Object.entries(value)) {
    if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) out[id] = ms;
  }
  return out;
}

function cleanTourGoals(value: unknown): Record<string, number> {
  if (!isObject(value)) return {};
  const out: Record<string, number> = {};
  for (const [id, goal] of Object.entries(value)) {
    if (isDailyGoal(goal)) out[id] = goal;
  }
  return out;
}

/** 沒有內容就不帶這一格，舊紀錄的樣子不變。 */
function tourGoalField(tourGoalById: Record<string, number>): Pick<DeviceSaveRecord, 'tourGoalById'> {
  return Object.keys(tourGoalById).length > 0 ? { tourGoalById } : {};
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
      startedById: cleanStarted(parsed.startedById),
      ...(isDailyGoal(parsed.homeGoal) ? { homeGoal: parsed.homeGoal } : {}),
      ...tourGoalField(cleanTourGoals(parsed.tourGoalById)),
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
    /** WO-98：沒帶就沿用先前記的。 */
    startedById?: Record<string, number>;
    /** WO-116：已從這個裝置刪掉的稿子代號；它們的稿別資料（含 tourGoalById 與沿用的 startedById）一律不留。 */
    excludeIds?: readonly string[];
  },
): void {
  const previous = readRaw(store);
  const excluded = new Set(input.excludeIds ?? []);
  const logsById: DeviceSaveRecord['logsById'] = {};
  const goalById: DeviceSaveRecord['goalById'] = {};
  for (const id of input.draftIds) {
    if (excluded.has(id)) continue;
    const schedule = input.goalById[id];
    if (!schedule) continue;
    goalById[id] = schedule;
    logsById[id] = input.logsById[id] ?? [];
  }
  const record: DeviceSaveRecord = {
    saveMeta: withoutIds(input.saveMeta, excluded),
    logsById,
    goalById,
    exportedFiles: previous.exportedFiles,
    startedById: withoutIds(input.startedById ?? previous.startedById, excluded),
    // WO-111：沒有稿子時的每日目標由 saveHomeDailyGoal 寫，這裡照舊留著。
    ...(previous.homeGoal !== undefined ? { homeGoal: previous.homeGoal } : {}),
    ...tourGoalField(withoutIds(keptTourGoals(previous.tourGoalById ?? {}, input.goalById), excluded)),
  };
  store.setItem(DEVICE_SAVE_RECORD_KEY, JSON.stringify(record));
}

function withoutIds<T>(source: Record<string, T>, excluded: ReadonlySet<string>): Record<string, T> {
  if (excluded.size === 0) return source;
  return Object.fromEntries(Object.entries(source).filter(([id]) => !excluded.has(id)));
}

/**
 * WO-116：從這個裝置刪掉稿子時，把裝置紀錄裡這些稿子的稿別資料（saveMeta、logsById、goalById、
 * startedById、tourGoalById）清掉；其他稿、另存檔案指紋與共用的 homeGoal 照舊。
 * 不能只靠 draftIds：tourGoalById 在找不到該稿目標時會被保留。寫不進去會丟錯。
 */
export function forgetProjectsInDeviceRecord(store: KeyValueStore, ids: readonly string[]): void {
  const raw = store.getItem(DEVICE_SAVE_RECORD_KEY);
  if (!raw) return;
  const excluded = new Set(ids);
  const record = readRaw(store);
  const next: DeviceSaveRecord = {
    saveMeta: withoutIds(record.saveMeta, excluded),
    logsById: withoutIds(record.logsById, excluded),
    goalById: withoutIds(record.goalById, excluded),
    exportedFiles: record.exportedFiles,
    startedById: withoutIds(record.startedById, excluded),
    ...(record.homeGoal !== undefined ? { homeGoal: record.homeGoal } : {}),
    ...tourGoalField(withoutIds(record.tourGoalById ?? {}, excluded)),
  };
  store.setItem(DEVICE_SAVE_RECORD_KEY, JSON.stringify(next));
}

/** 某份稿子目前（最後一次）的每日目標。 */
function currentGoalOf(schedule: GoalSchedule): number {
  return schedule.open?.goals.at(-1)?.goal ?? schedule.defaultGoal;
}

/**
 * WO-111 返工1：導覽記下的檔案稿每日目標，只留還跟畫面上那份稿子一致的。
 * 那份稿子還沒載入（goalById 裡沒有）就照舊留著；已經改成別的值就拿掉，之後照稿子自己的值。
 */
function keptTourGoals(
  tourGoalById: Record<string, number>,
  goalById: Record<string, GoalSchedule>,
): Record<string, number> {
  const kept: Record<string, number> = {};
  for (const [id, goal] of Object.entries(tourGoalById)) {
    const schedule = goalById[id];
    if (!schedule || currentGoalOf(schedule) === goal) kept[id] = goal;
  }
  return kept;
}

/**
 * WO-111 返工1：開著 .db 檔案稿時，歡迎導覽第 1 關按「下一關」當下記下這份稿子的每日目標。
 * 只改這把既有鍵裡 tourGoalById 的一格，其他內容照舊；不寫 .db。不合法不寫、回 false；寫不進去會丟錯，由呼叫端接住。
 */
export function saveTourFileGoal(store: KeyValueStore, projectId: string, goal: number): boolean {
  if (!projectId || !isDailyGoal(goal)) return false;
  const record = readRaw(store);
  store.setItem(
    DEVICE_SAVE_RECORD_KEY,
    JSON.stringify({ ...record, tourGoalById: { ...(record.tourGoalById ?? {}), [projectId]: goal } }),
  );
  return true;
}

/** WO-111 返工1：讀這份檔案稿在導覽記下的每日目標；沒有、讀不到或不合法回 null。 */
export function recallTourFileGoal(store: KeyValueStore | null, projectId: string): number | null {
  if (!store) return null;
  return readRaw(store).tourGoalById?.[projectId] ?? null;
}

/**
 * WO-111：記下沒有開著的稿子時的每日目標（歡迎導覽第 1 關在首頁按「下一關」時用）。
 * 只改這把既有鍵裡的 homeGoal 一格，其他內容照舊。不合法不寫、回 false；寫不進去會丟錯，由呼叫端接住。
 */
export function saveHomeDailyGoal(store: KeyValueStore, goal: number): boolean {
  if (!isDailyGoal(goal)) return false;
  const record = readRaw(store);
  store.setItem(DEVICE_SAVE_RECORD_KEY, JSON.stringify({ ...record, homeGoal: goal }));
  return true;
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
