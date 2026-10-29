import { describe, expect, it } from 'vitest';
import { exportDbFilename, projectSaveFilename, sanitizeDbBasename } from './exportFilename';

describe('另存檔名', () => {
  it('去掉不合法字元並加上時間戳', () => {
    const when = new Date('2026-03-15T09:05:00');
    expect(exportDbFilename('【示範】霧/港*紀事', when)).toBe('【示範】霧港紀事_20260315-0905.db');
  });

  it('書名全是不合法字元時改用未命名', () => {
    expect(sanitizeDbBasename('\\\\')).toBe('未命名');
  });

  it('空書名用未命名.db，原檔名不加時間戳', () => {
    expect(projectSaveFilename('   ')).toBe('未命名.db');
    expect(projectSaveFilename('霧港', '原稿.db')).toBe('原稿.db');
  });
});
