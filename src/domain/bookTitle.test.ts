import { describe, expect, it } from 'vitest';
import { exportDbFilename, projectSaveFilename } from './exportFilename';
import {
  FILENAME_MAX_BYTES,
  RESERVED_NAME_SUFFIX,
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

  it('接近上限時組合表情要整組留下或整組拿掉', () => {
    const family = '👨\u200d👩\u200d👧\u200d👦';
    expect(countBookTitle(family)).toBe(1);
    expect(clipBookTitle(family.repeat(41)).text).toBe(family.repeat(40));
    const fitted = clipBookTitle(`${'狐'.repeat(39)}${family}尾`);
    expect(fitted.text.endsWith(family)).toBe(true);
    expect(countBookTitle(fitted.text)).toBe(40);
    expect(clipBookTitle(`${'狐'.repeat(40)}${family}`).text).toBe('狐'.repeat(40));
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

  it('只有標點時檔名仍看得出書名，Windows 保留名稱要能存', () => {
    expect(resolvedBookTitle('...')).toBe('...');
    expect(sanitizeDbBasename('...')).toBe('．．．');
    expect(projectSaveFilename('...')).toBe('．．．.db');
    expect(sanitizeDbBasename('...')).not.toBe('未命名稿子');
    for (const name of ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT1']) {
      expect(resolvedBookTitle(name)).toBe(name);
      const base = sanitizeDbBasename(name);
      expect(base.toLowerCase()).toBe(`${name.toLowerCase()}${RESERVED_NAME_SUFFIX}`);
      expect(`${base}.db`.toLowerCase().startsWith(`${name.toLowerCase()}.`)).toBe(false);
    }
    expect(titleMatchesFilename('CON', 'CON.db')).toBe(true);
    expect(titleMatchesFilename('CON', 'CON_.db')).toBe(true);
  });

  it('舊規則刪掉的字也認得，時間戳結尾要拿掉再比', () => {
    expect(filenameStem('【範例】月台上的狐狸_20261030-1140.db')).toBe('【範例】月台上的狐狸');
    expect(titleMatchesFilename('月台/白狐', '月台白狐.db')).toBe(true);
    expect(titleMatchesFilename('月台/白狐', '月台／白狐.db')).toBe(true);
    expect(titleMatchesFilename(WHITE, `${FOX}.db`)).toBe(false);
  });

  it('40 個家庭組合表情的書名：儲存與另存檔名都 ≤ 255 位元組且結尾是完整家庭表情', () => {
    const encoder = new TextEncoder();
    const family = '👨\u200d👩\u200d👧\u200d👦';
    const title = family.repeat(40);
    const base = sanitizeDbBasename(title);
    const saveName = projectSaveFilename(title);
    const exportName = exportDbFilename(title, when);

    expect(encoder.encode(base).byteLength).toBeLessThanOrEqual(FILENAME_MAX_BYTES);
    expect(encoder.encode(saveName).byteLength).toBeLessThanOrEqual(255);
    expect(encoder.encode(exportName).byteLength).toBeLessThanOrEqual(255);
    expect(saveName.endsWith('.db')).toBe(true);
    expect(exportName.endsWith('.db')).toBe(true);
    expect(base.endsWith(family)).toBe(true);
    expect(saveName.slice(0, -3).endsWith(family)).toBe(true);
    expect(filenameStem(exportName).endsWith(family)).toBe(true);
  });

  it('膚色表情、旗幟表情落在位元組截斷處時，整組留下或整組拿掉，不留殘缺字元', () => {
    const encoder = new TextEncoder();
    const waveSkin = '👋🏽'; // 8 位元組
    const flagTw = '🇹🇼'; // 8 位元組

    // 64 個中文字（192 位元組）＋ 8 位元組表情 ＝ 200 位元組（剛好塞得下，整組留下）
    const fitSkin = `${'狐'.repeat(64)}${waveSkin}尾`;
    const baseFitSkin = sanitizeDbBasename(fitSkin);
    expect(encoder.encode(baseFitSkin).byteLength).toBe(200);
    expect(baseFitSkin.endsWith(waveSkin)).toBe(true);

    const fitFlag = `${'狐'.repeat(64)}${flagTw}尾`;
    const baseFitFlag = sanitizeDbBasename(fitFlag);
    expect(encoder.encode(baseFitFlag).byteLength).toBe(200);
    expect(baseFitFlag.endsWith(flagTw)).toBe(true);

    // 65 個中文字（195 位元組）＋ 8 位元組表情 ＝ 203 位元組（超過 200，整組拿掉，不留半個）
    const dropSkin = `${'狐'.repeat(65)}${waveSkin}`;
    const baseDropSkin = sanitizeDbBasename(dropSkin);
    expect(baseDropSkin).toBe('狐'.repeat(65));
    expect(baseDropSkin.includes('👋')).toBe(false);

    const dropFlag = `${'狐'.repeat(65)}${flagTw}`;
    const baseDropFlag = sanitizeDbBasename(dropFlag);
    expect(baseDropFlag).toBe('狐'.repeat(65));
    expect(baseDropFlag.includes('🇹')).toBe(false);

    // 截完不留單獨代理字元、零寬連接字元（U+200D）、變體選擇字元（U+FE0F），並去掉截斷處結尾空白與句點
    const withBrokenAndEdges = `${'狐'.repeat(65)} \u3000.${waveSkin}`;
    expect(sanitizeDbBasename(withBrokenAndEdges)).toBe('狐'.repeat(65));
    expect(sanitizeDbBasename('👨\u200d')).toBe('👨');
    expect(sanitizeDbBasename('\u200d\ufe0f\ud83d')).toBe('未命名稿子');
    // 單一字元叢集本身超過 200 位元組時，安全回退為未命名稿子
    expect(sanitizeDbBasename(`狐${'\u0300'.repeat(100)}`)).toBe('未命名稿子');
  });

  it('沒有 Intl.Segmenter 時，家庭表情不拆開，膚色、旗幟與 40 個家庭表情都不會切出殘缺字元', () => {
    const encoder = new TextEncoder();
    const family = '👨\u200d👩\u200d👧\u200d👦';
    const waveSkin = '👋🏽';
    const flagTw = '🇹🇼';
    const intlHolder = Intl as unknown as { Segmenter?: typeof Intl.Segmenter };
    const originalSegmenter = intlHolder.Segmenter;
    try {
      delete intlHolder.Segmenter;

      expect(sanitizeDbBasename(`月台${family}白狐`)).toBe(`月台${family}白狐`);
      expect(projectSaveFilename(`月台${family}白狐`)).toBe(`月台${family}白狐.db`);
      expect(sanitizeDbBasename('月台👨👩👧👦白狐')).toBe('月台👨👩👧👦白狐');
      expect(projectSaveFilename('月台👨👩👧👦白狐')).toBe('月台👨👩👧👦白狐.db');

      const dropSkin = sanitizeDbBasename(`${'狐'.repeat(65)}${waveSkin}`);
      expect(dropSkin).toBe('狐'.repeat(65));
      expect(dropSkin.includes('👋')).toBe(false);

      const dropFlag = sanitizeDbBasename(`${'狐'.repeat(65)}${flagTw}`);
      expect(dropFlag).toBe('狐'.repeat(65));
      expect(dropFlag.includes('🇹')).toBe(false);

      const familyTitle = family.repeat(40);
      const familyBase = sanitizeDbBasename(familyTitle);
      const familySave = projectSaveFilename(familyTitle);
      const familyExport = exportDbFilename(familyTitle, when);
      expect(encoder.encode(familyBase).byteLength).toBeLessThanOrEqual(FILENAME_MAX_BYTES);
      expect(encoder.encode(familySave).byteLength).toBeLessThanOrEqual(255);
      expect(encoder.encode(familyExport).byteLength).toBeLessThanOrEqual(255);
      expect(familyBase.endsWith(family)).toBe(true);
      expect(familySave.slice(0, -3).endsWith(family)).toBe(true);
      expect(filenameStem(familyExport).endsWith(family)).toBe(true);
    } finally {
      intlHolder.Segmenter = originalSegmenter;
    }
  });

  it('80 個中文字的舊書名與 81 個英文字邊界：儲存與另存檔名都 ≤ 255 位元組，一般書名維持原樣', () => {
    const encoder = new TextEncoder();
    const longCjk = '狐'.repeat(80);
    const saveName = projectSaveFilename(longCjk);
    const exportName = exportDbFilename(longCjk, when);

    expect(encoder.encode(saveName).byteLength).toBeLessThanOrEqual(255);
    expect(encoder.encode(exportName).byteLength).toBeLessThanOrEqual(255);
    expect(saveName.endsWith('.db')).toBe(true);
    expect(exportName.endsWith('.db')).toBe(true);

    // 81 個 ASCII 英文字元受 80 字上限截斷為 80 字
    expect(sanitizeDbBasename('a'.repeat(81))).toBe('a'.repeat(80));

    // 一般長度書名與既有結果完全相同
    const march = new Date('2026-03-15T09:05:00');
    expect(exportDbFilename('【範例】霧/港*紀事', march)).toBe('【範例】霧／港＊紀事_20260315-0905.db');
    expect(projectSaveFilename('月台🦊白狐')).toBe('月台🦊白狐.db');
  });

  it('Windows 保留名稱全部逐一加「稿」，另存檔名不含連續兩個底線，非保留名不變', () => {
    const reservedNames = [
      'CON',
      'con',
      'Con',
      'PRN',
      'AUX',
      'NUL',
      'COM1',
      'COM2',
      'COM3',
      'COM4',
      'COM5',
      'COM6',
      'COM7',
      'COM8',
      'COM9',
      'LPT1',
      'LPT2',
      'LPT3',
      'LPT4',
      'LPT5',
      'LPT6',
      'LPT7',
      'LPT8',
      'LPT9',
      'COM\u00b9',
      'COM\u00b2',
      'COM\u00b3',
      'LPT\u00b9',
      'LPT\u00b2',
      'LPT\u00b3',
    ];
    for (const name of reservedNames) {
      expect(sanitizeDbBasename(name)).toBe(`${name}稿`);
      expect(projectSaveFilename(name)).toBe(`${name}稿.db`);
      const exported = exportDbFilename(name, when);
      expect(exported).toBe(`${name}稿_20261030-1140.db`);
      expect(exported.includes('__')).toBe(false);
    }

    expect(sanitizeDbBasename('CON.')).toBe('CON稿');
    expect(sanitizeDbBasename('CON ')).toBe('CON稿');
    expect(sanitizeDbBasename('nul.txt')).toBe('nul稿.txt');
    expect(projectSaveFilename('nul.txt')).toBe('nul稿.txt.db');
    expect(exportDbFilename('nul.txt', when)).toBe('nul稿.txt_20261030-1140.db');
    expect(exportDbFilename('CON.', when).includes('__')).toBe(false);
    expect(exportDbFilename('CON ', when).includes('__')).toBe(false);
    expect(exportDbFilename('nul.txt', when).includes('__')).toBe(false);

    expect(sanitizeDbBasename('COM10')).toBe('COM10');
    expect(sanitizeDbBasename('CONSOLE')).toBe('CONSOLE');
    expect(projectSaveFilename('COM10')).toBe('COM10.db');
    expect(projectSaveFilename('CONSOLE')).toBe('CONSOLE.db');
  });

  it('新舊保留名檔名與新舊長書名檔名，titleMatchesFilename 都判斷為同一本', () => {
    expect(titleMatchesFilename('CON', 'CON.db')).toBe(true);
    expect(titleMatchesFilename('CON', 'CON_.db')).toBe(true);
    expect(titleMatchesFilename('CON', 'CON__20261030-1911.db')).toBe(true);
    expect(titleMatchesFilename('CON', 'CON稿.db')).toBe(true);
    expect(titleMatchesFilename('CON', 'CON稿_20261110-1310.db')).toBe(true);

    expect(titleMatchesFilename('nul.txt', 'nul.txt.db')).toBe(true);
    expect(titleMatchesFilename('nul.txt', 'nul_.txt.db')).toBe(true);
    expect(titleMatchesFilename('nul.txt', 'nul_.txt_20261030-1911.db')).toBe(true);
    expect(titleMatchesFilename('nul.txt', 'nul稿.txt.db')).toBe(true);
    expect(titleMatchesFilename('nul.txt', 'nul稿.txt_20261110-1310.db')).toBe(true);

    const longCjk = '狐'.repeat(80);
    // 舊規則下存得出去的 80 個中文字（243 位元組）
    expect(titleMatchesFilename(longCjk, `${longCjk}.db`)).toBe(true);
    expect(titleMatchesFilename(longCjk, `${longCjk}_20261030-1911.db`)).toBe(true);
    // 新規則截斷後的儲存與另存檔名
    const truncatedBase = sanitizeDbBasename(longCjk);
    const exportedLong = exportDbFilename(longCjk, when);
    expect(titleMatchesFilename(longCjk, `${truncatedBase}.db`)).toBe(true);
    expect(titleMatchesFilename(longCjk, exportedLong)).toBe(true);
    expect(titleMatchesFilename(truncatedBase, exportedLong)).toBe(true);
    expect(shouldSaveUnderNewName({
      hasExternalFile: true,
      titleInFile: FOX,
      title: longCjk,
      filename: exportedLong,
    })).toBe(false);

    // 交錯結尾句點與空白：新檔名清理為「狐」，但仍認得 cfb9275 舊規則產生的「狐..db」及日期版本
    expect(sanitizeDbBasename('狐. . ')).toBe('狐');
    expect(titleMatchesFilename('狐. . ', '狐..db')).toBe(true);
    expect(titleMatchesFilename('狐. . ', '狐._20261030-1911.db')).toBe(true);
    expect(titleMatchesFilename('狐. .', '狐..db')).toBe(true);
    expect(titleMatchesFilename('狐. .', '狐._20261030-1911.db')).toBe(true);
    expect(titleMatchesFilename('狐. . ', '狐.db')).toBe(true);
    expect(titleMatchesFilename('狐. . ', '狐_20261110-1310.db')).toBe(true);
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
