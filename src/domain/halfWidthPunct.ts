/**
 * WO-76 乙段：正文半形標點提醒。
 *
 * 只判斷「中文字旁」的半形 , . ? ! : ;，以及三個以上連續的 ...（轉成「……」）。
 * 數字內部（3.5、1,000、12:30）、英文字句（OK, let's go.）、網址不提醒。
 * 這裡只算位置與替換結果，不改字數算法；字數一律交給既有 commit-text。
 */

export type HalfWidthKind = 'comma' | 'period' | 'question' | 'exclamation' | 'colon' | 'semicolon' | 'ellipsis';

export interface HalfWidthMark {
  /** 在正文裡的起點（含）。 */
  start: number;
  /** 在正文裡的終點（不含）。 */
  end: number;
  kind: HalfWidthKind;
  /** 改成全形後的文字。 */
  replacement: string;
}

const FULL: Record<string, { kind: HalfWidthKind; replacement: string }> = {
  ',': { kind: 'comma', replacement: '，' },
  '.': { kind: 'period', replacement: '。' },
  '?': { kind: 'question', replacement: '？' },
  '!': { kind: 'exclamation', replacement: '！' },
  ':': { kind: 'colon', replacement: '：' },
  ';': { kind: 'semicolon', replacement: '；' },
};

const MARK_RUN = /[,.?!:;]+/g;
/** 網址：http(s):// 或 www. 開頭，只取英數與網址常用符號；結尾的標點不算網址。 */
const URL_RUN = /(?:https?:\/\/|www\.)[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/gi;
/** 中文字與全形標點：漢字、注音、日文假名、CJK 符號、全形字元、刪節號、破折號。 */
const CJK = /[\p{Script=Han}\p{Script=Bopomofo}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯…—]/u;

function isCjk(char: string | undefined): boolean {
  return Boolean(char) && CJK.test(char as string);
}

function urlRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const match of text.matchAll(URL_RUN)) {
    const start = match.index ?? 0;
    let end = start + match[0].length;
    while (end > start && /[,.?!:;]/.test(text[end - 1] ?? '')) end -= 1;
    ranges.push([start, end]);
  }
  return ranges;
}

/** 找出這段正文裡要提醒的半形標點。只讀，不改字。 */
export function findHalfWidthMarks(text: string): HalfWidthMark[] {
  if (!text) return [];
  const urls = urlRanges(text);
  const inUrl = (index: number) => urls.some(([from, to]) => index >= from && index < to);
  const marks: HalfWidthMark[] = [];
  for (const match of text.matchAll(MARK_RUN)) {
    const runStart = match.index ?? 0;
    const run = match[0];
    const runEnd = runStart + run.length;
    // 整串都要貼著中文字：前一個字是中文或全形標點；
    // 或後一個字是中文，而前面不是英文字母（英文句尾的標點算英文字句，不提醒）。
    const before = text[runStart - 1];
    const afterWord = /[A-Za-z]/.test(before ?? '') && !inUrl(runStart - 1);
    const afterCjk = isCjk(text[runEnd]) && !afterWord;
    if (!isCjk(before) && !afterCjk) continue;
    let index = runStart;
    while (index < runEnd) {
      if (text[index] === '.') {
        let dots = index;
        while (dots < runEnd && text[dots] === '.') dots += 1;
        if (dots - index >= 3) {
          if (!inUrl(index)) {
            marks.push({ start: index, end: dots, kind: 'ellipsis', replacement: '……' });
          }
          index = dots;
          continue;
        }
      }
      const char = text[index] ?? '';
      const full = FULL[char];
      if (full && !inUrl(index)) {
        marks.push({ start: index, end: index + 1, kind: full.kind, replacement: full.replacement });
      }
      index += 1;
    }
  }
  return marks;
}

export interface HalfWidthConversion {
  text: string;
  caret: number;
  count: number;
}

/** 依原本的游標位置，算出替換後游標該留在哪裡（留在原本那個字旁邊）。 */
export function caretAfterReplace(marks: readonly HalfWidthMark[], caret: number): number {
  let shift = 0;
  for (const mark of marks) {
    if (mark.end <= caret) {
      shift += mark.replacement.length - (mark.end - mark.start);
    } else if (mark.start < caret) {
      // 游標夾在連續點號中間：放到換好的刪節號後面。
      shift += mark.start + mark.replacement.length - caret;
    }
  }
  return Math.max(0, caret + shift);
}

/** 把指定的半形標點換成全形。marks 必須來自同一段正文。 */
export function applyHalfWidthMarks(
  text: string,
  marks: readonly HalfWidthMark[],
  caret: number,
): HalfWidthConversion {
  const sorted = [...marks].sort((a, b) => a.start - b.start);
  let out = '';
  let last = 0;
  for (const mark of sorted) {
    if (mark.start < last) continue;
    out += text.slice(last, mark.start) + mark.replacement;
    last = mark.end;
  }
  out += text.slice(last);
  return { text: out, caret: caretAfterReplace(sorted, caret), count: sorted.length };
}

/** 一次改完這一章所有要提醒的半形標點。 */
export function convertHalfWidthInChapter(text: string, caret: number): HalfWidthConversion {
  return applyHalfWidthMarks(text, findHalfWidthMarks(text), caret);
}

/** 游標正好落在某個要提醒的標點旁邊（前面或後面）時，回傳那一個。 */
export function markAtCaret(marks: readonly HalfWidthMark[], caret: number): HalfWidthMark | null {
  for (const mark of marks) {
    if (caret >= mark.start && caret <= mark.end) return mark;
  }
  return null;
}

/**
 * 正文改了一小段（打字、組字中），先把舊的底線位置跟著平移，不重新檢查。
 * 改到的那一段裡面的底線先拿掉，等停筆再檢查。
 */
export function shiftMarksForEdit(
  marks: readonly HalfWidthMark[],
  before: string,
  after: string,
): HalfWidthMark[] {
  if (before === after) return [...marks];
  let start = 0;
  const min = Math.min(before.length, after.length);
  while (start < min && before[start] === after[start]) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const delta = endAfter - endBefore;
  const out: HalfWidthMark[] = [];
  for (const mark of marks) {
    if (mark.end <= start) out.push(mark);
    else if (mark.start >= endBefore) out.push({ ...mark, start: mark.start + delta, end: mark.end + delta });
  }
  return out;
}

const KIND_NAME: Record<HalfWidthKind, string> = {
  comma: '逗號',
  period: '句號',
  question: '問號',
  exclamation: '驚嘆號',
  colon: '冒號',
  semicolon: '分號',
  ellipsis: '刪節號',
};

export function halfWidthKindName(kind: HalfWidthKind): string {
  return KIND_NAME[kind];
}
