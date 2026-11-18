/**
 * 查字典文案常數（WO-104）
 *
 * 依據：開單規格 B-2、B-3、H-2。九方已定「查字典」、朗讀句與沒網路提示句。
 * 畫面（105、106）只引用本檔，不在元件裡寫死字。
 */

/** 按鈕主字（標籤，不加句號） */
export const DICT_BUTTON_LABEL = '查字典';

/** 小字被截斷時接在前 2 個字後面的全形刪節號（一個，不用三個半形句點） */
export const DICT_HINT_ELLIPSIS = '…';

/** 主字與小字之間的版面間隔（全形空白；朗讀不念） */
export const DICT_BUTTON_GAP = '　';

/** 沒網路提示（role="status"、aria-live="polite" 念同一句，不另寫朗讀文字） */
export const DICT_OFFLINE_NOTICE = '現在沒有網路，連上後再按一次。';

/** 按鈕朗讀文字，詞用完整清理後的詞，不照畫面截短 */
export function dictAriaLabel(word: string): string {
  return `${DICT_BUTTON_LABEL}，${word}。會在新分頁開教育部辭典`;
}
