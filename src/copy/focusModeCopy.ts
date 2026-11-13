/**
 * 專注模式文案常數（WO-62）
 *
 * 依據九方定案與新詞審稿：
 * 1. 沿用既有常數 FOCUS_MODE_ENTER_BUTTON「專注模式」、FOCUS_MODE_EXIT_BUTTON「離開專注模式」。
 * 2. 由於 userFacing.ts 為唯讀檔案，新文案常數統一集中於本檔案。
 * 3. 一律使用臺灣繁體中文與臺灣用詞。
 */

import {
  FOCUS_MODE_ENTER_BUTTON,
  FOCUS_MODE_EXIT_BUTTON,
} from './userFacing';

export { FOCUS_MODE_ENTER_BUTTON, FOCUS_MODE_EXIT_BUTTON };

/** 手機橫拿浮動離開按鈕朗讀文字（九方定案：只有圖示，朗讀「離開專注模式」） */
export const FOCUS_MODE_LANDSCAPE_EXIT_ARIA = FOCUS_MODE_EXIT_BUTTON;

/** 手機橫拿浮動專注模式按鈕朗讀文字 */
export const FOCUS_MODE_LANDSCAPE_ENTER_ARIA = FOCUS_MODE_ENTER_BUTTON;

/** 手機直拿拇指區第三顆「專注模式」按鈕標籤 */
export const FOCUS_MODE_THUMB_ENTER_LABEL = FOCUS_MODE_ENTER_BUTTON;

/** 專注模式離開按鈕展開文字 */
export const FOCUS_MODE_EXIT_EXPAND_LABEL = FOCUS_MODE_EXIT_BUTTON;
