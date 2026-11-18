import { describe, expect, it } from 'vitest';
import {
  chapterHeadingTitle,
  decodeTextBytes,
  defaultStrictDecoder,
  importTitleFromFilename,
  normalizeNewlines,
  splitChapters,
  splitChaptersInBatches,
  supportsStrictBig5,
  type StrictDecoderFactory,
} from './textImport';

/** 全部是程式產生的假文字，不用任何真稿子。 */
const OPTIONS = { prefaceTitle: '前言', defaultTitle: '第一章　' };
const utf8 = (text: string) => new TextEncoder().encode(text);

/**
 * Big5 位元組以明確碼表組裝（Node 沒有 Big5 編碼器，不新增套件）。
 * 對應值取自 Big5 標準碼表，測試裡再用嚴格解碼器反解核對；這份位元組不是合法 UTF-8，
 * 確保真的走 Big5 這條路，不是拿 UTF-8 假充。
 */
const BIG5: Record<string, [number, number]> = {
  '　': [0xa1, 0x40],
  '。': [0xa1, 0x43],
  一: [0xa4, 0x40],
  了: [0xa4, 0x46],
  二: [0xa4, 0x47],
  下: [0xa4, 0x55],
  天: [0xa4, 0xd1],
  太: [0xa4, 0xd3],
  出: [0xa5, 0x58],
  來: [0xa8, 0xd3],
  夜: [0xa9, 0x5d],
  雨: [0xab, 0x42],
  第: [0xb2, 0xc4],
  章: [0xb3, 0xb9],
  晴: [0xb4, 0xb8],
  陽: [0xb6, 0xa7],
  整: [0xbe, 0xe3],
  檔: [0xc0, 0xc9],
  舊: [0xc2, 0xc2],
};

function big5Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code < 0x80) out.push(code);
    else {
      const pair = BIG5[char];
      if (!pair) throw new Error(`測試碼表缺 ${char}`);
      out.push(...pair);
    }
  }
  return new Uint8Array(out);
}

describe('WO-99 文字檔解碼', () => {
  it('WO-99：UTF-8 中文、英文、數字與符號照原樣解出', () => {
    const text = '第一章　夜雨\n雨下了 3 天，Rain! ¥100％「引號」……😀';
    const result = decodeTextBytes(utf8(text));
    expect(result).toEqual({ ok: true, text, encoding: 'utf-8' });
  });

  it('WO-99：UTF-8 BOM 會被拿掉，不混進正文；BOM 之後的第二個 U+FEFF 照留', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('第一章\n正文')]);
    const result = decodeTextBytes(bytes);
    expect(result.ok && result.text).toBe('第一章\n正文');
    expect(result.ok && result.text.includes('﻿')).toBe(false);
    const twice = new Uint8Array([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, ...utf8('甲')]);
    const again = decodeTextBytes(twice);
    expect(again.ok && again.text).toBe('﻿甲');
  });

  it('WO-99：BOM 標成 UTF-8 但內容壞掉，不改猜 Big5', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...big5Bytes('第一章')]);
    expect(decodeTextBytes(bytes)).toEqual({ ok: false, reason: 'undecodable' });
  });

  it('WO-99：目前測試環境（Node）的 TextDecoder 支援嚴格 Big5', () => {
    expect(supportsStrictBig5()).toBe(true);
    expect(defaultStrictDecoder('big5')).not.toBeNull();
  });

  it('WO-99：程式組出的 Big5 位元組（非合法 UTF-8）能正確解出', () => {
    const source = '舊檔\r\n第一章　夜雨\r\n雨下了一整夜。\r\n第二章　天晴\r\n太陽出來了。';
    const bytes = big5Bytes(source);
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toThrow();
    const result = decodeTextBytes(bytes);
    expect(result).toEqual({ ok: true, text: source, encoding: 'big5' });
    const chapters = splitChapters(normalizeNewlines(source), OPTIONS);
    expect(chapters).toEqual([
      { title: '前言', content: '舊檔' },
      { title: '第一章　夜雨', content: '雨下了一整夜。' },
      { title: '第二章　天晴', content: '太陽出來了。' },
    ]);
  });

  it('WO-99：執行環境不支援 Big5 時，非 UTF-8 檔回報讀不出來（不退回非嚴格 UTF-8）', () => {
    const noBig5: StrictDecoderFactory = (label) => (label === 'big5' ? null : defaultStrictDecoder(label));
    expect(supportsStrictBig5(noBig5)).toBe(false);
    expect(decodeTextBytes(big5Bytes('第一章'), noBig5)).toEqual({ ok: false, reason: 'undecodable' });
    // UTF-8 檔不受影響
    expect(decodeTextBytes(utf8('第一章'), noBig5).ok).toBe(true);
  });

  it('WO-99：UTF-16／UTF-32 BOM 一律不支援', () => {
    expect(decodeTextBytes(new Uint8Array([0xff, 0xfe, 0x2c, 0x7b]))).toEqual({ ok: false, reason: 'unsupported-bom' });
    expect(decodeTextBytes(new Uint8Array([0xfe, 0xff, 0x7b, 0x2c]))).toEqual({ ok: false, reason: 'unsupported-bom' });
    expect(decodeTextBytes(new Uint8Array([0xff, 0xfe, 0, 0, 0x2c, 0x7b, 0, 0]))).toEqual({ ok: false, reason: 'unsupported-bom' });
    expect(decodeTextBytes(new Uint8Array([0, 0, 0xfe, 0xff, 0, 0, 0x7b, 0x2c]))).toEqual({ ok: false, reason: 'unsupported-bom' });
  });

  it('WO-99：無效位元組、NUL、二進位控制字元都讀不出來', () => {
    // 兩種解碼都不合法
    expect(decodeTextBytes(new Uint8Array([0x80, 0x80, 0xff]))).toMatchObject({ ok: false });
    // 合法 UTF-8 但有 NUL（像沒 BOM 的 UTF-16）
    expect(decodeTextBytes(utf8('A\u0000B\u0000'))).toEqual({ ok: false, reason: 'binary' });
    // 其他控制字元
    expect(decodeTextBytes(utf8('正文\u0007響鈴'))).toEqual({ ok: false, reason: 'binary' });
    expect(decodeTextBytes(utf8('正文\u001b[31m'))).toEqual({ ok: false, reason: 'binary' });
    expect(decodeTextBytes(utf8('正文\u0085'))).toEqual({ ok: false, reason: 'binary' });
    // 像圖片檔開頭的二進位內容
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
    expect(decodeTextBytes(png)).toMatchObject({ ok: false });
  });

  it('WO-99：純英文、數字、空白與空檔都可以讀（不用中文字比例判斷）', () => {
    expect(decodeTextBytes(utf8('Chapter 1\n12345\n'))).toMatchObject({ ok: true });
    expect(decodeTextBytes(utf8('   \n\t\n'))).toMatchObject({ ok: true });
    expect(decodeTextBytes(new Uint8Array())).toEqual({ ok: true, text: '', encoding: 'utf-8' });
    // 定位、換頁可以留在正文
    expect(decodeTextBytes(utf8('甲\t乙\f丙'))).toMatchObject({ ok: true });
  });
});

