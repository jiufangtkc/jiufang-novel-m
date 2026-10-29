import { describe, expect, it } from 'vitest';
import { formatInteger } from './formatNumber';

describe('數字顯示', () => {
  it('四位數以上加千分位', () => {
    expect(formatInteger(999)).toBe('999');
    expect(formatInteger(1000)).toBe('1,000');
    expect(formatInteger(100000)).toBe('100,000');
  });
});
