/**
 * WO-64：寫作時看卡片也能編輯的新增文字與朗讀文字。
 * 「已存好「○○」」沿用 cardEditCopy 的 savedCardToast，不在這裡重複。
 */

export const WRITING_CARD_MORE_TITLE = '更多動作';
export const WRITING_CARD_OPEN_IN_DATASET = '到資料集管理這張卡片';
export const WRITING_CARD_MORE_CLOSE = '關閉';
export const WRITING_CARD_PLACE_SEPARATOR = '・';

const LINE_EXCERPT_MAX = 10;

/** 取游標前同一行的最後幾個字當位置提示，沒有字就用「新的一行」。 */
export function placeLineExcerpt(text: string, caret: number): string {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const line = before.slice(before.lastIndexOf('\n') + 1).trim();
  if (!line) return '新的一行';
  const chars = Array.from(line);
  return chars.length > LINE_EXCERPT_MAX
    ? `…${chars.slice(-LINE_EXCERPT_MAX).join('')}那行`
    : `${chars.join('')}那行`;
}

/** 手機直拿編輯頂端：寫作位置已記住：第三章・…那行 */
export function writingPlaceLabel(chapterTitle: string, text: string, caret: number): string {
  const title = chapterTitle.trim() || '這一章';
  return `寫作位置已記住：${title}${WRITING_CARD_PLACE_SEPARATOR}${placeLineExcerpt(text, caret)}`;
}

/** 朗讀時把「・」換成「，」。 */
export function writingPlaceSpoken(label: string): string {
  return label.split(WRITING_CARD_PLACE_SEPARATOR).join('，');
}
