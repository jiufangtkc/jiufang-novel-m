import type { ChapterNode } from '../data/demo';
import { countBodyWords } from './wordCount';

/**
 * WO-98：寫作頁頁首「已經 N 天沒存檔了」的判定。
 *
 * 「存檔」只指存成使用者選定位置的 .db：lastProjectSaveMs（儲存專案、新書名另存）與
 * lastExportMs（另存專案、分享／下載交付）。自動暫存、立刻暫存只是本機暫存，不算。
 * 天數以毫秒差計算：滿 24 小時為一天，滿 72 小時才提醒；不看裝置時區與換日。
 */
export const STALE_SAVE_DAY_MS = 24 * 60 * 60 * 1000;
export const STALE_SAVE_DAYS_THRESHOLD = 3;

/** 2020-01-01，早於這個時間的毫秒值不當作稿子建立時間。 */
const MIN_PLAUSIBLE_MS = Date.UTC(2020, 0, 1);

/** 有效的過去時間：有限正數、不晚於現在。未來時間、NaN、負數一律視為無效。 */
function validPast(value: number | null | undefined, nowMs: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value > nowMs ? null : value;
}

/** 新稿子代號嚴格是「p-」加 13 位毫秒時間時，回推建立時間；其他一律不回推。 */
export function startedMsFromProjectId(projectId: string, nowMs: number): number | null {
  const match = /^p-(\d{13})$/.exec(projectId);
  if (!match) return null;
  const value = Number(match[1]);
  return value >= MIN_PLAUSIBLE_MS && value <= nowMs ? value : null;
}

export interface StaleSaveInput {
  lastProjectSaveMs: number | null | undefined;
  lastExportMs: number | null | undefined;
  /** 本機記下的稿子建立（或第一次遇到）時間。 */
  startedMs: number | null | undefined;
  nowMs: number;
}

/** 起算時間：兩個 .db 存檔時間中最新的有效者；都沒有就用建立時間；都無效回傳 null。 */
export function staleSaveBaseMs(input: StaleSaveInput): number | null {
  const saves = [input.lastProjectSaveMs, input.lastExportMs]
    .map((value) => validPast(value, input.nowMs))
    .filter((value): value is number => value != null);
  if (saves.length > 0) return Math.max(...saves);
  return validPast(input.startedMs, input.nowMs);
}

/** 已經幾天沒存檔；未滿 3 天或無法判定回傳 null。 */
export function staleSaveDays(input: StaleSaveInput): number | null {
  const base = staleSaveBaseMs(input);
  if (base == null) return null;
  const days = Math.floor((input.nowMs - base) / STALE_SAVE_DAY_MS);
  return days >= STALE_SAVE_DAYS_THRESHOLD ? days : null;
}

/** 全書有沒有任何正文（只算章與幕的正文，不算名稱）。空稿子沒有東西可存，不提醒。 */
export function hasBodyText(nodes: readonly ChapterNode[]): boolean {
  return nodes.some((node) => countBodyWords(node) > 0);
}
