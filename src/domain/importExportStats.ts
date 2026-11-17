import { formatInteger } from './formatNumber';

/**
 * WO-60 匯入／匯出預留端口與型別定義。
 * WO-99：「匯入文字檔」已開放，匯入次數取自每份稿子的本機匯入事件（見 state/importEvents.ts）；
 * （WO-99 當時「匯出全文」仍在準備中。）兩者的可用狀態分開判斷，不共用一個開關。
 * WO-100：匯入次數改以稿子 .db 內的附加表為準（見 db/transferMeta.ts），與本機紀錄以事件代號取聯集。
 * WO-103：「匯出全文」（Word／TXT）開放。匯出次數＝成功交付的匯出事件數（檔內 export 事件 ∪ 本機可靠對應，
 * 以事件代號去重）；沒有紀錄是 0，不再是「—」。另存 .db、另存時間或指紋都不算匯出全文。
 */

export const IMPORT_EXPORT_UNAVAILABLE_DISPLAY = '—';

export interface ImportExportMetric {
  readonly available: boolean;
  readonly count: number | null;
  readonly display: string;
}

export interface DayImportExportStats {
  /** 匯入與匯出都開放才是 true。WO-103 起兩者都開放。 */
  readonly available: boolean;
  readonly importAvailable: boolean;
  readonly exportAvailable: boolean;
  readonly importCount: number | null;
  readonly exportCount: number | null;
  readonly importDisplay: string;
  readonly exportDisplay: string;
  readonly importLabel: string;
  readonly exportLabel: string;
}

export interface TotalImportExportStats {
  readonly available: boolean;
  readonly importAvailable: boolean;
  readonly exportAvailable: boolean;
  readonly importCount: number | null;
  readonly exportCount: number | null;
  readonly importDisplay: string;
  readonly exportDisplay: string;
}

/** WO-99：匯入文字檔已開放。 */
export function isTextImportAvailable(): boolean {
  return true;
}

/** WO-103：匯出全文（Word／TXT）已開放。 */
export function isFullTextExportAvailable(): boolean {
  return true;
}

/**
 * 匯入與匯出是否「都」已開放。WO-103 起為 true；
 * 不能拿這個共用開關決定單一項目，請改用 isTextImportAvailable／isFullTextExportAvailable。
 */
export function isImportExportAvailable(): boolean {
  return isTextImportAvailable() && isFullTextExportAvailable();
}

export interface ImportExportAvailability {
  importAvailable?: boolean;
  exportAvailable?: boolean;
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

function metric(count: number | null | undefined, available: boolean): { count: number | null; display: string } {
  const value = available && typeof count === 'number' && Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : null;
  return { count: value, display: formatImportExportValue(value, available) };
}

/**
 * 取得單日寫作紀錄卡所需之匯入匯出統計狀態。
 * importCount／exportCount 是這份稿子這一個寫作日的匯入／匯出全文次數；沒有紀錄是 0。
 */
export function getDayImportExportStats(
  importCount: number | null = null,
  availability: ImportExportAvailability = {},
  exportCount: number | null = null,
): DayImportExportStats {
  const importAvailable = availability.importAvailable ?? isTextImportAvailable();
  const exportAvailable = availability.exportAvailable ?? isFullTextExportAvailable();
  const imported = metric(importAvailable ? (importCount ?? 0) : null, importAvailable);
  // WO-103：匯出用真實事件數；開放時沒有紀錄就是 0。
  const exported = metric(exportAvailable ? (exportCount ?? 0) : null, exportAvailable);
  return {
    available: importAvailable && exportAvailable,
    importAvailable,
    exportAvailable,
    importCount: imported.count,
    exportCount: exported.count,
    importDisplay: imported.display,
    exportDisplay: exported.display,
    importLabel: formatLogImportLabel(imported.count, importAvailable),
    exportLabel: formatLogExportLabel(exported.count, exportAvailable),
  };
}

/**
 * 取得統計頁（這份稿子的全書合計）所需之匯入匯出統計狀態。
 * importCount／exportCount 是這份稿子所有成功匯入／成功匯出全文的次數。
 */
export function getTotalImportExportStats(
  importCount: number | null = null,
  availability: ImportExportAvailability = {},
  exportCount: number | null = null,
): TotalImportExportStats {
  const importAvailable = availability.importAvailable ?? isTextImportAvailable();
  const exportAvailable = availability.exportAvailable ?? isFullTextExportAvailable();
  const imported = metric(importAvailable ? (importCount ?? 0) : null, importAvailable);
  const exported = metric(exportAvailable ? (exportCount ?? 0) : null, exportAvailable);
  return {
    available: importAvailable && exportAvailable,
    importAvailable,
    exportAvailable,
    importCount: imported.count,
    exportCount: exported.count,
    importDisplay: imported.display,
    exportDisplay: exported.display,
  };
}
