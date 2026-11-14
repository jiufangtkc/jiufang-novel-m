import type { LayoutMode, PointerMode } from '../layout/layoutMode';

/**
 * WO-61 卡片編輯、挑顏色、刪除、最近刪除、整理分類介面文案
 * 所有文字遵照臺灣繁體中文規範與 2026-11-12 介面文案審稿結論。
 */

export const EDIT_CARD_BUTTON = '編輯';
export const EDIT_CARD_HEADING = '編輯卡片';
export const EDIT_CARD_DONE = '完成';
export const EDIT_CARD_CANCEL = '取消';
export const EDIT_CARD_MORE = '更多動作';

export const CARD_TITLE_LABEL = '標題';
export const CARD_TITLE_PLACEHOLDER = '輸入卡片標題';
export const CARD_COLOR_LABEL = '卡片顏色';
export const CARD_CONTENT_LABEL = '內容';
export const CARD_CONTENT_PLACEHOLDER = '輸入卡片內容';

export const CARD_COLOR_CURRENT = '現在';
export const CARD_COLOR_CHANGE_TO = '改成';
export const CARD_COLOR_DEFAULT = '預設（不加色）';
export const CARD_COLOR_HEX_LABEL = '色碼';
export const CARD_COLOR_HEX_PLACEHOLDER = '例：#3C3F41';
export const CARD_COLOR_HEX_INVALID = '請輸入 # 開頭的 6 碼色碼（例：#3C3F41）';

export const ADD_CARD_BUTTON = '新增卡片';
export const ADD_SUBCARD_BUTTON = '新增子卡片';
export const DELETE_CARD_BUTTON = '刪除卡片';
export const CONFIRM_DELETE_BUTTON = '刪除';
export const KEEP_CARD_BUTTON = '留著';
export const UNDO_BUTTON = '復原';
export const PUT_BACK_ORIGINAL_BUTTON = '放回原位置';
export const JUMP_TO_CARD_BUTTON = '看卡片';

export const DELETED_CARDS_TITLE = '最近刪除';
export const DELETED_CARDS_EMPTY = '沒有最近刪除的卡片。';

export const ORGANIZE_CATEGORIES_BUTTON = '整理分類';
export const ADD_CATEGORY_BUTTON = '新增分類';
export const CATEGORY_BUILTIN_BADGE = '內建';
export const CATEGORY_BUILTIN_ARIA = '內建分類，不能刪除';
export const CATEGORY_MOVE_UP = '上移';
export const CATEGORY_MOVE_DOWN = '下移';
export const CATEGORY_RENAME = '改名';
export const CATEGORY_DELETE = '刪除';
export const CATEGORY_NAME_LABEL = '分類名稱';
export const CATEGORY_NAME_PLACEHOLDER = '輸入分類名稱';
export const CATEGORY_EMPTY_NAME_ERROR = '名稱不能是空白';
export const CATEGORY_HAS_CARDS_WARNING = '分類內還有卡片，要先把卡片移走或刪掉才能刪除';
export const CATEGORY_MANAGER_HINT =
  '內建 4 類不能刪；自訂分類按 ✎ 可以改名，沒有卡片時才能刪。電腦版的「AI 對話紀錄」不在這裡顯示，存回電腦時原樣保留。';

/**
 * 依據版面與指標判定裝置稱呼：這台電腦／這台平板／這支手機。
 */
export function getDeviceName(
  layoutMode: LayoutMode = 'phone-portrait',
  pointer: PointerMode = 'touch',
): string {
  if (layoutMode === 'wide') {
    return pointer === 'touch' ? '這台平板' : '這台電腦';
  }
  if (layoutMode === 'medium') {
    return '這台平板';
  }
  return '這支手機';
}

/** 刪除確認標題 */
export function deleteCardQuestion(title: string): string {
  const displayTitle = title.trim() || '未命名卡片';
  return `刪除「${displayTitle}」？`;
}

/** 刪除確認子卡片連同刪除警語 */
export function deleteSubcardsImpact(count: number | string): string {
  return `連同底下 ${count} 張子卡片一起刪除。`;
}

/** 刪除確認視窗提示句 */
export function deleteCardConfirmHint(_device: string = '這支手機'): string {
  return `刪除後 10 秒內可以按「復原」；之後也能到資料集最下方的「最近刪除」放回原位置。`;
}

/** 刪除後提示（支援子卡片與倒數） */
export function deletedCardToastTitle(title: string, subcardCount = 0): string {
  const displayTitle = title.trim() || '未命名卡片';
  if (subcardCount > 0) {
    return `已刪除「${displayTitle}」和 ${subcardCount} 張子卡片`;
  }
  return `已刪除「${displayTitle}」`;
}

/** 倒數秒數提示 */
export function undoCountdownText(remainingSeconds: number): string {
  return `10 秒內可以復原，剩 ${remainingSeconds} 秒`;
}

/**
 * 最近刪除頁頂部說明句：
 * 「最近刪除的 10 項會留在這支手機，可從分類清單最下方的「最近刪除」放回來」
 * 裝置稱呼沿用 userFacing.ts 既有函式做法（這台電腦／這台平板／這支手機）。
 */
export function deletedCardsListHint(deviceOrComputer: string | boolean = '這支手機'): string {
  let device = '這支手機';
  if (typeof deviceOrComputer === 'boolean') {
    device = deviceOrComputer ? '這台電腦' : '這支手機';
  } else if (typeof deviceOrComputer === 'string' && deviceOrComputer.trim().length > 0) {
    device = deviceOrComputer.trim();
  }
  return `最近刪除的 10 項會留在${device}，可從分類清單最下方的「最近刪除」放回來`;
}

/** 放回原位置後提示 */
export function restoredCardToast(title: string, categoryName: string): string {
  const displayTitle = title.trim() || '未命名卡片';
  return `已放回「${displayTitle}」到「${categoryName}」`;
}

/** 卡片儲存完成提示 */
export function savedCardToast(title?: string | null): string {
  const trimmed = title?.trim();
  const displayTitle = trimmed && trimmed.length > 0 ? trimmed : '未命名卡片';
  return `已存好「${displayTitle}」`;
}
