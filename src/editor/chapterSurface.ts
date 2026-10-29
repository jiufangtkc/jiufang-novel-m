/**
 * 換章時正文框該顯示哪一段字。
 * 錯誤做法是沿用畫面上的字，網址已經是下一章，正文卻還是上一章。
 */
export function textForBoundChapter(input: {
  boundChapterId: string | null;
  screenText: string;
  nextChapterId: string;
  storedText: string;
}): string {
  if (input.boundChapterId === input.nextChapterId) return input.screenText;
  return input.storedText;
}

export interface ChapterSwitch {
  book: Record<string, string>;
  screen: { boundId: string; text: string };
}

/** 離開上一章時把畫面上的字記回那一章，再把正文框換成下一章存著的字。 */
export function switchChapterDraft(state: ChapterSwitch, nextChapterId: string): ChapterSwitch {
  const book = { ...state.book, [state.screen.boundId]: state.screen.text };
  const text = textForBoundChapter({
    boundChapterId: state.screen.boundId,
    screenText: state.screen.text,
    nextChapterId,
    storedText: book[nextChapterId] ?? '',
  });
  return { book, screen: { boundId: nextChapterId, text } };
}
