/**
 * WO-142：寫作頁全形標點列的符號清單與插入計畫（純函式，不碰 DOM）。
 * 破折號一律用 U+2500 ×2、刪節號 U+2026 ×2，與「統一標點」（unifyPunctuation）一致。
 */
import {
  SYMBOL_ARIA_ARTICLE_TITLE,
  SYMBOL_ARIA_BOOK_TITLE,
  SYMBOL_ARIA_COLON,
  SYMBOL_ARIA_COMMA,
  SYMBOL_ARIA_DASH,
  SYMBOL_ARIA_DOUBLE_QUOTE,
  SYMBOL_ARIA_ELLIPSIS,
  SYMBOL_ARIA_ENUM_COMMA,
  SYMBOL_ARIA_EXCLAMATION,
  SYMBOL_ARIA_PERIOD,
  SYMBOL_ARIA_QUESTION,
  SYMBOL_ARIA_QUOTE,
  SYMBOL_ARIA_SEMICOLON,
  SYMBOL_SPACE_ARIA,
  SYMBOL_SPACE_FACE,
  SYMBOL_SPACE_TITLE,
} from '../copy/symbolBarCopy';

export type SymbolGroup = 1 | 2 | 3;

export interface WritingSymbol {
  id: string;
  /** 鍵面文字（成對符號顯示整對）。 */
  face: string;
  ariaLabel: string;
  /** 只有全形空白有：電腦版滑鼠停留提示。 */
  title?: string;
  /** 要插入的文字；成對符號是左半邊。 */
  left: string;
  /** 成對符號的右半邊；單一符號沒有。 */
  right?: string;
  /** 長鍵（空白、刪節號、破折號）。 */
  long: boolean;
  group: SymbolGroup;
}

const single = (id: string, ch: string, ariaLabel: string): WritingSymbol => ({
  id,
  face: ch,
  ariaLabel,
  left: ch,
  long: false,
  group: 1,
});
const pair = (id: string, left: string, right: string, ariaLabel: string): WritingSymbol => ({
  id,
  face: `${left}${right}`,
  ariaLabel,
  left,
  right,
  long: false,
  group: 3,
});

export const WRITING_SYMBOLS: readonly WritingSymbol[] = [
  {
    id: 'ideographic-space',
    face: SYMBOL_SPACE_FACE,
    ariaLabel: SYMBOL_SPACE_ARIA,
    title: SYMBOL_SPACE_TITLE,
    left: '　',
    long: true,
    group: 1,
  },
  single('comma', '，', SYMBOL_ARIA_COMMA),
  single('period', '。', SYMBOL_ARIA_PERIOD),
  single('enum-comma', '、', SYMBOL_ARIA_ENUM_COMMA),
  single('question', '？', SYMBOL_ARIA_QUESTION),
  single('exclamation', '！', SYMBOL_ARIA_EXCLAMATION),
  single('colon', '：', SYMBOL_ARIA_COLON),
  single('semicolon', '；', SYMBOL_ARIA_SEMICOLON),
  {
    id: 'ellipsis',
    face: '……',
    ariaLabel: SYMBOL_ARIA_ELLIPSIS,
    left: '……',
    long: true,
    group: 2,
  },
  {
    id: 'dash',
    face: '──',
    ariaLabel: SYMBOL_ARIA_DASH,
    left: '──',
    long: true,
    group: 2,
  },
  pair('quote', '「', '」', SYMBOL_ARIA_QUOTE),
  pair('double-quote', '『', '』', SYMBOL_ARIA_DOUBLE_QUOTE),
  pair('book-title', '《', '》', SYMBOL_ARIA_BOOK_TITLE),
  pair('article-title', '〈', '〉', SYMBOL_ARIA_ARTICLE_TITLE),
];

export function findWritingSymbol(id: string): WritingSymbol | null {
  return WRITING_SYMBOLS.find((symbol) => symbol.id === id) ?? null;
}

export interface SymbolInsertPlan {
  /** 要取代 [start, end) 的文字。 */
  insertText: string;
  /** 插入後游標位置，相對於 insertText 開頭。 */
  caretOffsetInInsert: number;
  /** 是否為「把選取文字包起來」（成對符號且有選取）。 */
  wrapsSelection: boolean;
}

/**
 * 算出點一顆符號後要插入什麼、游標放哪裡。
 * - 單一符號：取代選取（沒選取就插在游標處），游標在符號之後。
 * - 成對符號、沒選取：插整對，游標停在中間。
 * - 成對符號、有選取：把選取文字包起來，游標移到右符號之後。
 */
export function planSymbolInsert(input: {
  text: string;
  start: number;
  end: number;
  symbol: WritingSymbol;
}): SymbolInsertPlan {
  const { text, symbol } = input;
  const a = Math.max(0, Math.min(input.start, text.length));
  const b = Math.max(a, Math.min(input.end, text.length));
  if (symbol.right === undefined) {
    return { insertText: symbol.left, caretOffsetInInsert: symbol.left.length, wrapsSelection: false };
  }
  if (b > a) {
    const insertText = `${symbol.left}${text.slice(a, b)}${symbol.right}`;
    return { insertText, caretOffsetInInsert: insertText.length, wrapsSelection: true };
  }
  return {
    insertText: `${symbol.left}${symbol.right}`,
    caretOffsetInInsert: symbol.left.length,
    wrapsSelection: false,
  };
}
