import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('HomeScreen', () => {
  it('不顯示重新整理按鈕與清單提示', () => {
    const source = readFileSync(new URL('./HomeScreen.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('重新整理');
    expect(source).not.toContain('清單已是這個畫面上的專案');
    expect(source).toContain('九方小說編輯器M');
  });
});
