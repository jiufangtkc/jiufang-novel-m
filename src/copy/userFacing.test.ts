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

  it('更多摘要：幕不寫幕數，卷要寫章數', () => {
    expect(treeMoreSummary(TREE_KIND_SCENE, 0, 0, '12')).toBe('幕 · 共 12 字');
    expect(treeMoreSummary(TREE_KIND_CHAPTER, 0, 2, '3,280')).toBe('章 · 2 幕 · 共 3,280 字');
    expect(treeMoreSummary(TREE_KIND_VOLUME, 3, 2, '3,280')).toBe('卷 · 3 章 · 2 幕 · 共 3,280 字');
  });
});
