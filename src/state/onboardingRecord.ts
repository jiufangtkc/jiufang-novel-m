/**
 * 歡迎導覽「這個裝置看過沒」的本機紀錄（WO-110，歡迎-3）。
 *
 * - 鍵 ONBOARDING_STORAGE_KEY，值是 JSON：
 *   `{"status":"done"|"skipped","at":"2026-11-17T12:00:00+08:00","appVersion":"0.1.0"}`。
 *   at 是寫入當下的本地時間（含時區位移）；appVersion 只是紀錄，不拿來判斷要不要再出現。
 * - 只要有這把鍵就不自動出現，即使內容不合法也一樣（不因版本或內容重跑）。程式從不刪這把鍵。
 * - 只存在這個裝置的瀏覽器本機儲存，不寫進稿子、不寫進 .db。
 * - 本機儲存不能用（私人瀏覽、被擋、取得 localStorage 就丟錯、getItem／setItem 丟錯）時照樣能用：
 *   這次開著時寫過的狀態留在記憶體，同一次使用不再自動出現；下次打開讀不到就可能再出現。
 */

import { APP_VERSION } from '../copy/aboutCopy';

export const ONBOARDING_STORAGE_KEY = 'jiufang-novel-m.onboarding.v1';

export type OnboardingStatus = 'done' | 'skipped';

export interface OnboardingRecord {
  status: OnboardingStatus;
  at: string;
  appVersion: string;
}

export interface OnboardingReadStore {
  getItem(key: string): string | null;
}

export interface OnboardingWriteStore {
  setItem(key: string, value: string): void;
}

/** 這次開著時已經寫過（或試著寫過）的狀態；本機儲存寫不進去時仍以這裡為準。 */
let sessionStatus: OnboardingStatus | null = null;

function browserStore(): (OnboardingReadStore & OnboardingWriteStore) | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // 有些瀏覽器光是讀 localStorage 就會丟錯。
    return null;
  }
}

function pad(value: number): string {
  return String(Math.trunc(Math.abs(value))).padStart(2, '0');
}

/** 本地時間的 ISO 8601，帶時區位移，例如「2026-11-17T12:00:00+08:00」。 */
export function localIsoWithOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export function buildOnboardingRecord(
  status: OnboardingStatus,
  now: Date,
  appVersion: string = APP_VERSION,
): OnboardingRecord {
  return { status, at: localIsoWithOffset(now), appVersion };
}

/**
 * 這個裝置有沒有歡迎導覽的紀錄。這次開著時寫過就算有；否則只看本機有沒有這把鍵（不看內容、不看版本）。
 * 讀不到本機儲存時當作沒有（照樣能用，可能再出現一次）。不丟錯。
 */
export function hasOnboardingRecord(store?: OnboardingReadStore | null): boolean {
  if (sessionStatus !== null) return true;
  const target = store === undefined ? browserStore() : store;
  if (!target) return false;
  try {
    return target.getItem(ONBOARDING_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/** 讀回紀錄內容（給測試與交接檢查用）。不合法回 null；不合法並不代表「沒有紀錄」。 */
export function readOnboardingRecord(store?: OnboardingReadStore | null): OnboardingRecord | null {
  const target = store === undefined ? browserStore() : store;
  if (!target) return null;
  try {
    const raw = target.getItem(ONBOARDING_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<OnboardingRecord> | null;
    if (
      !parsed
      || (parsed.status !== 'done' && parsed.status !== 'skipped')
      || typeof parsed.at !== 'string'
      || typeof parsed.appVersion !== 'string'
    ) {
      return null;
    }
    return { status: parsed.status, at: parsed.at, appVersion: parsed.appVersion };
  } catch {
    return null;
  }
}

/**
 * 寫紀錄（走到收尾記 done；按跳過、或舊裝置第一次遇到記 skipped）。
 * 先記在記憶體（同一次使用不再自動出現），再寫本機；寫不進去回 false，不丟錯。
 */
export function writeOnboardingRecord(
  status: OnboardingStatus,
  now: Date = new Date(),
  store?: OnboardingWriteStore | null,
): boolean {
  sessionStatus = status;
  const target = store === undefined ? browserStore() : store;
  if (!target) return false;
  try {
    target.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(buildOnboardingRecord(status, now)));
    return true;
  } catch {
    return false;
  }
}

/** 測試用：清掉這次開著時的記憶，模擬重新打開 App。 */
export function forgetOnboardingSession(): void {
  sessionStatus = null;
}

/**
 * 首頁要不要自動出現歡迎導覽（規格 D-1、G）。
 * - 'none'：有紀錄、或不在首頁（直接打開稿子網址不插隊，回首頁再判斷）。
 * - 'wait'：裝置資料（含非同步暫存稿）還沒載完，先不判斷。
 * - 'mark-skipped'：舊裝置已經有資料：不出現，直接記 skipped。
 * - 'show'：全新裝置，出現。
 */
export type FirstRunDecision = 'none' | 'wait' | 'mark-skipped' | 'show';

export function decideFirstRun(input: {
  hasRecord: boolean;
  atHome: boolean;
  deviceLoaded: boolean;
  hasExistingData: boolean;
}): FirstRunDecision {
  if (input.hasRecord) return 'none';
  if (!input.atHome) return 'none';
  if (!input.deviceLoaded) return 'wait';
  return input.hasExistingData ? 'mark-skipped' : 'show';
}

/**
 * 這個裝置已經有資料嗎：最近清單、任何暫存稿（含已從最近清單移除、但仍暫存在裝置上的稿子）、
 * 或還沒寫回的即時草稿。都沒有才算全新。
 */
export function deviceHasExistingData(input: {
  projectIds: readonly string[];
  recentIds: readonly string[];
  hasLiveDraft: boolean;
}): boolean {
  return input.projectIds.length > 0 || input.recentIds.length > 0 || input.hasLiveDraft;
}
