/**
 * 查字典：選取判定的純函式（WO-104，規格 B-1、B-2、B-3）
 * 不碰畫面、不讀任何資料；送出的永遠是清理後的原字，不換字（台不換臺）。
 */

import { DICT_BUTTON_LABEL, DICT_HINT_ELLIPSIS, dictAriaLabel } from '../copy/dictionaryCopy';

/** 最多可查的字數（清理後，以「字」計） */
export const DICT_MAX_CHARS = 10;

/** 4 字以上時小字只顯示前幾個字 */
const HINT_FULL_MAX = 3;
const HINT_CUT_KEEP = 2;

const DICT_BASE_URL = 'https://dict.revised.moe.edu.tw/search.jsp?md=1&word=';

/** 兩端要去掉的字：空白（含全形、不換行、零寬）、Unicode 標點、～、~ */
const EDGE_CHAR = /^[\s\u3000\u00A0\u200B\uFEFF\u2028\u2029\p{P}～~]$/u;
const LINE_BREAK = /[\n\r\u2028\u2029]/;

/** 從前後兩端反覆去掉空白與標點，中間不動 */
export function cleanSelection(raw: string): string {
  const chars = Array.from(raw);
  let start = 0;
  let end = chars.length;
  while (start < end && EDGE_CHAR.test(chars[start])) start += 1;
  while (end > start && EDGE_CHAR.test(chars[end - 1])) end -= 1;
  return chars.slice(start, end).join('');
}

export interface DictEvaluation {
  /** 清理後的詞；不可查時為空字串 */
  word: string;
  canLookup: boolean;
}

const NOT_LOOKUPABLE: DictEvaluation = { word: '', canLookup: false };

/** B-1 第 2～6 步：組字中、清理後空、跨段、超過 10 字都不可查 */
export function evaluateSelection(raw: string, composing = false): DictEvaluation {
  if (composing) return NOT_LOOKUPABLE;
  const word = cleanSelection(raw);
  if (word === '') return NOT_LOOKUPABLE;
  if (LINE_BREAK.test(word)) return NOT_LOOKUPABLE;
  if (Array.from(word).length > DICT_MAX_CHARS) return NOT_LOOKUPABLE;
  return { word, canLookup: true };
}

/** 按鈕小字：1～3 字全顯示；4～10 字顯示前 2 字加「…」 */
export function dictHintText(word: string): string {
  const chars = Array.from(word);
  if (chars.length <= HINT_FULL_MAX) return word;
  return chars.slice(0, HINT_CUT_KEEP).join('') + DICT_HINT_ELLIPSIS;
}

/** 教育部重編國語辭典修訂本查詢網址 */
export function buildDictUrl(word: string): string {
  return DICT_BASE_URL + encodeURIComponent(word);
}

/** 按鈕要用的全部顯示資料 */
export function dictButtonView(word: string): { label: string; hint: string; ariaLabel: string } {
  return { label: DICT_BUTTON_LABEL, hint: dictHintText(word), ariaLabel: dictAriaLabel(word) };
}
