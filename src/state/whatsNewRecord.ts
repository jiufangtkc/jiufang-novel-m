/**
 * WO-129：改版說明「上次看過哪一版」的本機紀錄與跳出判斷。
 *
 * - 鍵名為 WHATS_NEW_SEEN_KEY，值為純版號字串（例如 "0.3.0"），不寫進稿子、不寫進 .db。
 * - 隱私模式或 localStorage 讀寫受限時，自動跳出決策一律回傳 'none'，不跳也不拋錯。
 * - 只讀不碰業務鍵的 removeItem／clear()，僅探測儲存寫入權限時使用暫時探測鍵並隨即移除。
 */

import { isNewerVersion } from '../data/whatsNew';
import { LIVE_DRAFT_KEY } from '../editor/liveDraft';
import { BODY_FONT_SCALE_STORAGE_KEY } from '../layout/bodyFontScale';
import { WIDE_PANELS_STORAGE_KEY } from '../layout/widePanels';
import { DEVICE_SAVE_RECORD_KEY } from './deviceSaveRecord';
import { HALF_WIDTH_REMINDER_STORAGE_KEY } from './halfWidthReminder';
import { EXPORT_EVENTS_KEY, IMPORT_EVENTS_KEY } from './importEvents';
import { NEW_BOOK_GOAL_STORAGE_KEY } from './newBookGoal';
import { deviceHasExistingData, hasOnboardingRecord } from './onboardingRecord';

export const WHATS_NEW_SEEN_KEY = 'jiufang-novel-m.whats-new-seen.v1';

const WHATS_NEW_PROBE_KEY = 'jiufang-novel-m.__probe__';

const USER_PREFERENCE_KEYS: readonly string[] = [
  BODY_FONT_SCALE_STORAGE_KEY,
  NEW_BOOK_GOAL_STORAGE_KEY,
  HALF_WIDTH_REMINDER_STORAGE_KEY,
  WIDE_PANELS_STORAGE_KEY,
  IMPORT_EVENTS_KEY,
  EXPORT_EVENTS_KEY,
];

const SAVE_RECORD_NON_EMPTY_FIELDS: readonly string[] = [
  'saveMeta',
  'logsById',
  'goalById',
  'exportedFiles',
  'startedById',
  'tourGoalById',
];

export interface WhatsNewReadStore {
  getItem(key: string): string | null;
}

export interface WhatsNewWriteStore {
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export type WhatsNewStore = WhatsNewReadStore & WhatsNewWriteStore;

export interface SeenVersionReadResult {
  available: boolean;
  version: string | null;
}

export interface PriorUsageInput {
  projectIds: readonly string[];
  recentIds: readonly string[];
  hasLiveDraft?: boolean;
  hasThemePreference?: boolean;
}

export type WhatsNewDecision = 'wait' | 'none' | 'mark-seen' | 'show';

export interface DecideWhatsNewInput {
  storageAvailable: boolean;
  seenVersion: string | null;
  currentVersion: string;
  hasReleaseNote: boolean;
  deviceLoaded: boolean;
  hasPriorUsage: boolean;
  welcomeOpen: boolean;
}

/** 這次開著時已經寫過的版本；本機寫不進去時仍供同一次使用判斷。 */
let sessionSeenVersion: string | null = null;

function browserStore(): WhatsNewStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // 有些瀏覽器光是存取 localStorage 就會拋 SecurityError。
    return null;
  }
}

