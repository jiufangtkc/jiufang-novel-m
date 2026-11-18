import { describe, expect, it } from 'vitest';
import { FORMAT_KINDS, formatText, isBlankLine, splitLines } from './formatText';

const IDEO = '　';
const A = (text: string) => formatText('indent', text);
const B = (text: string) => formatText('strip-blank', text);
const C = (text: string) => formatText('space-paragraphs', text);

describe('WO-122 行與換行拆解', () => {
  it('LF、CRLF 拆成行文字與換行符號；單獨 CR 留在行內', () => {
    expect(splitLines('甲\r\n乙\n丙\r丁')).toEqual({
      lines: ['甲', '乙', '丙\r丁'],
      seps: ['\r\n', '\n'],
    });
    expect(splitLines('')).toEqual({ lines: [''], seps: [] });
  });

  it('空行只認半形空格、全形空格、Tab、CR；其他字元不算', () => {
    for (const line of ['', ' ', IDEO, '\t', '\r', ` \t${IDEO}\r`]) expect(isBlankLine(line)).toBe(true);
    for (const line of ['a', ' ', ' ', '，', '0']) expect(isBlankLine(line)).toBe(false);
  });
});

describe('WO-122 (a) 段首加兩個全形空格', () => {
  it('工單例子：混合段首空白改成剛好兩個全形空格', () => {
    expect(A(` \t${IDEO}甲\n乙`)).toBe(`${IDEO}${IDEO}甲\n${IDEO}${IDEO}乙`);
  });

  it('工單例子：已是兩個且空白行不縮排，完全不變', () => {
    const text = `${IDEO}${IDEO}甲\n \t\n`;
    expect(A(text)).toBe(text);
  });

  it('無縮排補兩個、一個或三個全形空格都整理成兩個', () => {
    expect(A('甲')).toBe(`${IDEO}${IDEO}甲`);
    expect(A(`${IDEO}甲`)).toBe(`${IDEO}${IDEO}甲`);
    expect(A(`${IDEO}${IDEO}${IDEO}甲`)).toBe(`${IDEO}${IDEO}甲`);
    expect(A('    甲')).toBe(`${IDEO}${IDEO}甲`);
  });

  it('空行連同原有空白與換行原樣保留；章首章尾空行亦保留', () => {
    expect(A(`\n \n甲\n\t${IDEO}\n乙\n\n`)).toBe(`\n \n${IDEO}${IDEO}甲\n\t${IDEO}\n${IDEO}${IDEO}乙\n\n`);
  });

  it('不動行尾、段中空白與內文；只移除段首三種空白', () => {
    expect(A('甲 乙　丙  \t')).toBe(`${IDEO}${IDEO}甲 乙　丙  \t`);
    // NBSP、EM SPACE 不是可刪的段首空白，保留
    expect(A(' 甲')).toBe(`${IDEO}${IDEO} 甲`);
    expect(A(' 甲')).toBe(`${IDEO}${IDEO} 甲`);
  });

  it('CRLF 保留；單獨 CR 當行內字元不被刪', () => {
    expect(A('甲\r\n乙')).toBe(`${IDEO}${IDEO}甲\r\n${IDEO}${IDEO}乙`);
    expect(A('甲\r丙\n乙')).toBe(`${IDEO}${IDEO}甲\r丙\n${IDEO}${IDEO}乙`);
    // 以 CR 結尾的非空行：CR 留在行尾
    expect(A('甲\r\r\n乙')).toBe(`${IDEO}${IDEO}甲\r\r\n${IDEO}${IDEO}乙`);
  });

  it('混合 LF／CRLF 的每個原分隔符都保留', () => {
    expect(A('甲\r\n乙\n丙')).toBe(`${IDEO}${IDEO}甲\r\n${IDEO}${IDEO}乙\n${IDEO}${IDEO}丙`);
  });
});

describe('WO-122 (b) 去除空行', () => {
  it('工單例子：章首、段間、章尾空行都刪，留單一換行、不加尾端換行', () => {
    expect(B('\n 甲\n \t　\n\n乙\n')).toBe(' 甲\n乙');
  });

  it('空字串與只有空行都得到空字串', () => {
    expect(B('')).toBe('');
    expect(B(' \n\t\n　\r\n\n')).toBe('');
  });

  it('保留行的段首、行尾與內文原樣；不刪含字的行', () => {
    expect(B(`${IDEO}${IDEO}甲 \n\n\n  乙\t\n`)).toBe(`${IDEO}${IDEO}甲 \n  乙\t`);
    expect(B(' \n甲')).toBe(' \n甲');
  });

  it('CRLF 以前一非空行後的第一個分隔符相連；混合分隔符不統一', () => {
    expect(B('甲\r\n\r\n乙')).toBe('甲\r\n乙');
    expect(B('甲\r\n\n乙\n丙')).toBe('甲\r\n乙\n丙');
    expect(B('甲\n\r\n乙')).toBe('甲\n乙');
  });
});

describe('WO-122 (c) 段落之間加一行空行', () => {
  it('工單例子：單一換行補空行、多個收成一個、章首章尾空行去掉', () => {
    expect(C('\n 甲\n乙\n\n\n丙\n')).toBe(' 甲\n\n乙\n\n丙');
  });

  it('空字串、只有空行、單一非空段', () => {
    expect(C('')).toBe('');
    expect(C(' \n\t\n')).toBe('');
    expect(C('\n甲\n\n')).toBe('甲');
  });

  it('已有一個空行不重複加；只含空白的空行整理成空字串', () => {
    expect(C('甲\n\n乙')).toBe('甲\n\n乙');
    expect(C(`甲\n ${IDEO}\t\n乙`)).toBe('甲\n\n乙');
  });

  it('非空行的段首、行尾與內文不變', () => {
    expect(C(`${IDEO}${IDEO}甲 \n  乙\t`)).toBe(`${IDEO}${IDEO}甲 \n\n  乙\t`);
  });

  it('CRLF：新增空行沿用第一個換行的型式；原有分隔符保留', () => {
    expect(C('甲\r\n乙\r\n丙')).toBe('甲\r\n\r\n乙\r\n\r\n丙');
    expect(C('甲\r\n\r\n乙')).toBe('甲\r\n\r\n乙');
    // 無換行時用 LF；第一個換行是 LF 時新增 LF
    expect(C('甲\n乙\r\n丙')).toBe('甲\n\n乙\r\n\n丙');
  });

  it('單獨 CR 視為行內字元，不當換段', () => {
    expect(C('甲\r乙\n丙')).toBe('甲\r乙\n\n丙');
  });
});

describe('WO-122 三種轉換重做同一功能結果不變', () => {
  const samples = [
    '',
    '\n',
    ` \t${IDEO}甲\n乙`,
    '\n 甲\n乙\n\n\n丙\n',
    '甲\r\n乙\n\r\n\r\n丙\r\n',
    '甲\r乙\n丙 \n 丁',
    `${IDEO}${IDEO}甲\n \t\n`,
  ];
  for (const kind of FORMAT_KINDS) {
    it(`${kind} 重做不再改`, () => {
      for (const text of samples) {
        const once = formatText(kind, text);
        expect(formatText(kind, once)).toBe(once);
      }
    });
  }

  it('沒有實質變更時回傳同一份字串（呼叫端據此判斷無改動）', () => {
    const settled = `${IDEO}${IDEO}甲\n\n${IDEO}${IDEO}乙`;
    expect(A(settled)).toBe(settled);
    expect(C(settled)).toBe(settled);
    expect(B('甲\n乙')).toBe('甲\n乙');
  });
});
