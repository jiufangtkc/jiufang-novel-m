import { describe, expect, it } from 'vitest';
import { countWords } from '../domain/wordCount';
import { findWritingSymbol, planSymbolInsert, WRITING_SYMBOLS } from './writingSymbols';
import { unifyPunctuation } from './unifyPunctuation';

const sym = (id: string) => {
  const found = findWritingSymbol(id);
  if (!found) throw new Error(`找不到符號 ${id}`);
  return found;
};

describe('WO-142 符號清單', () => {
  it('剛好 14 個，順序與分組正確', () => {
    expect(WRITING_SYMBOLS).toHaveLength(14);
    expect(WRITING_SYMBOLS.map((s) => s.id)).toEqual([
      'ideographic-space',
      'comma',
      'period',
      'enum-comma',
      'question',
      'exclamation',
      'colon',
      'semicolon',
      'ellipsis',
      'dash',
      'quote',
      'double-quote',
      'book-title',
      'article-title',
    ]);
    expect(WRITING_SYMBOLS.map((s) => s.group)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 3, 3, 3, 3]);
  });

  it('碼位正確：全形空白 U+3000、刪節號 U+2026×2、破折號 U+2500×2', () => {
    expect(sym('ideographic-space').left).toBe('　');
    expect(sym('ellipsis').left).toBe('……');
    expect(sym('dash').left).toBe('──');
    expect(sym('dash').left).not.toContain('—');
    expect(sym('quote')).toMatchObject({ left: '「', right: '」' });
    expect(sym('double-quote')).toMatchObject({ left: '『', right: '』' });
    expect(sym('book-title')).toMatchObject({ left: '《', right: '》' });
    expect(sym('article-title')).toMatchObject({ left: '〈', right: '〉' });
  });

  it('不含全形括號', () => {
    const all = WRITING_SYMBOLS.map((s) => s.left + (s.right ?? '')).join('');
    expect(all).not.toMatch(/[（）()]/);
  });

  it('長鍵只有空白、刪節號、破折號；只有空白有 title', () => {
    expect(WRITING_SYMBOLS.filter((s) => s.long).map((s) => s.id)).toEqual([
      'ideographic-space',
      'ellipsis',
      'dash',
    ]);
    expect(WRITING_SYMBOLS.filter((s) => s.title).map((s) => s.id)).toEqual(['ideographic-space']);
  });

  it('插入的 ── 與 …… 經「統一標點」後內容不變', () => {
    for (const id of ['dash', 'ellipsis']) {
      const text = `他說${sym(id).left}不會吧`;
      expect(unifyPunctuation(text).text).toBe(text);
      expect(unifyPunctuation(text).replacementCount).toBe(0);
    }
  });

  it('字數規則沿用：全形空白不算字，── 算 2 字', () => {
    expect(countWords('　　')).toBe(0);
    expect(countWords('──')).toBe(2);
    expect(countWords('……')).toBe(2);
  });
});

describe('WO-142 planSymbolInsert', () => {
  it('14 個符號各一例（無選取、文字正中）', () => {
    const text = '甲乙';
    for (const s of WRITING_SYMBOLS) {
      const plan = planSymbolInsert({ text, start: 1, end: 1, symbol: s });
      if (s.right !== undefined) {
        expect(plan).toEqual({
          insertText: s.left + s.right,
          caretOffsetInInsert: s.left.length,
          wrapsSelection: false,
        });
      } else {
        expect(plan).toEqual({
          insertText: s.left,
          caretOffsetInInsert: s.left.length,
          wrapsSelection: false,
        });
      }
    }
  });

  it('單符號有選取：取代選取，游標在符號之後', () => {
    const plan = planSymbolInsert({ text: '今天天氣', start: 2, end: 4, symbol: sym('comma') });
    expect(plan).toEqual({ insertText: '，', caretOffsetInInsert: 1, wrapsSelection: false });
  });

  it('成對符號有選取：把選取文字包起來，游標在右符號之後', () => {
    for (const id of ['quote', 'double-quote', 'book-title', 'article-title']) {
      const s = sym(id);
      const plan = planSymbolInsert({ text: '他說你好嗎', start: 2, end: 4, symbol: s });
      expect(plan.insertText).toBe(`${s.left}你好${s.right}`);
      expect(plan.caretOffsetInInsert).toBe(plan.insertText.length);
      expect(plan.wrapsSelection).toBe(true);
    }
  });

  it('游標在文首、文末、正中；含換行與全形字', () => {
    const text = '第一行\n　　第二行';
    const quote = sym('quote');
    const apply = (start: number, end: number) => {
      const plan = planSymbolInsert({ text, start, end, symbol: quote });
      const next = text.slice(0, start) + plan.insertText + text.slice(end);
      return { next, caret: start + plan.caretOffsetInInsert };
    };
    expect(apply(0, 0)).toEqual({ next: '「」' + text, caret: 1 });
    expect(apply(text.length, text.length)).toEqual({ next: text + '「」', caret: text.length + 1 });
    const mid = apply(4, 4);
    expect(mid.next).toBe('第一行\n「」　　第二行');
    expect(mid.caret).toBe(5);
    const wrap = apply(4, 8);
    expect(wrap.next).toBe('第一行\n「　　第二」行');
    expect(wrap.caret).toBe(4 + 6);
    const spaceAtStart = planSymbolInsert({ text, start: 0, end: 0, symbol: sym('ideographic-space') });
    expect(spaceAtStart.insertText).toBe('　');
  });

  it('超出範圍的選取會被夾回文字範圍', () => {
    const plan = planSymbolInsert({ text: 'ab', start: -3, end: 99, symbol: sym('quote') });
    expect(plan.insertText).toBe('「ab」');
  });
});
