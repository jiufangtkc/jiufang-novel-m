import { formatInteger } from '../domain/formatNumber';

/**
 * WO-140 稿子版本第一版：全部新增介面用字（暫定，待九方審）。
 * 一律使用臺灣繁體中文、臺灣用詞，不使用簡體字、「您」、「這台＋裝置」或「彈窗」。
 */

// ---- 第 7.1 節：白話工單明列之 19 項暫定用字（逐字照用，暫定，待九方審） ----
export const VERSION_MENU_OPEN = '版本';
export const VERSION_SHEET_TITLE = '版本';
export const VERSION_EMPTY_HINT = '這一章還沒有存過版本。';
export const VERSION_SAVE_BUTTON = '儲存新版本';
export const VERSION_NOTE_HINT = '請寫一句備註（可留白）。';
export const VERSION_NOTE_PLACEHOLDER = '例如「改稿前」';
export const VERSION_SAVED_TOAST = '版本已儲存';
export const VERSION_DUPLICATE_HINT = '內容與最新版本相同。';
export const VERSION_PREVIEW_BUTTON = '預覽';
export const VERSION_PREVIEW_READONLY_HINT = '這一版只能看，點「用這一版」換上。';
export const VERSION_RESTORE_BUTTON = '用這一版';
export const VERSION_RESTORE_CONFIRM_BODY =
  '要把這一章換成這份舊版嗎？現版本會先自動另存，可用來復原。';
export const VERSION_AUTO_SAVE_NOTE = '回到舊版前自動保存';
export const VERSION_RESTORED_NOTICE_TITLE = '已換成舊版';
export const VERSION_UNDO_BUTTON = '復原';
export const VERSION_UNDONE_TOAST = '已復原到用舊版之前的樣子';
export const VERSION_UNDO_WARNING =
  '按「復原」會回到用舊版之前，連之後在這章新打的字也會一起還原。';
export const VERSION_EVICTED_HINT =
  '這一章的版本已滿 20 份，已自動清除最舊版本。';
export const VERSION_FULL_LOCKED_HINT =
  '這一章的版本已滿 20 份，而且都有備註。請先丟掉不需要的，再存新的。';
export const VERSION_DISCARD_CONFIRM_TITLE = '要丟掉這一版嗎？';
export const VERSION_DISCARD_CONFIRM_HINT = '丟掉後 10 秒內可以按「復原」。';

// ---- 第 7.2 節：補充介面操作、朗讀與保護狀態用字（暫定，待九方審） ----
export function versionMenuBadge(count: number): string {
  return `${formatInteger(count)} 份`;
}

export function versionWordsLabel(words: number): string {
  return `${formatInteger(words)} 字`;
}

export function versionUsageSummary(count: number): string {
  return `這一章已存 ${formatInteger(count)}／20 份`;
}

export const VERSION_CLOSE_LABEL = '關閉';
export const VERSION_CLOSE_ARIA = '關閉版本清單';
export const VERSION_BACK_LABEL = '返回';
export const VERSION_CANCEL_LABEL = '取消';
export const VERSION_PREVIEW_CONTENT_ARIA = '舊版全文';
export const VERSION_EDIT_NOTE_LABEL = '備註（可空白）';
export const VERSION_EDIT_NOTE_SAVE = '記下備註';
export const VERSION_EDIT_NOTE_SAVED_HINT = '已更新備註';
export const VERSION_DISCARD_BUTTON = '丟掉';
export const VERSION_DISCARDED_BAR = '已丟掉這一版';
export const VERSION_DISCARD_UNDONE_HINT = '已放回版本清單';
export const VERSION_RESTORE_CONFIRM_TITLE = '要換成這一版嗎？';
export const VERSION_RESTORE_OVER_LIMIT_TOAST =
  '已換成舊版；這一章原本 20 份都有備註，已暫時多留一份自動保存，請抽空整理。';
export const VERSION_AUTO_SAVE_FAIL_TOAST = '現版本沒有另存成功，先不換。';
export const VERSION_SAVE_COMPOSING_TOAST = '先把正在輸入的字打完，再儲存新版本。';
export const VERSION_RESTORE_COMPOSING_TOAST = '先把正在輸入的字打完，再換成舊版。';
export const VERSION_UNDO_COMPOSING_TOAST = '先把正在輸入的字打完，再復原。';
export const VERSION_NOTICE_CLOSE_ARIA = '關閉版本提示';
export const VERSION_NEWER_REVISION_HINT =
  '這份稿子的版本資料來自較新版本，目前先原樣保留，請更新後再查看與管理。';
export const VERSION_CORRUPT_HINT =
  '這份稿子的版本資料有損壞，正文不受影響，目前無法修改版本。';

// ---- 補充防呆與狀態提示（暫定，待九方審） ----
export const VERSION_READONLY_TOAST = '這份稿子的版本資料目前無法修改。';
export const VERSION_RESTORE_STALE_TOAST = '章節或內容剛有變動，請再看一次版本清單。';
export const VERSION_RESTORE_NO_TARGET_TOAST = '找不到這一章或這個版本，先不換。';
export const VERSION_UNDO_INVALID_TOAST = '那一章已經不在，沒辦法復原了。';
export const VERSION_OVER_LIMIT_HINT =
  '這一章目前已超過 20 份（暫留了一則自動保存），請丟掉不需要的舊版。';
export const VERSION_SAVE_STASH_FAIL_HINT =
  '這一版還沒存進本機暫存，請再試一次。';
export const VERSION_RESTORE_BLOCKED_FULL_HINT =
  '這一章的版本已超過 20 份，而且都有備註，沒辦法再自動保存，先不換。請先整理並丟掉不需要的舊版。';
