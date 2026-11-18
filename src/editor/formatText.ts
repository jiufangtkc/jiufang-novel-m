/**
 * WO-122：寫作頁排版小工具的三種純文字轉換。
 * 只處理字串，不碰 DOM、store 或任何輸入事件。
 *
 * 共通定義：每一個非空文字行就是一段（單一換行也換段）。
 * 換行支援 LF 與 CRLF；單獨 CR 視為行內字元。空行 = 空字串或只含 U+0020、U+3000、Tab、CR 的行。
 */

export type FormatKind = 'indent' | 'strip-blank' | 'space-paragraphs';

export const FORMAT_KINDS: readonly FormatKind[] = ['indent', 'strip-blank', 'space-paragraphs'];

const INDENT = '　　';
const BLANK_LINE = /^[ 　\t\r]*$/u;
const LEADING_SPACE = /^[ 　\t]+/u;

interface SplitText {
  lines: string[];
  /** seps[i] 是 lines[i] 與 lines[i + 1] 之間原本的換行符號（LF 或 CRLF） */
  seps: string[];
}

/** 拆成「行文字」與「換行符號」，兩者分開保存，之後不用 trim 全文。 */
export function splitLines(text: string): SplitText {
  const lines: string[] = [];
  const seps: string[] = [];
  const pattern = /\r\n|\n/gu;
  let start = 0;
  let match = pattern.exec(text);
  while (match) {
    lines.push(text.slice(start, match.index));
    seps.push(match[0]);
    start = match.index + match[0].length;
    match = pattern.exec(text);
  }
  lines.push(text.slice(start));
  return { lines, seps };
}

export function isBlankLine(line: string): boolean {
  return BLANK_LINE.test(line);
}

/** 新增換行沿用這段正文第一個換行的型式；沒有換行就用 LF。 */
function preferredBreak(seps: readonly string[]): string {
  return seps[0] ?? '\n';
}

/** (a) 每個非空行的段首空白改成剛好兩個全形空格；空行原樣保留。 */
function indentParagraphs(text: string): string {
  const { lines, seps } = splitLines(text);
  let out = '';
  lines.forEach((line, index) => {
    out += isBlankLine(line) ? line : INDENT + line.replace(LEADING_SPACE, '');
    if (index < seps.length) out += seps[index];
  });
  return out;
}

/** (b) 刪除所有空行；保留行以前一非空行後的第一個換行符號相連。 */
function stripBlankLines(text: string): string {
  const { lines, seps } = splitLines(text);
  let out = '';
  let previous = -1;
  lines.forEach((line, index) => {
    if (isBlankLine(line)) return;
    if (previous >= 0) out += seps[previous];
    out += line;
    previous = index;
  });
  return out;
}

/** (c) 非空行之間剛好留一個內容為空字串的空行；章首章尾空行去掉。 */
function spaceParagraphs(text: string): string {
  const { lines, seps } = splitLines(text);
  const extra = preferredBreak(seps);
  let out = '';
  let previous = -1;
  lines.forEach((line, index) => {
    if (isBlankLine(line)) return;
    if (previous >= 0) {
      // 相鄰（只有單一換行）：補一個換行；中間有一個以上空行：只留最前面兩個原換行符號。
      out += index === previous + 1 ? seps[previous] + extra : seps[previous] + seps[previous + 1];
    }
    out += line;
    previous = index;
  });
  return out;
}

export function formatText(kind: FormatKind, text: string): string {
  switch (kind) {
    case 'indent':
      return indentParagraphs(text);
    case 'strip-blank':
      return stripBlankLines(text);
    case 'space-paragraphs':
      return spaceParagraphs(text);
  }
}
