import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_DELETE_UNSAVED,
  ARCHIVE_KEEP_FAIL,
  ARCHIVE_RESTORE_HELD,
  EDITOR_PLACEHOLDER,
  NEW_BOOK_DEFAULT_TITLE,
  OPEN_DB_FAIL,
  SAVE_FATAL_FAIL,
  SAVE_PARTIAL_FAIL,
  SAVE_PERMISSION_DENIED,
  TOAST_NEW_BOOK,
  TREE_FIND_DELETED,
  TREE_FIND_VERSION,
  TREE_KIND_CHAPTER,
  TREE_KIND_SCENE,
  TREE_KIND_VOLUME,
  TREE_NAME_NEW_CHAPTER,
  TREE_PROGRESS,
  TREE_SAVE_NAME,
  TREE_START_WRITING,
  deleteRecoverableHint,
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

describe('章節目錄文案', () => {
  it('刪除確認與復原用臺灣用詞', async () => {
    const copy = await import('./userFacing');
    expect(copy.treeDeleteQuestion('第三章　地下道')).toBe('刪除「第三章　地下道」？');
    expect(copy.treeDeleteImpact(0, 2, '3,280')).toBe('裡面有 2 幕、共 3,280 字，會一起刪除。');
    expect(copy.TREE_KEEP).toBe('留著');
    expect(copy.TREE_ORGANIZE).toBe('整理目錄');
    expect(TREE_SAVE_NAME).toBe('確定');
    expect(TREE_NAME_NEW_CHAPTER).toBe('幫新章取名');
    expect(TREE_START_WRITING).toBe('開始寫');
    expect(TREE_PROGRESS).toBe('進度標記');
    expect(copy.TREE_MOVE_ROOT).toBe('不放在任何卷');
    expect(copy.TREE_DELETE_CHAPTER).toBe('刪除');
  });

  it('舊版、單篇與上下章的句子', async () => {
    const copy = await import('./userFacing');
    expect(ARCHIVE_KEEP_FAIL).toBe('這次沒留下舊版，正文沒受影響');
    expect(ARCHIVE_RESTORE_HELD).toBe('現在的內容沒留成舊版，先不換');
    expect(ARCHIVE_DELETE_UNSAVED).toBe('這次刪掉的內容找不回來，10 秒內可按「復原」');
    expect(copy.archiveWriteFailureMessage('version')).toBe(copy.ARCHIVE_KEEP_FAIL);
    expect(copy.archiveWriteFailureMessage('restore')).toBe(copy.ARCHIVE_RESTORE_HELD);
    expect(copy.archiveWriteFailureMessage('delete')).toBe(copy.ARCHIVE_DELETE_UNSAVED);
    expect(copy.contentAfterVersionRestore(false, '現在的字', '舊版的字')).toBe('現在的字');
    expect(copy.contentAfterVersionRestore(true, '現在的字', '舊版的字')).toBe('舊版的字');
    expect(copy.deleteConfirmShowsRecoverable(true)).toBe(true);
    expect(copy.deleteConfirmShowsRecoverable(false)).toBe(false);
    expect(TREE_FIND_VERSION).toBe('找回舊版');
    expect(TREE_FIND_DELETED).toBe('最近刪除');
    expect(deleteRecoverableHint(false)).toBe(
      '最近刪除的 10 項會留在這支手機，可從目錄最下方的「最近刪除」放回來',
    );
    expect(deleteRecoverableHint(true)).toBe(
      '最近刪除的 10 項會留在這台電腦，可從目錄最下方的「最近刪除」放回來',
    );
    expect(copy.TREE_PREV_CHAPTER).toBe('上一章');
    expect(copy.TREE_NEXT_CHAPTER).toBe('下一章');
    expect(copy.NEW_BOOK_NOVEL).toBe('長篇（卷章幕）');
    expect(copy.NEW_BOOK_SINGLE).toBe('單篇（短篇、散文）');
    expect(NEW_BOOK_DEFAULT_TITLE).toBe('未命名稿子');
    expect(TOAST_NEW_BOOK).toBe('已開新稿子');
    expect(EDITOR_PLACEHOLDER).toBe('從這裡開始寫');
    expect(copy.TREE_RESTORE_VERSION).toBe('用這一版');
    expect(copy.TREE_PUT_BACK).toBe('放回原位置');
    expect(copy.TREE_PUT_END).toBe('放到最後面');
    expect(copy.versionRowLabel('10月29日（四） 19:57', '120')).toBe('10月29日（四） 19:57 · 120 字');
  });

  it('改書名的句子', async () => {
    const copy = await import('./userFacing');
    expect(copy.BOOK_RENAME_TITLE).toBe('改書名');
    expect(copy.BOOK_TITLE_BLANK_HINT).toBe('留白會用「未命名稿子」');
    expect(copy.BOOK_TITLE_LIMIT_HINT).toBe('最多 40 個字，多的字沒有貼上');
    expect(copy.bookTitleCount(38)).toBe('38／40');
    expect(copy.BOOK_SECTION).toBe('這份稿子');
    expect(copy.BOOK_TITLE_LABEL).toBe('書名');
    expect(copy.BOOK_GOAL_LABEL).toBe('目標');
    expect(copy.ASK_SAVE_AS_TITLE).toBe('要不要現在另存？');
    expect(copy.ASK_SAVE_LATER).toBe('等一下');
    expect(copy.ASK_SAVE_NOW).toBe('現在另存');
    expect(copy.askSaveAsBody('白狐')).toBe('書名改成《白狐》了。原本的檔案裡還是舊書名，另存一份新檔才會用新書名。');
    expect(copy.TITLE_PENDING_EXPORT).toBe('書名改過了，還沒另存。原本的檔案裡還是舊書名');
    expect(copy.TITLE_PENDING_RESAVE).toBe('書名改過了，下次按「儲存專案」會用新書名另存一份，舊檔留著');
    expect(copy.TOAST_SAVED_UNDER_NEW_TITLE).toBe('已用新書名另存一份');
    expect(copy.STATS_HEADING).toBe('寫作統計');
    expect(copy.DB_FILE_TYPE_LABEL).toBe('九方編輯器稿件檔');
    expect(copy.currentFileLine('白狐.db')).toBe('檔案：白狐.db');
    expect(copy.titlePendingNotice('export')).toBe(copy.TITLE_PENDING_EXPORT);
    expect(copy.titlePendingNotice(null)).toBeNull();
  });

  it('更多摘要：幕不寫幕數，卷要寫章數', () => {
    expect(treeMoreSummary(TREE_KIND_SCENE, 0, 0, '12')).toBe('幕 · 共 12 字');
    expect(treeMoreSummary(TREE_KIND_CHAPTER, 0, 2, '3,280')).toBe('章 · 2 幕 · 共 3,280 字');
    expect(treeMoreSummary(TREE_KIND_VOLUME, 3, 2, '3,280')).toBe('卷 · 3 章 · 2 幕 · 共 3,280 字');
  });
});
