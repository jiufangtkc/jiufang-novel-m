/**
 * 新稿子的全書目標預設（WO-109，歡迎-2）。
 *
 * - 只存在這個裝置的瀏覽器本機儲存（localStorage），鍵名見 NEW_BOOK_GOAL_STORAGE_KEY。
 *   不寫進稿子、不寫進 .db，不同步。
 * - 值是 1 以上的整數字串，例如 "200000"：不含千分位、不是 JSON 物件。
 * - 沒有這個鍵、空白、0、負數、小數、千分位、前後空白、亂碼、超出安全整數，一律當作沒設，回 100,000。
 *   不做部分解析（"200000abc" 不會變成 200000）。
 * - 只在開新稿子（一般開新稿子、匯入文字檔開成新稿子）時讀；既有稿子、開啟的 .db、回復暫存稿都不套用。
 * - 本機儲存不能用（私人瀏覽、被擋、取得 localStorage 就丟錯、getItem／setItem 丟錯）時照樣能用：
 *   這次開著時寫過的值留在記憶體，以記憶體為準；下次打開讀不到就回 100,000。
 * - 讀的時候不替使用者寫入任何值。
 */

export const NEW_BOOK_GOAL_STORAGE_KEY = 'jiufang-novel-m.new-book-goal.v1';

/** 沒設過或值不合法時的新稿子全書目標（和 WO-109 之前寫死的值相同）。 */
export const NEW_BOOK_GOAL_DEFAULT = 100000;

export interface NewBookGoalReadStore {
  getItem(key: string): string | null;
}

export interface NewBookGoalWriteStore {
  setItem(key: string, value: string): void;
}

/** 合法的全書目標：1 以上的安全整數。 */
export function isValidBookGoal(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

/** 只認「1～9 開頭、後面全是數字」的整數字串，且在安全整數內。其他都回 null。 */
export function parseNewBookGoal(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw)) return null;
  const value = Number(raw);
  return isValidBookGoal(value) ? value : null;
}

/** 這次開著時寫過的值；本機儲存寫不進去時仍以這裡為準。 */
let sessionGoal: number | null = null;

function browserStore(): (NewBookGoalReadStore & NewBookGoalWriteStore) | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // 有些瀏覽器光是讀 localStorage 就會丟錯。
    return null;
  }
}

/**
 * 讀新稿子的全書目標預設。這次開著時寫過的以記憶體為準；否則從本機讀。
 * 沒設過、不合法、讀不到都回 100,000。只讀不寫，不丟錯。
 */
export function readNewBookGoal(store?: NewBookGoalReadStore | null): number {
  if (sessionGoal !== null) return sessionGoal;
  const target = store === undefined ? browserStore() : store;
  if (!target) return NEW_BOOK_GOAL_DEFAULT;
  try {
    return parseNewBookGoal(target.getItem(NEW_BOOK_GOAL_STORAGE_KEY)) ?? NEW_BOOK_GOAL_DEFAULT;
  } catch {
    return NEW_BOOK_GOAL_DEFAULT;
  }
}

/**
 * 寫入新稿子的全書目標預設（給歡迎導覽第 2 關用）。只寫這一把鍵，存成整數字串。
 * 值不合法不寫、回 false。合法時先記在記憶體（這次開著時開新稿子就用它），
 * 再寫本機；寫不進去回 false，不丟錯。
 */
export function writeNewBookGoal(goal: number, store?: NewBookGoalWriteStore | null): boolean {
  if (!isValidBookGoal(goal)) return false;
  sessionGoal = goal;
  const target = store === undefined ? browserStore() : store;
  if (!target) return false;
  try {
    target.setItem(NEW_BOOK_GOAL_STORAGE_KEY, String(goal));
    return true;
  } catch {
    return false;
  }
}

/** 測試用：清掉這次開著時的記憶，模擬重新打開 App。 */
export function forgetNewBookGoalSession(): void {
  sessionGoal = null;
}
