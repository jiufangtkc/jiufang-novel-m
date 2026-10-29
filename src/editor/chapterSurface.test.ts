import { describe, expect, it } from 'vitest';
import { switchChapterDraft, textForBoundChapter, type ChapterSwitch } from './chapterSurface';

describe('換章不會把一章的字寫進另一章', () => {
  it('點第 12 章再點第 07 章，正文要換成 07 的字，12 的改動留在 12', () => {
    let state: ChapterSwitch = {
      book: { 'ch-12': '十二的原稿', 'ch-07': '七的原稿', 'ch-03': '三的原稿' },
      screen: { boundId: 'ch-12', text: '十二改過的字' },
    };
    state = switchChapterDraft(state, 'ch-07');
    expect(state.screen).toEqual({ boundId: 'ch-07', text: '七的原稿' });
    expect(state.book['ch-12']).toBe('十二改過的字');
    expect(state.book['ch-07']).toBe('七的原稿');

    state = switchChapterDraft(state, 'ch-03');
    expect(state.screen).toEqual({ boundId: 'ch-03', text: '三的原稿' });
    expect(state.book['ch-07']).toBe('七的原稿');
    expect(state.book['ch-12']).toBe('十二改過的字');
  });

  it('同一章打字不會被存檔裡的舊字蓋掉', () => {
    expect(
      textForBoundChapter({
        boundChapterId: 'ch-07',
        screenText: '七正在打',
        nextChapterId: 'ch-07',
        storedText: '七的原稿',
      }),
    ).toBe('七正在打');
  });
});
