import { countWords } from './wordCount';

/**
 * 與電腦版 writing_logs 同一列的欄位。
 * 網頁版不做 AI，但這幾個欄位要留著，日後匯入與交回才不會把電腦版的紀錄弄丟。
 */
export interface WritingLogRow {
  id: number;
  /** 寫作日，YYYY-MM-DD */
  date: string;
  /** 寫作秒數 */
  duration: number;
  word_count: number;
  ai_continuation_count: number;
  ai_continuation_chars: number;
  ai_chat_count: number;
  /** 電腦版存的 JSON 文字。網頁版不解析、不顯示。 */
  ai_details: string | null;
  paste_large_count: number;
  delete_large_count: number;
}

/** 一次塞進這麼多字，就記成「大量文字出現」。待九方確認門檻。 */
export const LARGE_TEXT_THRESHOLD = 50;

export type TextChangeSource = 'type' | 'composition' | 'paste' | 'drop' | 'unknown';

export interface TextDelta {
  wordDelta: number;
  insertedChars: number;
  deletedChars: number;
  largeInsert: boolean;
  largeDelete: boolean;
}

export function classifyTextDelta(
  before: string,
  after: string,
  options?: { threshold?: number; source?: TextChangeSource },
): TextDelta {
  const threshold = options?.threshold ?? LARGE_TEXT_THRESHOLD;
  const source = options?.source ?? 'unknown';
  let start = 0;
  const minLength = Math.min(before.length, after.length);
  while (start < minLength && before[start] === after[start]) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const insertedChars = countWords(after.slice(start, endAfter));
  const deletedChars = countWords(before.slice(start, endBefore));
  return {
    wordDelta: insertedChars - deletedChars,
    insertedChars,
    deletedChars,
    // 注音、倉頡送出一整個詞是正常組字，不算突然出現的大段文字。
    largeInsert: source !== 'composition' && insertedChars >= threshold,
    largeDelete: deletedChars >= threshold,
  };
}

export function emptyWritingLog(id: number, date: string): WritingLogRow {
  return {
    id,
    date,
    duration: 0,
    word_count: 0,
    ai_continuation_count: 0,
    ai_continuation_chars: 0,
    ai_chat_count: 0,
    ai_details: null,
    paste_large_count: 0,
    delete_large_count: 0,
  };
}

export function applyLargeEvent(row: WritingLogRow, delta: TextDelta): WritingLogRow {
  if (!delta.largeInsert && !delta.largeDelete) return row;
  return {
    ...row,
    paste_large_count: row.paste_large_count + (delta.largeInsert ? 1 : 0),
    delete_large_count: row.delete_large_count + (delta.largeDelete ? 1 : 0),
  };
}

export function withLogWordCount(row: WritingLogRow, wordCount: number): WritingLogRow {
  return { ...row, word_count: Math.max(0, wordCount) };
}

export function withAddedDuration(row: WritingLogRow, seconds: number): WritingLogRow {
  const extra = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  return { ...row, duration: row.duration + extra };
}

/** 寫作過程畫面上用的時間說法。 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours <= 0) return `${minutes} 分`;
  return `${hours} 小時 ${minutes} 分`;
}

export function formatHours(seconds: number): string {
  return (Math.max(0, seconds) / 3600).toFixed(1);
}
