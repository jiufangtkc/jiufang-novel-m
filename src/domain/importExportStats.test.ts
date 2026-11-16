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
  it('WO-60／WO-99：共用開關仍為 false（匯出未開放）；匯入、匯出各自判斷，未開放顯示破折號', () => {
    expect(isImportExportAvailable()).toBe(false);
    expect(isTextImportAvailable()).toBe(true);
    expect(isFullTextExportAvailable()).toBe(false);
    expect(IMPORT_EXPORT_UNAVAILABLE_DISPLAY).toBe('—');
    expect(formatImportExportValue(null)).toBe('—');
    expect(formatImportExportValue(10, false)).toBe('—');
    expect(formatImportExportValue(undefined as unknown as number)).toBe('—');
  });

  it('WO-60／WO-99：單日紀錄卡匯入顯示實際次數，匯出仍為全形空白加破折號', () => {
    const none = getDayImportExportStats();
    expect(none.available).toBe(false);
    expect(none.importAvailable).toBe(true);
    expect(none.exportAvailable).toBe(false);
    expect(none.importCount).toBe(0);
    expect(none.importLabel).toBe('匯入\u30000 次');
    expect(none.exportCount).toBeNull();
    expect(none.exportDisplay).toBe('—');
    expect(none.exportLabel).toBe('匯出\u3000— 次');
    // 包含全形空白
    expect(none.exportLabel).toContain('匯出\u3000—');

    const one = getDayImportExportStats(1);
    expect(one.importCount).toBe(1);
    expect(one.importDisplay).toBe('1');
    expect(one.importLabel).toBe('匯入\u30001 次');
    expect(one.exportLabel).toBe('匯出\u3000— 次');
  });

  it('WO-60／WO-99：全書合計匯入為實際次數、匯出仍為 null 與破折號', () => {
    const totalStats = getTotalImportExportStats(2);
    expect(totalStats.available).toBe(false);
    expect(totalStats.importCount).toBe(2);
    expect(totalStats.importDisplay).toBe('2');
    expect(totalStats.exportCount).toBeNull();
    expect(totalStats.exportDisplay).toBe('—');
    // 沒有匯入過的稿子是 0，不是破折號。
    expect(getTotalImportExportStats().importDisplay).toBe('0');
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
