import { describe, expect, it } from 'vitest';
import { editorSaveStatus } from './editorSaveStatus';

const now = new Date(2026, 9, 29, 14, 46, 0);

describe('正文存檔狀態', () => {
  it('沒有儲存專案且今天還沒另存時，顯示今天還沒另存', () => {
    expect(
      editorSaveStatus({
        directWriteback: false,
        lastSaveMs: now.getTime() - 60_000,
        lastExportMs: null,
        now,
      }),
    ).toEqual({ label: '今天還沒另存', openFiles: true });
  });

  it('今天已經另存過，改顯示暫存時間', () => {
    const saved = new Date(2026, 9, 29, 14, 46, 0).getTime();
    expect(
      editorSaveStatus({
        directWriteback: false,
        lastSaveMs: saved,
        lastExportMs: saved,
        now,
      }),
    ).toEqual({ label: '已暫存 14:46', openFiles: false });
  });

  it('可以寫回原檔時顯示暫存時間', () => {
    const saved = new Date(2026, 9, 29, 9, 5, 0).getTime();
    expect(
      editorSaveStatus({
        directWriteback: true,
        lastSaveMs: saved,
        lastExportMs: null,
        now,
      }).label,
    ).toBe('已暫存 09:05');
  });
});
