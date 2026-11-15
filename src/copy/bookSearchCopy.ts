/**
 * WO-63 全書搜尋與找與取代文案。
 *
 * 依據：第 3 階段補做新詞審稿（2026-11-12）第 1–14 列，九方 2026-11-12 10:55／10:56 定案。
 * userFacing.ts 不改，本張新文案集中在這裡。數字四位數以上加千分位。
 * 提示句與黃框說明句尾不加句號。
 */
import { formatInteger } from '../domain/formatNumber';

/** 第 1 列：頁首標題、放大鏡朗讀 */
export const BOOK_SEARCH_TITLE = '全書搜尋';
/** 放大鏡與手機橫拿浮動鈕朗讀 */
export const BOOK_SEARCH_OPEN_ARIA = BOOK_SEARCH_TITLE;
/** 寬版左欄頂端切換的兩個字 */
export const BOOK_SEARCH_TAB_TREE = '目錄';
export const BOOK_SEARCH_TAB_SEARCH = '搜尋';
/** 第 2 列 */
export const FIND_REPLACE_TOGGLE = '找與取代';
/** 第 3 列 */
export const REPLACE_WITH_LABEL = '取代成';
/** 第 4 列 */
export const SCOPE_BOOK = '全書';
export const SCOPE_CHAPTER = '這一章';
/** 第 5 列 */
export const REPLACE_ONE = '取代這處';
/** 第 6 列 */
export const REPLACE_ALL = '取代全部';
/** 第 7 列 */
export const REPLACED_MARK = '已取代';
/** 第 8 列 */
export const UNDO_LAST_REPLACE = '復原上次取代';
/** 完成提示旁的短按鈕（沿用目錄刪除後的「復原」） */
export const UNDO_SHORT = '復原';
/** 第 12 列：畫面字與朗讀 */
export const BACK_TO_RESULTS = '回結果';
export const BACK_TO_RESULTS_ARIA = '返回搜尋結果';
/** 第 13 列：搜尋頁頁首返回鈕朗讀 */
export const BACK_TO_WRITING_ARIA = '返回寫作';
/** 第 14 列：黃框，一直顯示，句尾不加句號 */
export const BODY_ONLY_NOTE = '只改正文，資料集的卡片不會改';

export const SEARCH_INPUT_ARIA = '要搜尋的字';
export const SEARCH_INPUT_PLACEHOLDER = '搜尋正文';
export const REPLACE_INPUT_ARIA = REPLACE_WITH_LABEL;
export const CLEAR_SEARCH_ARIA = '清除搜尋的字';
export const CLEAR_REPLACE_ARIA = '清除取代成的字';
export const SCOPE_GROUP_ARIA = '搜尋範圍';
export const PREV_HIT_ARIA = '上一處';
export const NEXT_HIT_ARIA = '下一處';
export const CONFIRM_TITLE = '取代全部？';
export const CONFIRM_CANCEL = '取消';
export const CONFIRM_UNDO_HINT = '取代後可以按「復原」一次全部換回來。';
export const SEARCH_EMPTY_HINT = '輸入要找的字，會列出正文裡每一處';
export const NO_CHAPTER_FOR_SCOPE = '先打開一章，才能只搜尋這一章';
export const UNDO_DONE = '已復原上次取代';

const n = (value: number) => formatInteger(value);

/** 第 10 列：搜尋列「共 12 處，在 4 章」 */
export function searchSummary(total: number, chapters: number): string {
  return `共 ${n(total)} 處，在 ${n(chapters)} 章`;
}

/** 第 11 列：確認視窗「共 12 處，分布在 4 章」 */
export function confirmSummary(total: number, chapters: number): string {
  return `共 ${n(total)} 處，分布在 ${n(chapters)} 章`;
}

/** 確認視窗：把「老鄭」換成「老陳」 */
export function confirmReplaceLine(query: string, replacement: string): string {
  return `把「${query}」換成「${replacement}」`;
}

/** 確認視窗再說一次只改正文；有含這個字的卡片就舉它當例子 */
export function confirmCardsNote(exampleCardTitle: string | null): string {
  if (!exampleCardTitle) return BODY_ONLY_NOTE;
  return `只改正文，資料集的卡片（例如「${exampleCardTitle}」）不會改`;
}

/** 結果分組與確認明細的處數 */
export function hitCountLabel(count: number): string {
  return `${n(count)} 處`;
}

/** 第 9 列：已取代 N 處（M 章），句尾不加句號 */
export function replaceDoneMessage(total: number, chapters: number): string {
  return `已取代 ${n(total)} 處（${n(chapters)} 章）`;
}

/** 頂端復原列說明：已把 12 處「老鄭」換成「老陳」 */
export function undoBarMessage(total: number, query: string, replacement: string): string {
  return `已把 ${n(total)} 處「${query}」換成「${replacement}」`;
}

/** 直拿拇指區：第 2／12 處 */
export function hitPositionLabel(index: number, total: number): string {
  return `第 ${n(index)}／${n(total)} 處`;
}

/** 拇指區小字：「老鄭」・第一章 */
export function hitWhereLabel(query: string, chapterTitle: string): string {
  return `「${query}」${chapterTitle}`;
}

/** 找不到時 */
export function searchNotFound(query: string): string {
  return `找不到「${query}」`;
}

/** 每筆結果的朗讀：第一章，第 1 處 */
export function hitRowAria(chapterTitle: string, ordinal: number, before: string, match: string, after: string): string {
  return `${chapterTitle}，第 ${n(ordinal)} 處：${before}${match}${after}`;
}

/** 「取代這處」的朗讀要說是哪一處 */
export function replaceOneAria(chapterTitle: string, ordinal: number): string {
  return `${REPLACE_ONE}：${chapterTitle}第 ${n(ordinal)} 處`;
}
