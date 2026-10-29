import { describe, expect, it } from 'vitest';
import { countManuscriptWords } from './manuscriptWords';

describe('電腦版字數', () => {
  it('漢字逐字、英數整段、標點與空白不算', () => {
    expect(countManuscriptWords('霧港，有燈。')).toBe(4);
    expect(countManuscriptWords('Hello 世界')).toBe(3);
    expect(countManuscriptWords('<p>甲乙</p>')).toBe(2);
  });
});
