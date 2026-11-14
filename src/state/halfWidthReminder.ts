import { useSyncExternalStore } from 'react';

/**
 * WO-76 乙段：「提醒半形標點」開關與「先不用」記憶。
 *
 * 開關只存在這個瀏覽器（localStorage），預設開啟，不寫進會傳到電腦版的 .db。
 * 「先不用」只記在記憶體：關掉 App（重新整理）或換書就忘記，同一本書切到別章再回來仍記得。
 */

export const HALF_WIDTH_REMINDER_STORAGE_KEY = 'jiufang-novel-m.half-width-reminder.v1';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): Store | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** 沒存過或讀不到都當作開啟。只有存成 '0' 才是關閉。 */
export function readHalfWidthReminder(store: Pick<Storage, 'getItem'> | null = storage()): boolean {
  try {
    return store?.getItem(HALF_WIDTH_REMINDER_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

const listeners = new Set<() => void>();
let current: boolean | null = null;

export function writeHalfWidthReminder(on: boolean, store: Store | null = storage()): void {
  try {
    store?.setItem(HALF_WIDTH_REMINDER_STORAGE_KEY, on ? '1' : '0');
  } catch {
    // 存不進去就只在這次有效。
  }
  current = on;
  for (const listener of listeners) listener();
}

function snapshot(): boolean {
  if (current === null) current = readHalfWidthReminder();
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useHalfWidthReminder(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, snapshot, () => true);
  return [on, writeHalfWidthReminder];
}

/** 「先不用」：只記目前這本書；換書就清掉。 */
let skipped: { bookId: string; chapters: Set<string> } | null = null;

export function skipHalfWidthForChapter(bookId: string, chapterId: string): void {
  if (!skipped || skipped.bookId !== bookId) skipped = { bookId, chapters: new Set() };
  skipped.chapters.add(chapterId);
}

export function isHalfWidthSkipped(bookId: string, chapterId: string): boolean {
  return Boolean(skipped && skipped.bookId === bookId && skipped.chapters.has(chapterId));
}

/** 進到某本書的寫作頁時呼叫；和記住的不是同一本就忘掉「先不用」。 */
export function noteHalfWidthBook(bookId: string): void {
  if (skipped && skipped.bookId !== bookId) skipped = null;
}

/** 測試用：模擬重新打開 App。 */
export function resetHalfWidthSession(): void {
  skipped = null;
  current = null;
}
