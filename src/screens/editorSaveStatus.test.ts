import { describe, expect, it } from 'vitest';
import {
  AUTOSAVE_FAILED_BADGE,
  AUTOSAVE_RESUME_BADGE,
  AUTOSAVE_UNSAVED_BADGE,
  SAVE_CONFLICT_BADGE,
  STASH_FAILED_BADGE,
} from '../copy/userFacing';
import { editorSaveStatus, unifiedFocusSaveLabel } from './editorSaveStatus';

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

  it('WO-132 嚴-7：專注模式與橫拿打字底列統一使用頁首單一存檔狀態說法，範例書顯示本機暫存狀態', () => {
    const saved = new Date(2026, 9, 29, 14, 46, 0).getTime();
    expect(
      unifiedFocusSaveLabel({
        headerKind: 'unsaved',
        isSample: false,
        staleDays: null,
        lastFileSaveMs: null,
        autoSaveActive: false,
        lastSaveWasAuto: false,
        lastLocalSaveMs: saved,
        now,
      }),
    ).toBe(AUTOSAVE_UNSAVED_BADGE);

    expect(
      unifiedFocusSaveLabel({
        headerKind: 'time',
        isSample: false,
        staleDays: null,
        lastFileSaveMs: saved,
        autoSaveActive: true,
        lastSaveWasAuto: true,
        lastLocalSaveMs: saved,
        now,
      }),
    ).toBe('已自動存檔 14:46');

    expect(
      unifiedFocusSaveLabel({
        headerKind: 'time',
        isSample: false,
        staleDays: null,
        lastFileSaveMs: saved,
        autoSaveActive: false,
        lastSaveWasAuto: false,
        lastLocalSaveMs: saved,
        now,
      }),
    ).toBe('上次存檔 14:46');

    expect(
      unifiedFocusSaveLabel({
        headerKind: 'conflict',
        isSample: false,
        staleDays: null,
        lastFileSaveMs: saved,
        autoSaveActive: false,
        lastSaveWasAuto: false,
        lastLocalSaveMs: saved,
        now,
      }),
    ).toBe(SAVE_CONFLICT_BADGE);

    expect(
      unifiedFocusSaveLabel({
        headerKind: 'stash-failed',
        isSample: false,
        staleDays: null,
        lastFileSaveMs: saved,
        autoSaveActive: false,
        lastSaveWasAuto: false,
        lastLocalSaveMs: saved,
        now,
      }),
    ).toBe(STASH_FAILED_BADGE);

    expect(
      unifiedFocusSaveLabel({
        headerKind: 'needs-permission',
        isSample: false,
        staleDays: null,
        lastFileSaveMs: saved,
        autoSaveActive: false,
        lastSaveWasAuto: false,
        lastLocalSaveMs: saved,
        now,
      }),
    ).toBe(AUTOSAVE_RESUME_BADGE);

    expect(
      unifiedFocusSaveLabel({
        headerKind: 'failed',
        isSample: false,
        staleDays: null,
        lastFileSaveMs: saved,
        autoSaveActive: false,
        lastSaveWasAuto: false,
        lastLocalSaveMs: saved,
        now,
      }),
    ).toBe(AUTOSAVE_FAILED_BADGE);

    expect(
      unifiedFocusSaveLabel({
        headerKind: 'none',
        isSample: true,
        staleDays: null,
        lastFileSaveMs: null,
        autoSaveActive: false,
        lastSaveWasAuto: false,
        lastLocalSaveMs: saved,
        now,
      }),
    ).toBe('已暫存 14:46');

    expect(
      unifiedFocusSaveLabel({
        headerKind: 'none',
        isSample: true,
        staleDays: null,
        lastFileSaveMs: null,
        autoSaveActive: false,
        lastSaveWasAuto: false,
        lastLocalSaveMs: null,
        now,
      }),
    ).toBe('尚未暫存');
  });
});
