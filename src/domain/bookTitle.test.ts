import { describe, expect, it } from 'vitest';
import { exportDbFilename, projectSaveFilename } from './exportFilename';
import {
  bookAfterRename,
  clipBookTitle,
  commitBookTitleEdit,
  commitInlineChapterTitle,
  countBookTitle,
  externalFileFromStored,
  filenameStem,
  resolvedBookTitle,
  sanitizeDbBasename,
  shouldSaveUnderNewName,
  titleMatchesFilename,
} from './bookTitle';

const FOX = '【範例】月台上的狐狸';
const WHITE = '【範例】月台上的白狐';

describe('書名長度與留白', () => {
  it('刪光或只打空白就叫未命名稿子', () => {
    expect(resolvedBookTitle('')).toBe('未命名稿子');
    expect(resolvedBookTitle('   ')).toBe('未命名稿子');
    expect(resolvedBookTitle('\u3000\u3000')).toBe('未命名稿子');
  });

  it('超過 40 字只留前面，表情符號算 1 字', () => {
    expect(countBookTitle('🦊')).toBe(1);
    const foxes = '🦊'.repeat(41);
    const clipped = clipBookTitle(foxes);
    expect(clipped.truncated).toBe(true);
    expect(countBookTitle(clipped.text)).toBe(40);
    expect(resolvedBookTitle(`${'狐'.repeat(45)}`)).toHaveLength(40);
  });
});

describe('點外面', () => {
  it('卡片點外面是取消，原地輸入框點外面是確定', () => {
    expect(commitBookTitleEdit({
      surface: 'card',
      via: 'outside',
      raw: WHITE,
      previous: FOX,
    })).toEqual({ action: 'cancel' });
    expect(commitBookTitleEdit({
      surface: 'inline',
      via: 'outside',
      raw: WHITE,
      previous: FOX,
    })).toEqual({ action: 'apply', title: WHITE });
  });

  it('電腦原地框清空後點外面還原，按確定才變成未命名稿子', () => {
    expect(commitBookTitleEdit({
      surface: 'inline',
      via: 'outside',
      raw: '  ',
      previous: FOX,
    })).toEqual({ action: 'cancel' });
    expect(commitBookTitleEdit({
      surface: 'inline',
      via: 'confirm',
      raw: '  ',
      previous: FOX,
    })).toEqual({ action: 'apply', title: '未命名稿子' });
  });

  it('章名點外面是確定，空白時還原舊章名', () => {
    expect(commitInlineChapterTitle('outside', '第三章　地下道')).toBe('apply');
    expect(commitInlineChapterTitle('outside', '  ')).toBe('cancel');
    expect(commitInlineChapterTitle('confirm', '  ')).toBe('blank');
    expect(commitInlineChapterTitle('cancel', '第三章')).toBe('cancel');
  });
});

describe('檔名', () => {
  const when = new Date('2026-10-30T11:40:00');

  it('斜線、冒號、全形空白、40 字與表情符號都不會讓檔名出錯', () => {
    const titles = [
      '月台／白狐',
      '月台：白狐',
      '月台/白狐',
      '月台:白狐',
      `月台${'\u3000'}白狐`,
      '狐'.repeat(40),
      '月台🦊白狐',
    ];
    for (const title of titles) {
      const base = sanitizeDbBasename(title);
      const saveName = `${base}.db`;
      const exportName = exportDbFilename(title, when);
      expect(saveName).not.toMatch(/[/\\:*?"<>|]/);
      expect(exportName).not.toMatch(/[/\\:*?"<>|]/);
      expect(saveName.endsWith('.db')).toBe(true);
      expect(exportName.endsWith('.db')).toBe(true);
      expect(base.length).toBeGreaterThan(0);
    }
    expect(sanitizeDbBasename('月台/白狐')).toBe('月台／白狐');
    expect(sanitizeDbBasename('月台:白狐')).toBe('月台：白狐');
    expect(sanitizeDbBasename(`月台${'\u3000'}白狐`)).toBe(`月台${'\u3000'}白狐`);
    expect(sanitizeDbBasename('月台🦊白狐')).toBe('月台🦊白狐');
    expect(projectSaveFilename('   ')).toBe('未命名稿子.db');
  });

  it('舊規則刪掉的字也認得，時間戳結尾要拿掉再比', () => {
    expect(filenameStem('【範例】月台上的狐狸_20261030-1140.db')).toBe('【範例】月台上的狐狸');
    expect(titleMatchesFilename('月台/白狐', '月台白狐.db')).toBe(true);
    expect(titleMatchesFilename('月台/白狐', '月台／白狐.db')).toBe(true);
    expect(titleMatchesFilename(WHITE, `${FOX}.db`)).toBe(false);
  });
});

describe('什麼時候另存新檔、什麼時候問', () => {
  const opened = {
    title: FOX,
    filename: `${FOX}.db`,
    hasExternalFile: true,
    titleInFile: FOX,
    titleSavePending: null,
  };

  it('改過書名而且跟檔名不同，電腦下次儲存才另存新檔', () => {
    expect(shouldSaveUnderNewName({
      hasExternalFile: true,
      titleInFile: FOX,
      title: WHITE,
      filename: `${FOX}.db`,
    })).toBe(true);
    expect(shouldSaveUnderNewName({
      hasExternalFile: true,
      titleInFile: FOX,
      title: FOX,
      filename: '狐狸第三版.db',
    })).toBe(false);
    const renamed = bookAfterRename(opened, WHITE, true);
    expect(renamed.followUp).toEqual({ kind: 'renamed', title: WHITE, askSaveAs: false, pending: 'resave' });
    const sameName = bookAfterRename({ ...opened, filename: `${WHITE}.db` }, WHITE, true);
    expect(sameName.followUp).toMatchObject({ askSaveAs: false, pending: null });
  });

  it('不能存回原檔、而且已經有檔案，才問要不要另存', () => {
    const asked = bookAfterRename(opened, WHITE, false);
    expect(asked.followUp).toEqual({ kind: 'renamed', title: WHITE, askSaveAs: true, pending: null });
    const fresh = bookAfterRename({ title: '未命名稿子' }, WHITE, false);
    expect(fresh.followUp).toEqual({ kind: 'renamed', title: WHITE, askSaveAs: false, pending: null });
    const back = bookAfterRename({ ...opened, title: WHITE }, FOX, false);
    expect(back.followUp).toEqual({ kind: 'renamed', title: FOX, askSaveAs: false, pending: null });
  });

  it('沒存過的新稿子，以及從檔案開進來的舊稿，標記不同', () => {
    expect(externalFileFromStored({ key: 'p-1', title: '未命名稿子' })).toEqual({
      hasExternalFile: false,
      titleInFile: null,
      titleSavePending: null,
    });
    expect(externalFileFromStored({ key: 'file-1', title: FOX })).toEqual({
      hasExternalFile: true,
      titleInFile: FOX,
      titleSavePending: null,
    });
    expect(externalFileFromStored({
      key: 'file-1',
      title: WHITE,
      hasExternalFile: true,
      titleInFile: FOX,
      titleSavePending: 'export',
    })).toEqual({
      hasExternalFile: true,
      titleInFile: FOX,
      titleSavePending: 'export',
    });
  });
});
