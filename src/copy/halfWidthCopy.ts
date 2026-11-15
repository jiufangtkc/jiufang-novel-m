import { formatInteger } from '../domain/formatNumber';
import { halfWidthKindName, type HalfWidthKind } from '../domain/halfWidthPunct';

/**
 * WO-76 乙段用字。照工單用字實作，用字規範尚未收錄，交九方審閱（見交件《新用字清單》）。
 * 範圍一律「這一章」；不用「您」，不稱「錯誤」「錯字」；朗讀不用間隔號或斜線。
 */

export const HALF_WIDTH_CONVERT = '改成全形';
export const HALF_WIDTH_SKIP = '先不用';
export const HALF_WIDTH_UNDO = '復原';
export const HALF_WIDTH_SETTING_TITLE = '提醒半形標點';

/** 甲案：這一章有 N 個半形標點 */
export function halfWidthNoticeLong(count: number): string {
  return `這一章有 ${formatInteger(count)} 個半形標點`;
}

export function halfWidthNoticeLongAria(count: number): string {
  return `這一章有 ${formatInteger(count)} 個半形標點，點兩下可以一次改成全形`;
}

/** 乙案：半形標點　N 處（標籤與數值間為全形空格） */
export function halfWidthNoticeShort(count: number): string {
  return `半形標點　${formatInteger(count)} 處`;
}

export function halfWidthNoticeShortAria(count: number): string {
  return `半形標點 ${formatInteger(count)} 處，點兩下可以一次改成全形`;
}

/** 乙案（中等與寬版）：點一下是展開甲案小卡，朗讀不說改成全形 */
export function halfWidthNoticeShortExpandAria(count: number): string {
  return `半形標點 ${formatInteger(count)} 處，點兩下展開選項`;
}

/** 轉換結果：已改成全形，共 N 個 */
export function halfWidthDone(count: number): string {
  return `已改成全形，共 ${formatInteger(count)} 個`;
}

export function halfWidthDoneAria(count: number): string {
  return `已改成全形，共 ${formatInteger(count)} 個，點兩下復原`;
}

/** 標點旁小泡泡朗讀：半形逗號，點兩下改成全形逗號 */
export function halfWidthBubbleAria(kind: HalfWidthKind): string {
  const name = halfWidthKindName(kind);
  return `半形${name}，點兩下改成全形${name}`;
}

export function halfWidthSettingAria(on: boolean): string {
  return on
    ? `${HALF_WIDTH_SETTING_TITLE}，已開啟，點兩下關閉`
    : `${HALF_WIDTH_SETTING_TITLE}，已關閉，點兩下開啟`;
}
