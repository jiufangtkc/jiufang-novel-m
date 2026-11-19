import { describe, expect, it } from 'vitest';
import { importPreviewLines } from '../screens/ImportTextDialog';
import type { TextImportPreview } from '../state/sampleStore';
import {
  exampleHeadingMatcher,
  normalizeNewlines,
  parseChapterExample,
  splitChapters,
  splitChaptersByExample,
  splitChaptersByExampleInBatches,
  wholeTextAsOneChapter,
} from './textImport';

/** WO-126：全部是虛構假文字。 */
const OPTIONS = { prefaceTitle: '前言', defaultTitle: '第一章　' };

function matches(example: string, line: string): boolean {
  return exampleHeadingMatcher(example)(line) !== null;
}

function expectMatch(example: string, accepted: string[], rejected: string[]) {
  for (const line of accepted) expect(matches(example, line), `「${example}」應辨識「${line}」`).toBe(true);
  for (const line of rejected) expect(matches(example, line), `「${example}」不應辨識「${line}」`).toBe(false);
}

describe('WO-126 例子分章：例子比對', () => {
  it('01章（含頭尾空白、001章 同義）', () => {
    const accepted = ['01章 相遇', '02章：紙舟', '1章', '001章', '十二章', '０２章', '廿章', '01章夜雨'];
    const rejected = ['第一章', '01回', '他讀了01章', '01章的紙舟', '01章 她笑了。'];
    expectMatch('01章', accepted, rejected);
    expectMatch('  01章  ', accepted, rejected);
    expectMatch('001章', accepted, rejected);
  });

  it('第一回', () => {
    expectMatch('第一回', ['第二回', '第12回', '第壹回'], ['第一章', '第 2回']);
  });

  it('Chapter 1：大小寫、空白、全形逗號按字面', () => {
    expectMatch(
      'Chapter 1',
      ['Chapter 2', 'Chapter 12, Paper Boat', 'Chapter １２'],
      ['CHAPTER 2', 'Ch. 2', 'Chapter  2', 'Chapter 2，夜雨'],
    );
  });

  it('【第1話】：括號按字面，閉括號後可直接接標題', () => {
    expectMatch('【第1話】', ['【第2話】', '【第12話】不速之客'], ['第2話', '[第2話]', '【第2回】']);
  });

  it('第1節、第1集：排除正文用法', () => {
    expectMatch('第1節', ['第2節 夜雨'], ['第2節課']);
    expectMatch('第1集', ['第2集 夜雨'], ['第2集合', '第2集和朋友道別']);
  });

  it('[第1章]、第1章-第2節：兩組數字各自必須存在', () => {
    expectMatch('[第1章]', ['[第12章]'], ['第12章', '【第12章】']);
    expectMatch('第1章-第2節', ['第3章-第十二節'], ['第3章', '第3章-第']);
  });

  it('留白：與 WO-125 自動規則相同', () => {
    expectMatch('   ', ['序章', '第2卷', 'CHAPTER 2', '＃3夜雨'], ['第一幕', '第二章的主角']);
  });

  it('無效例子：一律零命中，不回退自動規則', () => {
    for (const example of ['你好', '001', '第一幕', '【第1幕】', '1幕', '第1 幕', '第1章\n第2章']) {
      expect(parseChapterExample(example), example).toBeNull();
      for (const line of [example.split('\n')[0], '第一章', '第二章 夜雨', '你好', '001', '第一幕', '【第1幕】']) {
        expect(matches(example, line), `「${example}」不應辨識「${line}」`).toBe(false);
      }
    }
  });

  it('「第1章 幕後」的幕是標題文字', () => {
    expect(matches('第1章', '第2章 幕後')).toBe(true);
  });

  it('不把例子當正規表示式', () => {
    expect(matches('(1)章', '(2)章')).toBe(true);
    expect(matches('.1章', 'x2章')).toBe(false);
    expect(matches('[1]*', '[2]*')).toBe(true);
    expect(matches('[1]*', '[22]')).toBe(false);
  });

  it('數字組完整吃完：不縮短數字去湊後面條件', () => {
    expect(matches('1章', '12章')).toBe(true);
    expect(matches('1十', '1十')).toBe(false); // 例子沒有非空白字面
  });

  it('句尾 。？！ 排除；80／81 碼點（含非 BMP）', () => {
    expect(matches('01章', '01章 夜雨？')).toBe(false);
    expect(matches('01章', '01章 夜雨！')).toBe(false);
    expect(matches('01章', `01章${'文'.repeat(77)}`)).toBe(true);
    expect(matches('01章', `01章${'文'.repeat(78)}`)).toBe(false);
    expect(matches('01章', `01章${'\u{20000}'.repeat(77)}`)).toBe(true);
    expect(matches('01章', `01章${'\u{20000}'.repeat(78)}`)).toBe(false);
  });

  it('井號數字例子：半形逗號可分隔，全形逗號、分號不行', () => {
    expect(matches('#1', '#2, 夜雨')).toBe(true);
    expect(matches('#1', '#2，夜雨')).toBe(false);
    expect(matches('#1', '#2；夜雨')).toBe(false);
    expect(matches('#1', '#2;夜雨')).toBe(false);
  });

  it('非英文例子：半形逗號不當分隔', () => {
    expect(matches('01章', '02章,夜雨')).toBe(false);
  });
});

