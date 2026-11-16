import { describe, expect, it } from 'vitest';
import {
  formatImportExportValue,
  formatLogExportLabel,
  formatLogImportLabel,
  getDayImportExportStats,
  getTotalImportExportStats,
  IMPORT_EXPORT_UNAVAILABLE_DISPLAY,
  isFullTextExportAvailable,
  isImportExportAvailable,
  isTextImportAvailable,
} from './importExportStats';
import { applyLargeEvent, classifyTextDelta, emptyWritingLog } from './writingLog';

describe('WO-60 匯入匯出統計預留端口與格式化', () => {
  it('WO-60／WO-99／WO-103：匯入、匯出都開放，共用開關為 true；仍各自判斷，未開放時顯示破折號', () => {
    expect(isImportExportAvailable()).toBe(true);
    expect(isTextImportAvailable()).toBe(true);
    expect(isFullTextExportAvailable()).toBe(true);
    expect(IMPORT_EXPORT_UNAVAILABLE_DISPLAY).toBe('—');
    expect(formatImportExportValue(null)).toBe('—');
    expect(formatImportExportValue(10, false)).toBe('—');
    expect(formatImportExportValue(undefined as unknown as number)).toBe('—');
  });

  it('WO-60／WO-99／WO-103：單日紀錄卡匯入、匯出都顯示實際次數（沒有紀錄是 0，全形空白分隔）', () => {
    const none = getDayImportExportStats();
    expect(none.available).toBe(true);
    expect(none.importAvailable).toBe(true);
    expect(none.exportAvailable).toBe(true);
    expect(none.importCount).toBe(0);
    expect(none.importLabel).toBe('匯入\u30000 次');
    expect(none.exportCount).toBe(0);
    expect(none.exportDisplay).toBe('0');
    expect(none.exportLabel).toBe('匯出\u30000 次');
    // 包含全形空白，且不再是破折號
    expect(none.exportLabel).toContain('匯出\u3000');
    expect(none.exportLabel).not.toContain('—');

    const one = getDayImportExportStats(1);
    expect(one.importCount).toBe(1);
    expect(one.importDisplay).toBe('1');
    expect(one.importLabel).toBe('匯入\u30001 次');
    expect(one.exportLabel).toBe('匯出\u30000 次');

    // 匯出用真實次數，與匯入互不影響
    const both = getDayImportExportStats(1, {}, 2);
    expect(both.importLabel).toBe('匯入\u30001 次');
    expect(both.exportCount).toBe(2);
    expect(both.exportLabel).toBe('匯出\u30002 次');
  });

  it('WO-60／WO-99／WO-103：全書合計匯入、匯出都是實際次數（沒有紀錄是 0）', () => {
    const totalStats = getTotalImportExportStats(2);
    expect(totalStats.available).toBe(true);
    expect(totalStats.importCount).toBe(2);
    expect(totalStats.importDisplay).toBe('2');
    expect(totalStats.exportCount).toBe(0);
    expect(totalStats.exportDisplay).toBe('0');
    // 沒有匯入、匯出過的稿子是 0，不是破折號。
    expect(getTotalImportExportStats().importDisplay).toBe('0');
    expect(getTotalImportExportStats().exportDisplay).toBe('0');
    const withExports = getTotalImportExportStats(2, {}, 5);
    expect(withExports).toMatchObject({ importCount: 2, exportCount: 5, exportDisplay: '5' });
    // 負數或非數字不當真（不捏造次數）
    expect(getTotalImportExportStats(0, {}, -3).exportCount).toBe(0);
    expect(getTotalImportExportStats(0, {}, Number.NaN).exportDisplay).toBe('—');
  });

  it('WO-60：匯入與匯出都未開放時（預留狀態）仍回傳破折號', () => {
    const closed = { importAvailable: false, exportAvailable: false };
    const dayStats = getDayImportExportStats(5, closed);
    expect(dayStats.available).toBe(false);
    expect(dayStats.importCount).toBeNull();
    expect(dayStats.exportCount).toBeNull();
    expect(dayStats.importLabel).toBe('匯入\u3000— 次');
    expect(dayStats.exportLabel).toBe('匯出\u3000— 次');
    const totalStats = getTotalImportExportStats(5, closed);
    expect(totalStats.importDisplay).toBe('—');
    expect(totalStats.exportDisplay).toBe('—');
  });

  it('WO-60：開放狀態模擬（日後若開放時的格式化行為）', () => {
    expect(formatImportExportValue(0, true)).toBe('0');
    expect(formatImportExportValue(1234, true)).toBe('1,234');
    expect(formatLogImportLabel(12, true)).toBe('匯入\u300012 次');
    expect(formatLogExportLabel(5, true)).toBe('匯出\u30005 次');

    const open = { importAvailable: true, exportAvailable: true };
    const dayStats = getDayImportExportStats(null, open);
    expect(dayStats.available).toBe(true);
    expect(dayStats.importCount).toBe(0);
    expect(dayStats.exportCount).toBe(0);
    expect(dayStats.importDisplay).toBe('0');
    expect(dayStats.exportDisplay).toBe('0');
    expect(dayStats.importLabel).toBe('匯入\u30000 次');
    expect(dayStats.exportLabel).toBe('匯出\u30000 次');

    const totalStats = getTotalImportExportStats(null, open);
    expect(totalStats.available).toBe(true);
    expect(totalStats.importCount).toBe(0);
    expect(totalStats.exportCount).toBe(0);
    expect(totalStats.importDisplay).toBe('0');
    expect(totalStats.exportDisplay).toBe('0');
  });

  it('WO-60：writingLog 的 paste_large_count 累計測試照舊通過（證明資料照留）', () => {
    let row = emptyWritingLog(1, '2026-11-12');
    expect(row.paste_large_count).toBe(0);

    // 模擬大量文字貼入（超過門檻 50 字）
    const pasteDelta = classifyTextDelta('', '示'.repeat(60), { source: 'paste' });
    expect(pasteDelta.largeInsert).toBe(true);

    row = applyLargeEvent(row, pasteDelta);
    expect(row.paste_large_count).toBe(1);

    // 模擬一般打字輸入（不應增加 paste_large_count）
    const normalTypeDelta = classifyTextDelta('示'.repeat(60), '示'.repeat(65), { source: 'type' });
    row = applyLargeEvent(row, normalTypeDelta);
    expect(row.paste_large_count).toBe(1);

    // 再次大量貼入
    row = applyLargeEvent(row, pasteDelta);
    expect(row.paste_large_count).toBe(2);

    // 驗證欄位名稱與預設結構維持完整
    expect(row).toMatchObject({
      id: 1,
      date: '2026-11-12',
      paste_large_count: 2,
      delete_large_count: 0,
      ai_continuation_count: 0,
      ai_continuation_chars: 0,
      ai_chat_count: 0,
      ai_details: null,
    });
  });
});
