import { describe, expect, it } from 'vitest';
import {
  OPEN_DB_FAIL,
  SAVE_FATAL_FAIL,
  SAVE_PARTIAL_FAIL,
  SAVE_PERMISSION_DENIED,
  TREE_KIND_CHAPTER,
  TREE_KIND_SCENE,
  TREE_KIND_VOLUME,
  treeMoreSummary,
} from './userFacing';

describe('九方審過的文案', () => {
  it('開檔失敗的句子一字不差', () => {
    expect(OPEN_DB_FAIL).toBe('這個檔案打不開。請選擇使用九方編輯器編寫的 .db 稿件檔。');
    expect(SAVE_PERMISSION_DENIED).toBe('沒有寫入權限，請再按一次並選「允許」。');
    expect(SAVE_FATAL_FAIL).toBe('存檔失敗。稿件目前仍在 APP 暫存空間。');
    expect(SAVE_PARTIAL_FAIL).toBe(SAVE_FATAL_FAIL);
  });
});

describe('章節目錄草案文案', () => {
  it('刪除確認與復原用臺灣用詞', async () => {
    const copy = await import('./userFacing');
    expect(copy.treeDeleteQuestion('第三章　地下道')).toBe('刪除「第三章　地下道」？');
    expect(copy.treeDeleteImpact(0, 2, '3,280')).toBe('裡面有 2 幕、共 3,280 字，會一起刪除。');
    expect(copy.TREE_KEEP).toBe('留著');
    expect(copy.TREE_ORGANIZE).toBe('整理目錄');
  });

  it('舊版、單篇與上下章的句子先照草案', async () => {
    const copy = await import('./userFacing');
    expect(copy.ARCHIVE_KEEP_FAIL).toBe('這次沒留下舊版，正文沒受影響。');
    expect(copy.ARCHIVE_RESTORE_HELD).toBe('現在的內容沒留成舊版，先不換。');
    expect(copy.ARCHIVE_DELETE_UNSAVED).toBe('這次刪掉的內容找不回來，10 秒內可按「復原」。');
    expect(copy.archiveWriteFailureMessage('version')).toBe(copy.ARCHIVE_KEEP_FAIL);
    expect(copy.archiveWriteFailureMessage('restore')).toBe(copy.ARCHIVE_RESTORE_HELD);
    expect(copy.archiveWriteFailureMessage('delete')).toBe(copy.ARCHIVE_DELETE_UNSAVED);
    expect(copy.contentAfterVersionRestore(false, '現在的字', '舊版的字')).toBe('現在的字');
    expect(copy.contentAfterVersionRestore(true, '現在的字', '舊版的字')).toBe('舊版的字');
    expect(copy.deleteConfirmShowsRecoverable(true)).toBe(true);
    expect(copy.deleteConfirmShowsRecoverable(false)).toBe(false);
    expect(copy.TREE_FIND_VERSION).toBe('找回之前的版本');
    expect(copy.TREE_FIND_DELETED).toBe('找回刪掉的章');
    expect(copy.TREE_DELETE_RECOVERABLE).toBe('之後仍可從目錄最下方的「找回刪掉的章」放回來。');
    expect(copy.TREE_PREV_CHAPTER).toBe('上一章');
    expect(copy.TREE_NEXT_CHAPTER).toBe('下一章');
    expect(copy.NEW_BOOK_NOVEL).toBe('長篇（卷章幕）');
    expect(copy.NEW_BOOK_SINGLE).toBe('單篇（短篇、散文）');
    expect(copy.TREE_RESTORE_VERSION).toBe('用這一版');
    expect(copy.TREE_PUT_BACK).toBe('放回原位置');
    expect(copy.TREE_PUT_END).toBe('放到最後面');
    expect(copy.versionRowLabel('10月29日（四） 19:57', '120')).toBe('10月29日（四） 19:57 · 120 字');
  });

  it('更多摘要：幕不寫幕數，卷要寫章數', () => {
    expect(treeMoreSummary(TREE_KIND_SCENE, 0, 0, '12')).toBe('幕 · 共 12 字');
    expect(treeMoreSummary(TREE_KIND_CHAPTER, 0, 2, '3,280')).toBe('章 · 2 幕 · 共 3,280 字');
    expect(treeMoreSummary(TREE_KIND_VOLUME, 3, 2, '3,280')).toBe('卷 · 3 章 · 2 幕 · 共 3,280 字');
  });
});