describe('WO-99 換行統一', () => {
  it('WO-99：CRLF、CR、LF 都成 LF，縮排、空行與尾端內容保留', () => {
    expect(normalizeNewlines('一\r\n二\r三\n四')).toBe('一\n二\n三\n四');
    expect(normalizeNewlines('　　縮排\r\n\r\n\r\n  尾端\r\n')).toBe('　　縮排\n\n\n  尾端\n');
    expect(normalizeNewlines('\r\r\n\n')).toBe('\n\n\n');
    const chapters = splitChapters(normalizeNewlines('第一章\r\n　　開頭\r\n\r\n結尾  \r\n'), OPTIONS);
    expect(chapters).toEqual([{ title: '第一章', content: '　　開頭\n\n結尾  \n' }]);
  });
});

describe('WO-99 分章', () => {
  it('WO-99：國字、阿拉伯數字、全形數字、兩／零／〇／百／千都認得', () => {
    for (const line of [
      '第一章',
      '第十二章',
      '第兩百零三章',
      '第一〇章',
      '第一千章',
      '第12章',
      '第１２章',
      '第 12 章',
      '第　十二　章',
      '第十二章　夜雨',
      '第十二章 夜雨',
      '第十二章\t夜雨',
    ]) {
      expect(chapterHeadingTitle(line)).toBe(line.trim());
    }
  });

  it('WO-99：行首空白、定位、全形空白可略過，章名是整行去頭尾空白、標題原字與中間空白都保留', () => {
    expect(chapterHeadingTitle('  第三章　夜雨  ')).toBe('第三章　夜雨');
    expect(chapterHeadingTitle('\t第三章 夜雨 與 晴')).toBe('第三章 夜雨 與 晴');
    expect(chapterHeadingTitle('　　第三章　　夜雨　')).toBe('第三章　　夜雨');
  });

  it('WO-99：不誤切——行中「第三章」、「第三章的時候……」、章後沒分隔、超過 80 碼點、非數字', () => {
    expect(chapterHeadingTitle('他翻到第三章，停了下來。')).toBeNull();
    expect(chapterHeadingTitle('第三章的時候，她已經離開。')).toBeNull();
    expect(chapterHeadingTitle('第三章夜雨')).toBeNull();
    expect(chapterHeadingTitle('第三章：夜雨')).toBeNull();
    expect(chapterHeadingTitle('第三節　夜雨')).toBeNull();
    expect(chapterHeadingTitle('第章')).toBeNull();
    expect(chapterHeadingTitle('第甲章')).toBeNull();
    const long = `第三章 ${'長'.repeat(76)}`; // 3 + 1 + 76 = 80 碼點，剛好可以
    expect(chapterHeadingTitle(long)).toBe(long);
    expect(chapterHeadingTitle(`${long}長`)).toBeNull();
    // 表情符號以碼點算：80 個碼點可以，81 個不行
    const emoji = `第三章 ${'😀'.repeat(76)}`;
    expect(chapterHeadingTitle(emoji)).toBe(emoji);
    expect(chapterHeadingTitle(`${emoji}😀`)).toBeNull();

    const text = '他翻到第三章，停了下來。\n第三章的時候，她已經離開。\n第三章夜雨\n' + `第三章 ${'長'.repeat(90)}`;
    expect(splitChapters(text, OPTIONS)).toEqual([{ title: '第一章　', content: text }]);
  });

  it('WO-99：連續章名形成空章，不合併、不丟棄；章名行不重複放進正文', () => {
    const text = '第一章 甲\n第二章 乙\n\n第三章 丙\n內容';
    expect(splitChapters(text, OPTIONS)).toEqual([
      { title: '第一章 甲', content: '' },
      { title: '第二章 乙', content: '' },
      { title: '第三章 丙', content: '內容' },
    ]);
    expect(splitChapters('第一章\n第二章', OPTIONS)).toEqual([
      { title: '第一章', content: '' },
      { title: '第二章', content: '' },
    ]);
  });

  it('WO-99：第一個章名前有文字就建「前言」，不丟字', () => {
    const text = '作者的話\n  寫在前面。\n\n第一章　開始\n正文';
    expect(splitChapters(text, OPTIONS)).toEqual([
      { title: '前言', content: '作者的話\n  寫在前面。\n' },
      { title: '第一章　開始', content: '正文' },
    ]);
  });

  it('WO-99：章名前只有空白，不另建前言，空白留在首章正文', () => {
    expect(splitChapters('\n  \n第一章\n正文', OPTIONS)).toEqual([{ title: '第一章', content: '\n  \n正文' }]);
    expect(splitChapters('\n第一章\n正文', OPTIONS)).toEqual([{ title: '第一章', content: '\n正文' }]);
    expect(splitChapters('第一章\n正文', OPTIONS)).toEqual([{ title: '第一章', content: '正文' }]);
  });

  it('WO-99：沒有章名就整份一章，章名「第一章　」，全文原樣；空檔與只有空白也一樣', () => {
    const text = '  開頭縮排\n\n中間\n結尾  \n';
    expect(splitChapters(text, OPTIONS)).toEqual([{ title: '第一章　', content: text }]);
    expect(splitChapters('', OPTIONS)).toEqual([{ title: '第一章　', content: '' }]);
    expect(splitChapters(' \n　\n', OPTIONS)).toEqual([{ title: '第一章　', content: ' \n　\n' }]);
  });

  it('WO-99：所有正文與章名接回去，除了分隔換行與章名行頭尾空白，一字不少', () => {
    const text = '序\n\n第一章 甲\n一\n\n第二章 乙\n二\n';
    const chapters = splitChapters(text, OPTIONS);
    const rebuilt = chapters
      .map((chapter, index) => (index === 0 && chapter.title === '前言' ? chapter.content : `${chapter.title}\n${chapter.content}`))
      .join('\n');
    expect(rebuilt).toBe(text);
  });

  it('WO-99：分批版與同步版結果完全一樣，而且真的分批讓出', async () => {
    const lines: string[] = [];
    for (let index = 1; index <= 30; index += 1) {
      lines.push(`第${index}章 標題${index}`);
      for (let line = 0; line < 400; line += 1) lines.push(`第 ${index} 章第 ${line} 行。`);
    }
    const text = `前面的話\n${lines.join('\n')}`;
    let yields = 0;
    const batched = await splitChaptersInBatches(text, OPTIONS, async () => {
      yields += 1;
    }, 1000);
    expect(batched).toEqual(splitChapters(text, OPTIONS));
    expect(batched).toHaveLength(31);
    expect(yields).toBeGreaterThanOrEqual(12);
  });
});

describe('WO-99 書名', () => {
  it('WO-99：去掉結尾 .txt（大小寫都可），沿用 40 字與「未命名稿子」', () => {
    expect(importTitleFromFilename('霧港紀事.txt')).toBe('霧港紀事');
    expect(importTitleFromFilename('霧港紀事.TXT')).toBe('霧港紀事');
    expect(importTitleFromFilename('a.txt.txt')).toBe('a.txt');
    expect(importTitleFromFilename('沒有副檔名')).toBe('沒有副檔名');
    expect(importTitleFromFilename('.txt')).toBe('未命名稿子');
    expect(importTitleFromFilename('   .txt')).toBe('未命名稿子');
    expect(importTitleFromFilename(`${'長'.repeat(45)}.txt`)).toBe('長'.repeat(40));
    // 不當成路徑或 HTML
    expect(importTitleFromFilename('<b>a/b</b>.txt')).toBe('<b>a/b</b>');
  });
});