describe('WO-126 例子分章：切章', () => {
  const text = ['引言一行', '01章 甲', '內容甲', '', '02章 乙', '內容乙', '03章 丙', '內容丙'].join('\n');

  it('章名行不進正文，前言計入，並回報命中數', () => {
    const result = splitChaptersByExample(text, '01章', OPTIONS);
    expect(result.hits).toBe(3);
    expect(result.prefaceAdded).toBe(true);
    expect(result.chapters.map((chapter) => chapter.title)).toEqual(['前言', '01章 甲', '02章 乙', '03章 丙']);
    expect(result.chapters[0].content).toBe('引言一行');
    expect(result.chapters[1].content).toBe('內容甲\n');
    expect(result.chapters[3].content).toBe('內容丙');
  });

  it('命中一行：只有一章，沒有前言', () => {
    const result = splitChaptersByExample('01章 唯一\n內容', '01章', OPTIONS);
    expect(result.hits).toBe(1);
    expect(result.prefaceAdded).toBe(false);
    expect(result.chapters).toEqual([{ title: '01章 唯一', content: '內容' }]);
  });

  it('零命中：全文放一章「第一章　」，空檔也一樣', () => {
    const none = splitChaptersByExample('隨便\n文字', '01章', OPTIONS);
    expect(none.hits).toBe(0);
    expect(none.prefaceAdded).toBe(false);
    expect(none.chapters).toEqual([{ title: '第一章　', content: '隨便\n文字' }]);
    expect(splitChaptersByExample('', '01章', OPTIONS).chapters).toEqual([{ title: '第一章　', content: '' }]);
  });

  it('無效例子即使正文有現成「第一章」也零命中', () => {
    const body = '第一章 起\n正文\n第一幕\n戲';
    for (const example of ['你好', '001', '第一幕', '【第1幕】']) {
      const result = splitChaptersByExample(body, example, OPTIONS);
      expect(result.hits).toBe(0);
      expect(result.chapters).toEqual([{ title: '第一章　', content: body }]);
    }
  });

  it('留白與 splitChapters（WO-125）結果一致', () => {
    const body = '前言文字\n第一章 起\n正文一\n序章\n第2卷\n尾';
    expect(splitChaptersByExample(body, '', OPTIONS).chapters).toEqual(splitChapters(body, OPTIONS));
    expect(splitChaptersByExample(body, '  ', OPTIONS).hits).toBe(3);
  });

  it('只有空白在章名前：不另建前言', () => {
    const result = splitChaptersByExample('\n\n01章 甲\n內容', '01章', OPTIONS);
    expect(result.prefaceAdded).toBe(false);
    expect(result.chapters).toHaveLength(1);
  });

  it('換行統一後 CRLF 稿子照樣分章', () => {
    const result = splitChaptersByExample(normalizeNewlines('01章 甲\r\n內容\r\n02章 乙\r\n內容'), '01章', OPTIONS);
    expect(result.chapters.map((chapter) => chapter.title)).toEqual(['01章 甲', '02章 乙']);
    expect(result.chapters[0].content).toBe('內容');
  });

  it('同步與分批結果一致（每批 2 行）', async () => {
    const lines: string[] = [];
    for (let index = 1; index <= 25; index += 1) lines.push(`${String(index).padStart(2, '0')}章 題${index}`, `正文${index}`, '');
    const body = `序\n${lines.join('\n')}`;
    let yields = 0;
    const batched = await splitChaptersByExampleInBatches(body, '01章', OPTIONS, async () => {
      yields += 1;
    }, 2);
    expect(yields).toBeGreaterThan(1);
    expect(batched).toEqual(splitChaptersByExample(body, '01章', OPTIONS));
    expect(batched.hits).toBe(25);
    expect(batched.chapters).toHaveLength(26);
  });

  it('不分章：整份文字原樣放進一章（含章名行、縮排、尾端空白）', () => {
    const body = '　　前言\n01章 甲\n  內容  \n';
    expect(wholeTextAsOneChapter(body, OPTIONS)).toEqual([{ title: '第一章　', content: body }]);
  });
});

describe('WO-126 預覽內容', () => {
  function preview(titles: string[], hits: number, usedExample: boolean): TextImportPreview {
    return {
      chapters: titles.map((title) => ({ title, content: '' })),
      hits,
      prefaceAdded: false,
      usedExample,
    };
  }

  it('找到：摘要 + 第 2 至第 5 章（合計最多五筆）', () => {
    const lines = importPreviewLines(preview(['01章 甲', '02章 乙', '03章 丙', '04章 丁', '05章 戊', '06章 己', '07章 庚'], 7, true));
    expect(lines.summary).toBe('找到 7 章，第一章是『01章 甲』');
    expect(lines.titles).toEqual(['02章 乙', '03章 丙', '04章 丁', '05章 戊']);
    expect(lines.notFound).toBeNull();
  });

  it('單章只有摘要；前言計入章數並當第一章', () => {
    expect(importPreviewLines(preview(['01章 甲'], 1, true))).toMatchObject({ summary: '找到 1 章，第一章是『01章 甲』', titles: [] });
    const withPreface = importPreviewLines(preview(['前言', '01章 甲'], 1, true));
    expect(withPreface.summary).toBe('找到 2 章，第一章是『前言』');
    expect(withPreface.titles).toEqual(['01章 甲']);
  });

  it('填了例子卻找不到：說找不到，並提示放成一章', () => {
    const lines = importPreviewLines(preview(['第一章　'], 0, true));
    expect(lines.found).toBe(false);
    expect(lines.notFound).toBe('找不到符合這個例子的章名');
    expect(lines.oneChapterHint).toBe('確定匯入後，全文會放在一章，章名是「第一章　」。');
  });

  it('留白且找不到：只有一章提示，不說「找不到符合這個例子」', () => {
    const lines = importPreviewLines(preview(['第一章　'], 0, false));
    expect(lines.notFound).toBeNull();
    expect(lines.oneChapterHint).not.toBeNull();
  });
});
