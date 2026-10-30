import { describe, expect, it } from 'vitest';
import { exportDbFilename, projectSaveFilename, sanitizeDbBasename } from './exportFilename';

describe('另存檔名', () => {
  it('不能用的字改成全形，並加上時間戳', () => {
    const when = new Date('2026-03-15T09:05:00');
    expect(exportDbFilename('【範例】霧/港*紀事', when)).toBe('【範例】霧／港＊紀事_20260315-0905.db');
  });

  it('書名全是控制字元時改用未命名稿子', () => {
    expect(sanitizeDbBasename('\u0000')).toBe('未命名稿子');
  });

  it('空書名用未命名稿子.db，原檔名不加時間戳', () => {
    expect(projectSaveFilename('   ')).toBe('未命名稿子.db');
    expect(projectSaveFilename('霧港', '原稿.db')).toBe('原稿.db');
  });
});