/** 檢查本機儲存是否真正可讀且可寫；失敗回傳 false，絕不拋錯。 */
export function probeStorageAvailable(store?: WhatsNewStore | null): boolean {
  const target = store === undefined ? browserStore() : store;
  if (!target) return false;
  try {
    target.getItem(WHATS_NEW_PROBE_KEY);
    target.setItem(WHATS_NEW_PROBE_KEY, '1');
    if (typeof target.removeItem === 'function') {
      target.removeItem(WHATS_NEW_PROBE_KEY);
    } else {
      target.setItem(WHATS_NEW_PROBE_KEY, '');
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 讀出本機記住的「上次看過的版本」與儲存是否可用。
 * 沒有記號時會以探測鍵確認寫入權限，避免隱私模式讀得到 null 卻寫不進去而每次重跳。
 */
export function readSeenVersion(store?: WhatsNewStore | null): SeenVersionReadResult {
  const target = store === undefined ? browserStore() : store;
  if (!target) {
    return { available: false, version: sessionSeenVersion };
  }
  try {
    const raw = target.getItem(WHATS_NEW_SEEN_KEY);
    if (raw === null) {
      const writable = probeStorageAvailable(target);
      return { available: writable, version: sessionSeenVersion };
    }
    return { available: true, version: sessionSeenVersion ?? raw };
  } catch {
    return { available: false, version: sessionSeenVersion };
  }
}

/**
 * 寫入「已看過這版」記號：先記在記憶體，再寫入本機儲存。
 * 任何例外一律回傳 false，絕不拋錯。
 */
export function writeSeenVersion(
  version: string,
  store?: Pick<WhatsNewWriteStore, 'setItem'> | null,
): boolean {
  if (typeof version !== 'string' || version.length === 0) return false;
  sessionSeenVersion = version;
  const target = store === undefined ? browserStore() : store;
  if (!target) return false;
  try {
    target.setItem(WHATS_NEW_SEEN_KEY, version);
    return true;
  } catch {
    return false;
  }
}

function hasLiveDraftRecord(store: WhatsNewReadStore | null): boolean {
  if (!store) return false;
  try {
    return store.getItem(LIVE_DRAFT_KEY) !== null;
  } catch {
    return false;
  }
}

function hasAnyUserPreferenceKey(store: WhatsNewReadStore | null): boolean {
  if (!store) return false;
  for (const key of USER_PREFERENCE_KEYS) {
    try {
      if (store.getItem(key) !== null) return true;
    } catch {
      // 個別鍵讀取失敗時不中斷，繼續檢查其餘鍵。
    }
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasNonEmptySaveRecord(store: WhatsNewReadStore | null): boolean {
  if (!store) return false;
  try {
    const raw = store.getItem(DEVICE_SAVE_RECORD_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) return false;
    if (typeof parsed.homeGoal === 'number' && Number.isFinite(parsed.homeGoal)) {
      return true;
    }
    for (const field of SAVE_RECORD_NON_EMPTY_FIELDS) {
      const entry = parsed[field];
      if (isPlainObject(entry) && Object.keys(entry).length > 0) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 判斷本機是否有「全新使用者絕不會自動長出來」的實質舊使用痕跡。
 * 避開首開同步寫入的 input-mode／device-kind 與空殼 outline／save-record 鍵。
 */
export function hasPriorUsage(
  input: PriorUsageInput,
  store?: WhatsNewReadStore | null,
): boolean {
  const target = store === undefined ? browserStore() : store;
  const hasDraft = input.hasLiveDraft ?? hasLiveDraftRecord(target);
  return (
    Boolean(input.hasThemePreference)
    || hasOnboardingRecord(store)
    || deviceHasExistingData({
      projectIds: input.projectIds,
      recentIds: input.recentIds,
      hasLiveDraft: hasDraft,
    })
    || hasAnyUserPreferenceKey(target)
    || hasNonEmptySaveRecord(target)
  );
}

/**
 * 改版說明是否自動跳出或靜默寫入的純函式狀態機：
 * - 'none'：隱私模式不可用、本版無條目、已看過同版或較新版。
 * - 'wait'：尚無記號且暫存資料未載完，或舊使用者目前正開著歡迎導覽。
 * - 'mark-seen'：全新使用者，不跳視窗並立即靜默記住目前版本。
 * - 'show'：舊使用者或升版後首次遇到本版，自動跳出改版說明。
 */
export function decideWhatsNew(input: DecideWhatsNewInput): WhatsNewDecision {
  if (!input.storageAvailable) return 'none';
  if (!input.hasReleaseNote) return 'none';

  if (input.seenVersion !== null) {
    if (!isNewerVersion(input.currentVersion, input.seenVersion)) return 'none';
    return input.welcomeOpen ? 'wait' : 'show';
  }

  if (!input.deviceLoaded) return 'wait';
  if (!input.hasPriorUsage) return 'mark-seen';
  if (input.welcomeOpen) return 'wait';
  return 'show';
}

/** 測試用：清除記憶體記憶，模擬重新打開 App。 */
export function forgetWhatsNewSession(): void {
  sessionSeenVersion = null;
}
