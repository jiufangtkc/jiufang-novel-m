import { formatInteger } from '../domain/formatNumber';
import type { FormatScope } from '../editor/formatScope';

/**
 * WO-139 一鍵統一標點（0.7.0）：全部介面用字（暫定，待九方審）。
 *
 * - 一律使用臺灣繁體中文、臺灣用詞，不使用簡體字或「您」。
 * - 不動 userFacing.ts 既有 FORMAT_*／format* 匯出鍵，維持 format.wo122.test.ts 零破壞。
 */

/** 暫定，待九方審：排版方式選單第 4 個選項 */
export const PUNCT_KIND_LABEL = '統一標點';

/** 暫定，待九方審：統一標點確認視窗標題 */
export const PUNCT_CONFIRM_TITLE = '要統一標點嗎？';

/** 暫定，待九方審：統一標點確認視窗主句（含預估處數） */
export function punctConfirmSentence(scope: FormatScope, count: number): string {
  const formatted = formatInteger(count);
  return scope === 'book'
    ? `全書會統一 ${formatted} 處標點，只改正文，改完可以復原。`
    : `這一章會統一 ${formatted} 處標點，只改正文，改完可以復原。`;
}

/** 暫定，待九方審：統一標點確認視窗主按鈕 */
export const PUNCT_CONFIRM_START = '統一標點';

/** 暫定，待九方審：預估為 0 處時直接關閉視窗並顯示的短提示 */
export function punctAlreadyUnifiedToast(scope: FormatScope): string {
  return scope === 'book'
    ? '全書的標點已經是統一的了。'
    : '這一章的標點已經是統一的了。';
}

/** 暫定，待九方審：完成提示列主標題 */
export function punctDoneTitle(count: number): string {
  return `已統一 ${formatInteger(count)} 處標點`;
}

/** 暫定，待九方審：按「復原」成功後的短提示 */
export const PUNCT_UNDONE_TOAST = '已回到統一標點前的樣子。';
