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

  it('WO-99／WO-125：不誤切——行中「第三章」、「第三章的時候……」、超過 80 碼點、非數字；放寬後直接接標題與節改為分章', () => {
    expect(chapterHeadingTitle('他翻到第三章，停了下來。')).toBeNull();
    expect(chapterHeadingTitle('第三章的時候，她已經離開。')).toBeNull();
    // WO-125：舊斷言為 null，現在會分章
    expect(chapterHeadingTitle('第三章夜雨')).toBe('第三章夜雨');
    expect(chapterHeadingTitle('第三章：夜雨')).toBe('第三章：夜雨');
    expect(chapterHeadingTitle('第三節　夜雨')).toBe('第三節　夜雨');
    expect(chapterHeadingTitle('第章')).toBeNull();
    expect(chapterHeadingTitle('第甲章')).toBeNull();
    const long = `第三章 ${'長'.repeat(76)}`; // 3 + 1 + 76 = 80 碼點，剛好可以
    expect(chapterHeadingTitle(long)).toBe(long);
    expect(chapterHeadingTitle(`${long}長`)).toBeNull();
    // 表情符號以碼點算：80 個碼點可以，81 個不行
    const emoji = `第三章 ${'😀'.repeat(76)}`;
    expect(chapterHeadingTitle(emoji)).toBe(emoji);
    expect(chapterHeadingTitle(`${emoji}😀`)).toBeNull();

    const overlong = `第三章 ${'長'.repeat(90)}`;
    const text = `他翻到第三章，停了下來。\n第三章的時候，她已經離開。\n第三章夜雨\n${overlong}`;
    expect(splitChapters(text, OPTIONS)).toEqual([
      { title: '前言', content: '他翻到第三章，停了下來。\n第三章的時候，她已經離開。' },
      { title: '第三章夜雨', content: overlong },
    ]);
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

describe('WO-125 放寬章名判斷', () => {
  const ACCEPT = [
    // 調查第七節
    '第一章燈號',
    '第二章：夜雨',
    '第三章、天晴',
    '第四章-回聲',
    '第五章（上）',
    '【第六章】',
    '第壹章 大寫',
    '01章 連載',
    '02章：連載二',
    '001章 前導零',
    '０１章 全形',
    '第十二話 短篇單位',
    '第3回 章回',
    '第2節 小節',
    '序章 開場',
    '楔子',
    '番外一',
    '番外：雨停之後',
    '尾聲',
    '後記',
    'Chapter 8 After',
    '＃9 井號',
    '第一卷 風起',
    '【01章】括號連載',
    // 工單第四節其他例
    '第一章',
    '第 12 章',
    '1章',
    '十二章',
    '第十二章　夜雨',
    '第一章（完）',
    '01章燈號',
    '第一章:燈號',
    '第一章、燈號',
    '第一章－燈號',
    '第一章—燈號',
    '第一章–燈號',
    '第一章·燈號',
    '第一章「燈號」',
    '第一章《燈號》',
    '第一章(上)',
    '第廿章',
    '第卅一章',
    '第貳拾章',
    '第3集 單位',
    '【第一章】燈號',
    '[第一章]',
    '[第一章] 燈號',
    '［第十二章］',
    '序言',
    '引子',
    '前言',
    '外傳',
    '終章',
    '附錄',
    '序章 初見',
    '楔子：風起',
    '番外',
    '番外之婚後生活',
    '前言：作者的話',
    'Chapter 1',
    'CHAPTER 1',
    'Chapter 1 The Beginning',
    'Ch.2 夜雨',
    'Ch3',
    '#1',
    '＃1',
    '#01 標題',
    '＃2：夜雨',
    '#1 第1章：燈號',
    '第一卷',
    '第1卷：燈號',
    '卷二',
    '卷 2 雲回',
    '上卷',
    '中卷 雲起',
    '下卷',
    '第一卷第一章 莊周夢蝶',
  ];

  const REJECT = [
    // 調查第七節
    '他翻到第三章，停了下來。',
    '第三章的時候，她已經離開。',
    '3章都寫完了，他才合上檔案。',
    '等到了第三章才知道真相。',
    '前言不搭後語，她卻把那句話說完了。',
    '1. 先買菜',
    '2024',
    '# 注意事項',
    '第一幕從夜晚開始寫。',
    // 無句尾標點的正文接續
    '3章都寫完了',
    '第三章的時候她已經離開',
    '前言不搭後語',
    // 第五節
    '第三節課',
    '第3集合',
    '第3集和',
    '第章',
    '第甲章',
    '第一部分',
    '第三部門',
    '第三部隊',
    '第一部',
    '第一篇',
    '第一幕',
    '第X幕',
    '01',
    '001',
    '12',
    '1、標題',
    '一、標題',
    '＃標題',
    '#標題',
    '=======',
    '------',
    '序',
    '正文',
    '正文卷',
    '《第一章》',
    '上篇',
    '中篇',
    '下篇',
    // 其他邊界
    '【第一章]',
    '【第一章',
    '第一章，她離開了',
    '序言很長',
    '番外十分精彩',
    'Chapter',
    'Chapters 1',
    '#',
    '',
    '   ',
  ];

  it('合格章名回傳整行去頭尾空白後的原文', () => {
    for (const line of ACCEPT) {
      expect(chapterHeadingTitle(line), line).toBe(line);
      expect(chapterHeadingTitle(`  \t${line}　 `), line).toBe(line);
    }
  });

  it('不合格的行回傳 null', () => {
    for (const line of REJECT) expect(chapterHeadingTitle(line), line).toBeNull();
  });

  it('直接接標題時，正文虛詞開頭一律留在正文（逐字）', () => {
    for (const word of [...'的得地都了就也還在是有和與把被會要能後時裡里中到過來去給跟比很更不沒再才已卻']) {
      expect(chapterHeadingTitle(`第一章${word}燈號`), word).toBeNull();
      expect(chapterHeadingTitle(`01章${word}燈號`), word).toBeNull();
      // 有明確分隔就不受虛詞限制
      expect(chapterHeadingTitle(`第一章 ${word}燈號`), word).toBe(`第一章 ${word}燈號`);
    }
  });

  it('句尾 。？！ 各自獨立使整行留在正文，所有類型皆然', () => {
    for (const mark of ['。', '？', '！']) {
      expect(chapterHeadingTitle(`第一章 燈號${mark}`), mark).toBeNull();
      expect(chapterHeadingTitle(`01章 燈號${mark}`), mark).toBeNull();
      expect(chapterHeadingTitle(`番外：燈號${mark}`), mark).toBeNull();
      expect(chapterHeadingTitle(`Chapter 1 Go${mark}`), mark).toBeNull();
      expect(chapterHeadingTitle(`#1 燈號${mark}`), mark).toBeNull();
      expect(chapterHeadingTitle(`第一卷 風起${mark}`), mark).toBeNull();
      expect(chapterHeadingTitle(`第一章 燈號${mark}  `), mark).toBeNull();
    }
    // 句中的標點不影響
    expect(chapterHeadingTitle('第一章 你好嗎？她問')).toBe('第一章 你好嗎？她問');
  });

  it('保留原字、內部空白、前導零與全形字形', () => {
    expect(chapterHeadingTitle('  第 012 章 　夜  雨 ')).toBe('第 012 章 　夜  雨');
    expect(chapterHeadingTitle('０１章  夜雨')).toBe('０１章  夜雨');
  });

  it('80 碼點可以、81 碼點不行（各類型、含表情符號）', () => {
    const cases: Array<[string, number]> = [
      ['第三章 ', 4],
      ['01章 ', 4],
      ['番外：', 3],
      ['Chapter 1 ', 10],
      ['#1 ', 3],
      ['第一卷 ', 4],
    ];
    for (const [head] of cases) {
      const headCount = [...head].length;
      const ok = `${head}${'長'.repeat(80 - headCount)}`;
      expect([...ok]).toHaveLength(80);
      expect(chapterHeadingTitle(ok), head).toBe(ok);
      expect(chapterHeadingTitle(`${ok}長`), head).toBeNull();
      const emoji = `${head}${'😀'.repeat(80 - headCount)}`;
      expect(chapterHeadingTitle(emoji), head).toBe(emoji);
      expect(chapterHeadingTitle(`${emoji}😀`), head).toBeNull();
    }
    // 頭尾空白不計入
    const padded = `  第三章 ${'長'.repeat(76)}  `;
    expect(chapterHeadingTitle(padded)).toBe(padded.trim());
  });

  const MIXED = [
    '燈號練習稿（虛構）',
    '他翻到第三章，停了下來。',
    '',
    '序章 開場',
    '天還沒亮。',
    '3章都寫完了',
    '第一卷第一章 莊周夢蝶',
    '卷首這一行是正文，。',
    '第一幕從夜晚開始寫。',
    '第一章燈號',
    '1. 先買菜',
    '2024',
    '# 注意事項',
    '第三章的時候，她已經離開。',
    '第三節課',
    '【第六章】',
    '01章 連載',
    '  02章：連載二  ',
    '番外一',
    '前言不搭後語',
    '尾聲',
    '=======',
    '第一章！',
  ].join('\n');

  const MIXED_EXPECTED = [
    { title: '前言', content: '燈號練習稿（虛構）\n他翻到第三章，停了下來。\n' },
    { title: '序章 開場', content: '天還沒亮。\n3章都寫完了' },
    { title: '第一卷第一章 莊周夢蝶', content: '卷首這一行是正文，。\n第一幕從夜晚開始寫。' },
    {
      title: '第一章燈號',
      content: '1. 先買菜\n2024\n# 注意事項\n第三章的時候，她已經離開。\n第三節課',
    },
    { title: '【第六章】', content: '' },
    { title: '01章 連載', content: '' },
    { title: '02章：連載二', content: '' },
    { title: '番外一', content: '前言不搭後語' },
    { title: '尾聲', content: '=======\n第一章！' },
  ];

  it('組合假稿：章名順序、章數與完整正文；卷與章同列只成一章', () => {
    const chapters = splitChapters(MIXED, OPTIONS);
    expect(chapters).toEqual(MIXED_EXPECTED);
    expect(chapters.filter((chapter) => chapter.title.includes('卷'))).toHaveLength(1);
  });

  it('組合假稿：分批版與同步版一致', async () => {
    const batched = await splitChaptersInBatches(MIXED, OPTIONS, async () => {}, 3);
    expect(batched).toEqual(splitChapters(MIXED, OPTIONS));
  });

  it('第一輪返工：英文章名與井號編號數字後可直接接標題', () => {
    for (const line of [
      'Chapter 1夜雨',
      'Chapter 2天晴',
      'CHAPTER 3夜雨',
      'Chapter1夜雨',
      'Ch.4夜雨',
      'Ch5夜雨',
      '＃1夜雨',
      '#2夜雨',
      '#12天晴',
    ]) {
      expect(chapterHeadingTitle(line), line).toBe(line);
    }
    // 仍擋正文：句尾標點、數字後直接逗號
    for (const line of ['Chapter 1夜雨。', 'Chapter 2天晴？', '＃1夜雨！', '#1夜雨。', 'Chapter 1，她離開了', '#1，她離開了', '#12，她離開了', 'Chapter 1；她走了', 'Chapter 1;she left']) {
      expect(chapterHeadingTitle(line), line).toBeNull();
    }
    // 第二輪返工：半形逗號是英文標題的合法分隔
    for (const line of ['Chapter 1, The Beginning', 'Chapter 2, The Return', 'CHAPTER 3,The End', 'Ch.4, Rain', '#5, Rain']) {
      expect(chapterHeadingTitle(line), line).toBe(line);
    }
    const text = 'Chapter 1夜雨\n雨下了。\nChapter 2天晴\n太陽出來了。\n＃3收尾\n完。';
    expect(splitChapters(text, OPTIONS)).toEqual([
      { title: 'Chapter 1夜雨', content: '雨下了。' },
      { title: 'Chapter 2天晴', content: '太陽出來了。' },
      { title: '＃3收尾', content: '完。' },
    ]);
  });

  it('第一輪返工：成對方括號後的短標題不套用虛詞限制', () => {
    for (const line of [
      '【第一章】不速之客',
      '【01章】不是結局',
      '[第一章]的故事',
      '［第十二章］在路上',
      '【第一章】燈號',
      '【01章】夜雨',
    ]) {
      expect(chapterHeadingTitle(line), line).toBe(line);
    }
    // 句尾標點與括號後直接接標點仍是正文；無括號的直接接虛詞仍是正文
    expect(chapterHeadingTitle('【第一章】不速之客。')).toBeNull();
    expect(chapterHeadingTitle('【第一章】，她離開了')).toBeNull();
    expect(chapterHeadingTitle('第一章不速之客')).toBeNull();
    expect(chapterHeadingTitle('01章不是結局')).toBeNull();
  });

  it('卷名各自成為同層的一章，不建卷下的章', () => {
    expect(splitChapters('第一卷 風起\n甲\n第二卷\n乙\n上卷\n丙', OPTIONS)).toEqual([
      { title: '第一卷 風起', content: '甲' },
      { title: '第二卷', content: '乙' },
      { title: '上卷', content: '丙' },
    ]);
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
