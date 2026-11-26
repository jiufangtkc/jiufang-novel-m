import { formatInteger } from '../domain/formatNumber';
import { shouldAutoCaptureDeletion } from '../domain/trash';

/**
 * WO-138 刪稿暫存區：全部畫面用字（暫定，待九方審）。
 * 一律使用臺灣繁體中文、臺灣用詞，不使用簡體字、「您」、「這台＋裝置」或「彈窗」。
 */

export const TRASH_MENU_OPEN = '刪稿暫存區';
export const TRASH_MENU_MOVE_SELECTION = '移到刪稿暫存區';

export function trashMenuBadge(count: number): string {
  return `${formatInteger(count)} 則`;
}

export const TRASH_SHEET_TITLE = '刪稿暫存區';
export const TRASH_CLOSE_ARIA = '關閉刪稿暫存區';
export const TRASH_CLOSE_LABEL = '關閉';
export const TRASH_BACK_LABEL = '返回';
export const TRASH_EMPTY_HINT = '還沒有刪掉的段落。';

export const TRASH_CORNER_ADDED = '已放到刪稿暫存區';
export const TRASH_CORNER_VIEW = '查看';
export const TRASH_CORNER_CLOSE_ARIA = '關閉刪稿提示';

export function trashCornerAddedWithEvict(count: number): string {
  if (count === 1) {
    return '已放到刪稿暫存區，並清掉最舊的一則未註記刪稿';
  }
  return `已放到刪稿暫存區，並清掉最舊的 ${formatInteger(count)} 則未註記刪稿`;
}

export const TRASH_CORNER_BLOCKED_FULL =
  '刪稿暫存區已經滿了，且每一則都有寫原因，請先整理';
export const TRASH_CORNER_BLOCKED_EXCEEDS_MAX_WORDS =
  '這段超過 50,000 字上限，放不進刪稿暫存區';

export function trashBlockedMessage(reason: 'exceeds-max-words' | 'all-annotated'): string {
  return reason === 'exceeds-max-words'
    ? TRASH_CORNER_BLOCKED_EXCEEDS_MAX_WORDS
    : TRASH_CORNER_BLOCKED_FULL;
}

export function trashUsageSummary(count: number, words: number): string {
  return `已存 ${formatInteger(count)}／50 則 · ${formatInteger(words)}／50,000 字`;
}

export const TRASH_LIMIT_NEAR_HINT =
  '快滿了。滿了會先清掉最舊、沒寫原因的刪稿；有寫原因的會留著。';
export const TRASH_LIMIT_FULL_EVICTABLE_HINT =
  '已經滿了。下次有新刪稿時，會先清掉最舊、沒寫原因的那則。';
export const TRASH_LIMIT_FULL_LOCKED_HINT =
  '已經滿了，而且每一則都有寫原因。新的刪稿放不進來，請先整理幾則。';

export const TRASH_NEWER_REVISION_HINT =
  '這份稿子的刪稿暫存區來自較新版本，目前先原樣保留，請更新後再查看與管理。';
export const TRASH_CORRUPT_HINT =
  '這份稿子的刪稿暫存區資料有損壞，正文不受影響，目前無法修改暫存區。';

export function trashItemWords(words: number): string {
  return `${formatInteger(words)} 字`;
}

export function trashOriginalChapterGone(title: string): string {
  return `${title || '原章'}（原章已不在）`;
}

export const TRASH_DETAIL_CONTENT_ARIA = '刪稿全文';
export const TRASH_REASON_LABEL = '當時為什麼刪（選填）';
export const TRASH_REASON_PLACEHOLDER = '想記的話寫在這裡，隨時可改';
export const TRASH_REASON_SAVE = '記下原因';
export const TRASH_REASON_SAVED_TOAST = '已記下原因';

export const TRASH_PUT_BACK_BUTTON = '放回原章';
export const TRASH_PICK_CHAPTER_BUTTON = '選一章放回';
export const TRASH_PICK_CHAPTER_TITLE = '原來的章已經不在';
export const TRASH_PICK_CHAPTER_HINT = '請選一個現有的章放進去，不會另外新建章節。';
export const TRASH_NO_CHAPTER_AVAILABLE =
  '這份稿子現在沒有章可以放，請先回目錄新增一章。';

export const TRASH_PUT_BACK_ORIGINAL_TOAST = '已放回原來的位置';
export const TRASH_PUT_BACK_END_TOAST = '原位置已經變了，已放在本章最末';

export function trashPutBackPickedToast(title: string): string {
  return `已放在「${title}」最末`;
}

export function trashSceneTargetLabel(parentChapterTitle: string, sceneTitle: string): string {
  return `${parentChapterTitle} ／ ${sceneTitle}`;
}

export const TRASH_COMPOSING_TOAST = '先把正在輸入的字打完，再放回刪稿。';
export const TRASH_MOVE_COMPOSING_TOAST = '先把正在輸入的字打完，再移到刪稿暫存區。';
export const TRASH_MOVE_READONLY_TOAST = '這份稿子的刪稿暫存區目前無法修改。';

export const TRASH_DISCARD_BUTTON = '丟掉';
export const TRASH_DISCARD_CONFIRM_TITLE = '要丟掉這則刪稿嗎？';
export const TRASH_DISCARD_CONFIRM_HINT = '丟掉後 10 秒內可以按「復原」。';
export const TRASH_DISCARD_CONFIRM_OK = '丟掉';
export const TRASH_DISCARD_CANCEL = '取消';
export const TRASH_DISCARDED_BAR = '已丟掉這則刪稿';
export const TRASH_UNDO_BUTTON = '復原';
export const TRASH_RESTORED_TOAST = '已放回刪稿暫存區';

/** 返工 1（暫定，待九方審）：正文選取字數角落提示。 */
export const TRASH_SELECTION_THRESHOLD_HINT = '刪掉會收進暫存區';

export function trashSelectionCountLabel(wordCount: number): string {
  const base = `已選 ${formatInteger(wordCount)} 字`;
  if (shouldAutoCaptureDeletion(wordCount)) {
    return `${base}，${TRASH_SELECTION_THRESHOLD_HINT}`;
  }
  return base;
}
