import { describe, expect, it } from 'vitest';
import { formatLastExportLabel, formatClockTime, latestSaveTimestamp } from './saveClock';

describe('存檔時間顯示', () => {
  it('今天另存會寫「今天 HH:MM」', () => {
    const now = new Date('2026-03-15T14:00:00');
    const stamp = new Date('2026-03-15T09:05:00').getTime();
    expect(formatLastExportLabel(stamp, now)).toBe('今天 09:05');
  });

  it('從沒另存過', () => {
    expect(formatLastExportLabel(null)).toBe('還沒另存過');
  });

  it('最後存檔取自動與手動較晚者', () => {
    expect(
      latestSaveTimestamp({ lastAutoSaveMs: 100, lastManualSaveMs: 200 }),
    ).toBe(200);
  });

  it('時間補零', () => {
    expect(formatClockTime(new Date('2026-01-01T08:03:00'))).toBe('08:03');
  });
});
