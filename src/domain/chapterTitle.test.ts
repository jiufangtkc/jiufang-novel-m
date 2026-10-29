import { describe, expect, it } from 'vitest';
import type { ChapterNode } from '../data/demo';
import { TREE_NEW_CHAPTER } from '../copy/userFacing';
import { nextChapterTitle, parseChineseNumber, formatChineseNumber, sourceTitleForNewChapter } from './chapterTitle';

function file(id: string, title: string, children: ChapterNode[] = []): ChapterNode {
  return { id, type: 'file', title, children };
}

describe('下一章章號', () => {
  it('中文與阿拉伯數字都會加一，沒有章號就用新章', () => {
    expect(nextChapterTitle('第十二章　雨夜')).toBe('第十三章\u3000');
    expect(nextChapterTitle('第12章　雨夜')).toBe('第13章\u3000');
    expect(nextChapterTitle('序章')).toBe(TREE_NEW_CHAPTER);
    expect(nextChapterTitle(null)).toBe(TREE_NEW_CHAPTER);
    expect(nextChapterTitle('第九章')).toBe('第十章\u3000');
    expect(nextChapterTitle('第十章　潮')).toBe('第十一章\u3000');
    expect(nextChapterTitle('第十九章')).toBe('第二十章\u3000');
    expect(nextChapterTitle('第九十九章')).toBe('第一百章\u3000');
  });

  it('一到兩百的中文數字可以轉回來', () => {
    for (let value = 1; value <= 200; value += 1) {
      expect(parseChineseNumber(formatChineseNumber(value))).toBe(value);
    }
    expect(parseChineseNumber(formatChineseNumber(101))).toBe(101);
    expect(parseChineseNumber(formatChineseNumber(110))).toBe(110);
    expect(parseChineseNumber(formatChineseNumber(1001))).toBe(1001);
  });

  it('幕用所屬章的章號，沒有錨點用最後一章', () => {
    const nodes: ChapterNode[] = [
      {
        id: 'v',
        type: 'folder',
        title: '卷一',
        children: [file('c1', '第一章　來信', [{ id: 's1', type: 'scene', title: '幕 1' }]), file('c2', '第二章　燈塔')],
      },
      file('c3', '第三章　舊照片'),
    ];
    expect(nextChapterTitle(sourceTitleForNewChapter(nodes, 'c2'))).toBe('第三章\u3000');
    expect(nextChapterTitle(sourceTitleForNewChapter(nodes, 's1'))).toBe('第二章\u3000');
    expect(nextChapterTitle(sourceTitleForNewChapter(nodes, null))).toBe('第四章\u3000');
    expect(nextChapterTitle(sourceTitleForNewChapter([file('x', '楔子')], 'x'))).toBe(TREE_NEW_CHAPTER);
  });
});
