import { describe, expect, it } from 'vitest';
import { databaseSharePayload } from './library';

describe('分享資料庫檔', () => {
  it('分享參數只有 files，不帶 title、text、url', () => {
    const file = new File([new Uint8Array([1, 2, 3])], '【範例】測試書.db', {
      type: 'application/octet-stream',
    });
    const payload = databaseSharePayload(file);
    expect(Object.keys(payload).sort()).toEqual(['files']);
    expect(payload.files).toEqual([file]);
    expect('title' in payload).toBe(false);
    expect('text' in payload).toBe(false);
    expect('url' in payload).toBe(false);
  });
});
