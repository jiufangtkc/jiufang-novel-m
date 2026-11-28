/**
 * WO-144（暫定，待九方審）：隨手記靈感的畫面用字。
 * 元件與測試只引用這裡的常數，不在元件裡硬寫句子。
 */

/** 分類名稱（也是尋找既有「靈感」分類時比對的顯示名稱，須完全相同）。 */
export const QUICK_IDEA_CATEGORY_NAME = '靈感';

/** 頁首圖示與「⋯」選單項（無障礙名稱也用這句）。 */
export const QUICK_IDEA_OPEN_LABEL = '記靈感';
export const QUICK_IDEA_SHEET_TITLE = '記靈感';

export const QUICK_IDEA_TITLE_LABEL = '標題（可不填）';
export const QUICK_IDEA_CONTENT_LABEL = '內容';
export const QUICK_IDEA_CANCEL = '取消';
export const QUICK_IDEA_SAVE = '存起來';
export const QUICK_IDEA_EMPTY_HINT = '請先寫一點再存。';

/** 記入畫面說明：帶入這本稿子的實際書名。 */
export function quickIdeaSheetHint(bookTitle: string): string {
  return `會先放進這本《${bookTitle}》的「${QUICK_IDEA_CATEGORY_NAME}」分類，之後再歸到角色或世界觀。`;
}

export const QUICK_IDEA_SAVED_NOTICE = '已存成靈感卡片。';
export const QUICK_IDEA_NOTICE_ACTION = '去看看';

/** 資料集分類清單最上方的說明。 */
export const QUICK_IDEA_CATEGORY_LIST_HINT =
  '隨手記下的卡片會先放在「靈感」裡，之後再歸到下面的分類。';
/** 靈感清單說明。 */
export const QUICK_IDEA_LIST_HINT =
  '新記的會排在最上面。確定這則屬於誰或哪裡之後，按「改分類」即可。';

export const QUICK_IDEA_MOVE_BUTTON = '改分類';
export const QUICK_IDEA_MOVE_TITLE = '改分類';
export const QUICK_IDEA_MOVE_HINT = '要把這張卡放到哪個分類？';

/* 以下為實作時補的輔助用字（非草案表內），一併列入暫定用字檔待九方審。 */
export const QUICK_IDEA_COMPOSING_TOAST = '先把正在輸入的字打完，再記靈感。';
export const QUICK_IDEA_SAVE_FAILED = '這次沒能存成靈感卡片，請稍後再試。';
export const QUICK_IDEA_NOTICE_CLOSE_LABEL = '關閉';
export const QUICK_IDEA_NOTICE_CLOSE_ARIA = '關閉靈感提示';
export const QUICK_IDEA_MOVE_CANCEL = '取消';
export const QUICK_IDEA_UNTITLED = '（未命名）';
