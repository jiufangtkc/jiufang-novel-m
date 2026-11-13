import { formatInteger } from './formatNumber';
import type { WritingLogRow } from './writingLog';

/**
 * WO-60 匯入／匯出預留端口與型別定義。
 * 目前功能尚未開放，因此 available 預設為 false，次數為 null，顯示為「—」。
 * 未來開放外部匯入文字檔與匯出全文功能時，只需在此更新邏輯與型別支援，無須變更 .db 結構。
 */

export const IMPORT_EXPORT_UNAVAILABLE_DISPLAY = '—';

export interface ImportExportMetric {
  readonly available: boolean;
  readonly count: number | null;
  readonly display: string;
}

export interface DayImportExportStats {
  readonly available: boolean;
  readonly importCount: number | null;
  readonly exportCount: number | null;
  readonly importDisplay: string;
  readonly exportDisplay: string;
  readonly importLabel: string;
  readonly exportLabel: string;
}

export interface TotalImportExportStats {
  readonly available: boolean;
  readonly importCount: number | null;
  readonly exportCount: number | null;
  readonly importDisplay: string;
  readonly exportDisplay: string;
}

/**
 * 查詢目前匯入／匯出功能是否已開放。
 * 目前功能尚未開放，一律回傳 false。
 */
export function isImportExportAvailable(): boolean {
  return false;
}

/**
 * 格式化匯入／匯出顯示數字。
 * 未開放或數值為 null 時顯示為「—」；開放後格式化為千分位字串。
 */
export function formatImportExportValue(
  count: number | null = null,
  available: boolean = isImportExportAvailable(),
): string {
  if (!available || count === null || !Number.isFinite(count)) {
    return IMPORT_EXPORT_UNAVAILABLE_DISPLAY;
  }
  return formatInteger(count);
}

/**
 * 格式化寫作紀錄卡中的匯入列文字。
 * 標籤與數字中間使用全形空白（U+3000），例如「匯入　— 次」或「匯入　12 次」。
 */
export function formatLogImportLabel(
  count: number | null = null,
  available: boolean = isImportExportAvailable(),
): string {
  const valueDisplay = formatImportExportValue(count, available);
  return `匯入\u3000${valueDisplay} 次`;
}

/**
 * 格式化寫作紀錄卡中的匯出列文字。
 * 標籤與數字中間使用全形空白（U+3000），例如「匯出　— 次」或「匯出　5 次」。
 */
export function formatLogExportLabel(
  count: number | null = null,
  available: boolean = isImportExportAvailable(),
): string {
  const valueDisplay = formatImportExportValue(count, available);
  return `匯出\u3000${valueDisplay} 次`;
}

/**
 * 取得單日寫作紀錄卡所需之匯入匯出統計狀態。
 */
export function getDayImportExportStats(
  _row?: WritingLogRow | null,
  available: boolean = isImportExportAvailable(),
): DayImportExportStats {
  if (!available) {
    return {
      available: false,
      importCount: null,
      exportCount: null,
      importDisplay: IMPORT_EXPORT_UNAVAILABLE_DISPLAY,
      exportDisplay: IMPORT_EXPORT_UNAVAILABLE_DISPLAY,
      importLabel: formatLogImportLabel(null, false),
      exportLabel: formatLogExportLabel(null, false),
    };
  }

  // 預留日後功能開放之邏輯
  return {
    available: true,
    importCount: 0,
    exportCount: 0,
    importDisplay: formatInteger(0),
    exportDisplay: formatInteger(0),
    importLabel: formatLogImportLabel(0, true),
    exportLabel: formatLogExportLabel(0, true),
  };
}

/**
 * 取得統計頁（全書合計）所需之匯入匯出統計狀態。
 */
export function getTotalImportExportStats(
  _logs?: readonly WritingLogRow[] | null,
  available: boolean = isImportExportAvailable(),
): TotalImportExportStats {
  if (!available) {
    return {
      available: false,
      importCount: null,
      exportCount: null,
      importDisplay: IMPORT_EXPORT_UNAVAILABLE_DISPLAY,
      exportDisplay: IMPORT_EXPORT_UNAVAILABLE_DISPLAY,
    };
  }

  // 預留日後功能開放之累計邏輯
  return {
    available: true,
    importCount: 0,
    exportCount: 0,
    importDisplay: formatInteger(0),
    exportDisplay: formatInteger(0),
  };
}
