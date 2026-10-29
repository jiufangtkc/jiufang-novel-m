import { describe, expect, it } from 'vitest';
import {
  formatCalendarDate,
  formatCalendarDateFromDate,
  formatProjectUpdatedLabel,
} from './formatCalendarDate';

describe('作家看的日期格式', () => {
  const now = new Date(2026, 9, 29); // 2026-10-29 本地

  it('同年不寫年份，星期要對', () => {
    expect(formatCalendarDate('2026-07-02', now)).toBe('7月2日（四）');
    expect(formatCalendarDate('2026-10-29', now)).toBe('10月29日（四）');
  });

  it('跨年才加年份', () => {
    expect(formatCalendarDate('2025-12-30', now)).toBe('2025年12月30日（二）');
  });

  it('首頁標籤只轉 ISO 日', () => {
    expect(formatProjectUpdatedLabel('2026-07-02', now)).toBe('7月2日（四）');
    expect(formatProjectUpdatedLabel('12 分鐘前', now)).toBe('12 分鐘前');
  });

  it('由 Date 格式化', () => {
    expect(formatCalendarDateFromDate(new Date(2026, 6, 2), now)).toBe('7月2日（四）');
  });
});
