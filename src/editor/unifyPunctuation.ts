/**
 * WO-139：一鍵統一標點（0.7.0）純文字轉換引擎。
 * 只處理字串，不碰 DOM、store、事件或排版空白規則。
 *
 * 管線順序：
 *   步驟 0：掃描保護區（分隔線、網址、電子郵件、數字與條列、英文語句／縮寫／撇號）
 *   步驟 1：引號（“” → 「」、「‘’」→ 『』、確定成對的 "" → 「」）
 *   步驟 2：刪節號（... / 。。。 / … / ⋯⋯ / 3 個以上 … → ……）
 *   步驟 3：破折號（— / – / ―― / —— / 單個 ─ / 中文句中 -- → ──）
 *   步驟 4：中文句子裡的半形標點（, . ? ! : ; → ，。？！：；）
 *   步驟 5：中文句子裡的波浪號（~ → ～）
 */

export interface UnifyPunctuationResult {
  text: string;
  /** 本次實際統一的標點處數；保證 replacementCount === 0 ⇔ text === input */
  replacementCount: number;
}

type ProtectedTag = 'divider' | 'url' | 'email' | 'list-number' | 'number' | 'english';

interface ProtectedRange {
  start: number;
  end: number;
  tag: ProtectedTag;
}

type Segment =
  | { kind: 'protected'; tag: ProtectedTag; text: string }
  | { kind: 'editable'; text: string };

const HAN_OR_BOPOMOFO = /[\p{Script=Han}\p{Script=Bopomofo}]/u;
const CJK_CONTEXT = /[\p{Script=Han}\p{Script=Bopomofo}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303F\uFF00-\uFFEF\u2026\u2014\u2500]/u;
/** 判斷「這一行是否有中日文語境」（刻意排除英文也常用的 — 與 …，避免誤判純英文行）。 */
const CJK_LANGUAGE_CHAR = /[\p{Script=Han}\p{Script=Bopomofo}\p{Script=Hiragana}\p{Script=Katakana}\u3001-\u3003\u3008-\u3011\u3014-\u301F\uFF01-\uFF5E]/u;
const ASCII_LETTER = /[A-Za-z]/;
const WHITESPACE = /\s/;

const DIVIDER_LINE = /^[ \t　]*[-─—–―]{3,}[ \t　]*$/u;
const URL_PATTERN = /(?:https?:\/\/|www\.)[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/gi;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const LIST_NUMBER_PATTERN = /^[ \t　]*(\d+\.)(?=[ \t]|$)/;

const NUMBER_PREFIX_PATTERNS: readonly RegExp[] = [
  /(?<!\d)\d{1,3}(?:,\d{3})+(?:\.\d+)?(?!\d)/g,
  /\d+(?::\d+)+/g,
  /\d+(?:[ \t]*[–-][ \t]*\d+)+/g,
];
const NUMBER_INCH_PATTERN = /(?<![\d."])\d+(?:\.\d+)?"/g;
const NUMBER_DECIMAL_PATTERN = /\d+(?:\.\d+)+/g;

const EN_WORD = "[A-Za-z]+(?:[’'-][A-Za-z0-9]+)*(?:\\.[A-Za-z0-9]+)*";
const EN_CONN = '(?:[ \\t]+|(?:[ \\t]*(?:[,.:;?!…—–~]|-{2,}|\\.{3,}|["“”‘’])+[ \\t]*)+)';
const EN_MULTI_WORD_PATTERN = new RegExp(
  `${EN_WORD}(?:${EN_CONN}${EN_WORD})+(?:\\.{3,}|[,.:;?!…]+(?:["”’])?|["”’])?`,
  'g',
);

const EN_SINGLE_PATTERNS: readonly RegExp[] = [
  /(?<![A-Za-z0-9])[A-Za-z]+(?:\.[A-Za-z0-9]+)+\.?/g,
  /(?<![A-Za-z])(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|Inc|Ltd|Co|Corp|Fig|No|Vol|pp|approx)\./gi,
  /(?<![A-Za-z0-9])[A-Za-z]+(?:-[A-Za-z0-9]+)+(?![A-Za-z0-9])/g,
  /(?<![A-Za-z])[A-Za-z]+(?:[’'][A-Za-z]+)+(?![A-Za-z])/g,
  /(?<![A-Za-z])[A-Za-z]+s[’'](?=\s|$|[,.?!:;”"」』）)])/g,
  /(?<=^|\s)[‘’']\d{2}s\b/g,
];

const HALF_WIDTH_PUNCT_MAP: Record<string, string> = {
  ',': '，',
  '.': '。',
  '?': '？',
  '!': '！',
  ':': '：',
  ';': '；',
};

function splitLinesPreserve(text: string): { lines: string[]; seps: string[] } {
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

function countCharInSlice(text: string, start: number, end: number, target: string): number {
  let count = 0;
  for (let i = start; i < end; i += 1) {
    if (text[i] === target) count += 1;
  }
  return count;
}

function trimUrlEnd(line: string, start: number, rawEnd: number): number {
  const prefixMatch = /^(?:https?:\/\/|www\.)/i.exec(line.slice(start, rawEnd));
  const minEnd = start + (prefixMatch ? prefixMatch[0].length : 0) + 1;
  let end = rawEnd;
  while (end > start) {
    const ch = line[end - 1] ?? '';
    if (/[,.?!:;]/.test(ch)) {
      end -= 1;
    } else if (ch === ')' && countCharInSlice(line, start, end, '(') < countCharInSlice(line, start, end, ')')) {
      end -= 1;
    } else if (ch === ']' && countCharInSlice(line, start, end, '[') < countCharInSlice(line, start, end, ']')) {
      end -= 1;
    } else {
      break;
    }
  }
  return end >= minEnd ? end : start;
}

function isMultiWordEnglish(text: string): boolean {
  return /[A-Za-z]+[’'-]?[A-Za-z0-9]*(?:[\s,;?!]+|[.:]\s+)[A-Za-z]+/.test(text);
}

function addNonOverlapping(ranges: ProtectedRange[], start: number, end: number, tag: ProtectedTag): boolean {
  if (end <= start) return false;
  for (const r of ranges) {
    if (start < r.end && end > r.start) return false;
  }
  ranges.push({ start, end, tag });
  return true;
}

function addEnglishSpanMerging(ranges: ProtectedRange[], start: number, end: number): boolean {
  if (end <= start) return false;
  let mergedStart = start;
  let mergedEnd = end;
  const toRemove: number[] = [];
  for (let i = 0; i < ranges.length; i += 1) {
    const r = ranges[i]!;
    if (start < r.end && end > r.start) {
      if (r.tag !== 'english') return false;
      mergedStart = Math.min(mergedStart, r.start);
      mergedEnd = Math.max(mergedEnd, r.end);
      toRemove.push(i);
    }
  }
  for (let i = toRemove.length - 1; i >= 0; i -= 1) {
    ranges.splice(toRemove[i]!, 1);
  }
  ranges.push({ start: mergedStart, end: mergedEnd, tag: 'english' });
  return true;
}

function isIndexProtected(ranges: readonly ProtectedRange[], index: number): boolean {
  for (const r of ranges) {
    if (index >= r.start && index < r.end) return true;
  }
  return false;
}

function hasOverlap(ranges: readonly ProtectedRange[], start: number, end: number): boolean {
  for (const r of ranges) {
    if (start < r.end && end > r.start) return true;
  }
  return false;
}

function scanQuotedEnglishRanges(line: string, lineHasCjkLang: boolean, ranges: ProtectedRange[]): void {
  const pairs: ReadonlyArray<[string, string]> = [
    ['"', '"'],
    ['“', '”'],
    ['‘', '’'],
  ];
  for (const [openQ, closeQ] of pairs) {
    const symmetric = openQ === closeQ;
    let i = 0;
    while (i < line.length) {
      if (line[i] !== openQ || isIndexProtected(ranges, i)) {
        i += 1;
        continue;
      }
      if (openQ === '‘' && i > 0 && ASCII_LETTER.test(line[i - 1] ?? '')) {
        i += 1;
        continue;
      }
      let closeIdx = -1;
      for (let j = i + 1; j < line.length; j += 1) {
        if (line[j] !== closeQ || isIndexProtected(ranges, j)) continue;
        if (closeQ === '’' && ASCII_LETTER.test(line[j + 1] ?? '')) continue;
        closeIdx = j;
        break;
      }
      if (closeIdx === -1) break;
      const inner = line.slice(i + 1, closeIdx);
      if (
        !CJK_LANGUAGE_CHAR.test(inner) &&
        ASCII_LETTER.test(inner) &&
        (!lineHasCjkLang || isMultiWordEnglish(inner))
      ) {
        addNonOverlapping(ranges, i, closeIdx + 1, 'english');
        i = closeIdx + 1;
        continue;
      }
      // 對稱直引號 "" 配對後直接跳過該組，避免拿前組的閉引號去配後組的開引號
      i = symmetric ? closeIdx + 1 : i + 1;
    }
  }
}

function scanEnglishMultiWord(line: string, ranges: ProtectedRange[]): void {
  EN_MULTI_WORD_PATTERN.lastIndex = 0;
  let match = EN_MULTI_WORD_PATTERN.exec(line);
  while (match) {
    const start = match.index;
    let end = start + match[0].length;

    // 避免吃進未配對的尾端引號
    const lastCh = line[end - 1] ?? '';
    if (lastCh === '"' || lastCh === '”' || lastCh === '’') {
      const openQ = lastCh === '"' ? '"' : lastCh === '”' ? '“' : '‘';
      const innerSlice = line.slice(start, end - 1);
      if (!innerSlice.includes(openQ)) end -= 1;
    }

    // 尾端若出現 , : ; 且後面緊接著中文字（可隔空白），退還給中文句處理
    while (end > start && /[,:;]/.test(line[end - 1] ?? '')) {
      const rest = line.slice(end).replace(/^[ \t]+/, '');
      if (rest.length > 0 && CJK_CONTEXT.test(rest[0] ?? '')) {
        end -= 1;
      } else {
        break;
      }
    }

    addEnglishSpanMerging(ranges, start, end);
    match = EN_MULTI_WORD_PATTERN.exec(line);
  }
}

function scanRegexRanges(line: string, pattern: RegExp, tag: ProtectedTag, ranges: ProtectedRange[]): void {
  const re = new RegExp(pattern.source, pattern.flags);
  let match = re.exec(line);
  while (match) {
    addNonOverlapping(ranges, match.index, match.index + match[0].length, tag);
    match = re.exec(line);
  }
}

/** 判斷 `nextQuoteIdx` 是否在開啟下一組引號（例如前接冒號、空白後接內文）。 */
function looksLikeOpeningQuote(line: string, nextQuoteIdx: number): boolean {
  const prevCh = line[nextQuoteIdx - 1] ?? '';
  if (prevCh === ':' || prevCh === '：' || prevCh === '=') return true;
  if (/[ \t]/.test(prevCh)) {
    const beforeWsIdx = prevNonWsInLine(line, nextQuoteIdx);
    const beforeWsCh = beforeWsIdx >= 0 ? line[beforeWsIdx] ?? '' : '';
    if (beforeWsCh === ':' || beforeWsCh === '：' || beforeWsCh === '=') return true;
  }
  const nextCh = line[nextQuoteIdx + 1] ?? '';
  const isNextNonClosing = nextCh.length > 0 && !/[ \t,.;!?，。；！？、：:」』）)]/.test(nextCh);
  return /[ \t]/.test(prevCh) && isNextNonClosing;
}

/**
 * 當同行前方已有未閉合直引號時，判斷此 `數字"` 尾端的 `"` 是否為該對話的閉引號。
 * 若確定正在擔任閉引號，就不得鎖進英吋保護區；若同行後方還有對應閉引號（如 `"這台 24" 螢幕不錯"`），則認定為英吋單位。
 */
function isClosingDialogueQuote(line: string, quoteIdx: number, nextQuoteIdx: number): boolean {
  if (nextQuoteIdx === -1) return true;
  const afterText = line.slice(quoteIdx + 1, nextQuoteIdx);
  if (/^[\s,.;!?，。；！？、：:]*$/.test(afterText)) return true;
  if (looksLikeOpeningQuote(line, nextQuoteIdx)) return true;
  if (/^[ \t]*[,.;!?，。；！？、：:]/.test(afterText)) {
    const prevCh = line[nextQuoteIdx - 1] ?? '';
    const nextCh = line[nextQuoteIdx + 1] ?? '';
    const isNextNonClosing = nextCh.length > 0 && !/[ \t,.;!?，。；！？、：:」』）)]/.test(nextCh);
    if (CJK_LANGUAGE_CHAR.test(prevCh) && isNextNonClosing) return true;
  }
  return false;
}

function scanNumberInches(line: string, ranges: ProtectedRange[]): void {
  const quotePositions: number[] = [];
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '"' && !isIndexProtected(ranges, i)) {
      quotePositions.push(i);
    }
  }
  if (quotePositions.length === 0) return;

  const inchCandidateByQuoteIdx = new Map<number, number>();
  const re = new RegExp(NUMBER_INCH_PATTERN.source, NUMBER_INCH_PATTERN.flags);
  let match = re.exec(line);
  while (match) {
    const start = match.index;
    const end = start + match[0].length;
    if (!hasOverlap(ranges, start, end)) {
      inchCandidateByQuoteIdx.set(end - 1, start);
    }
    match = re.exec(line);
  }
  if (inchCandidateByQuoteIdx.size === 0) return;

  let inOpenQuote = false;
  for (let k = 0; k < quotePositions.length; k += 1) {
    const qIdx = quotePositions[k]!;
    const matchStart = inchCandidateByQuoteIdx.get(qIdx);
    if (matchStart === undefined) {
      inOpenQuote = !inOpenQuote;
      continue;
    }
    const nextQuoteIdx = k + 1 < quotePositions.length ? quotePositions[k + 1]! : -1;
    if (inOpenQuote && isClosingDialogueQuote(line, qIdx, nextQuoteIdx)) {
      inOpenQuote = false;
      continue;
    }
    addNonOverlapping(ranges, matchStart, qIdx + 1, 'number');
  }
}

function buildSegments(line: string, lineHasCjkLang: boolean): Segment[] {
  if (line.length === 0) return [];
  if (DIVIDER_LINE.test(line)) {
    return [{ kind: 'protected', tag: 'divider', text: line }];
  }

  const ranges: ProtectedRange[] = [];

  // 2. 網址
  URL_PATTERN.lastIndex = 0;
  let urlMatch = URL_PATTERN.exec(line);
  while (urlMatch) {
    const end = trimUrlEnd(line, urlMatch.index, urlMatch.index + urlMatch[0].length);
    addNonOverlapping(ranges, urlMatch.index, end, 'url');
    urlMatch = URL_PATTERN.exec(line);
  }

  // 3. 電子郵件
  scanRegexRanges(line, EMAIL_PATTERN, 'email', ranges);

  // 4. 段首條列與數字（英吋需先排除對話閉引號，且在一般小數前完整鎖定）
  const listMatch = LIST_NUMBER_PATTERN.exec(line);
  if (listMatch && listMatch[1]) {
    const numStart = listMatch[0].length - listMatch[1].length;
    addNonOverlapping(ranges, numStart, numStart + listMatch[1].length, 'list-number');
  }
  for (const pattern of NUMBER_PREFIX_PATTERNS) {
    scanRegexRanges(line, pattern, 'number', ranges);
  }
  scanNumberInches(line, ranges);
  scanRegexRanges(line, NUMBER_DECIMAL_PATTERN, 'number', ranges);

  // 5. 英文引號片語、多詞句、單詞縮寫與撇號
  scanQuotedEnglishRanges(line, lineHasCjkLang, ranges);
  scanEnglishMultiWord(line, ranges);
  for (const pattern of EN_SINGLE_PATTERNS) {
    // 排除「‘students’」這類前有開單引號的閉引號誤判為所有格撇號
    const re = new RegExp(pattern.source, pattern.flags);
    let match = re.exec(line);
    while (match) {
      const start = match.index;
      if (match[0].endsWith('’') && start > 0 && line[start - 1] === '‘') {
        match = re.exec(line);
        continue;
      }
      addNonOverlapping(ranges, start, start + match[0].length, 'english');
      match = re.exec(line);
    }
  }

  ranges.sort((a, b) => a.start - b.start);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) {
      segments.push({ kind: 'editable', text: line.slice(cursor, r.start) });
    }
    segments.push({ kind: 'protected', tag: r.tag, text: line.slice(r.start, r.end) });
    cursor = r.end;
  }
  if (cursor < line.length) {
    segments.push({ kind: 'editable', text: line.slice(cursor) });
  }
  return segments;
}

function replaceCharAt(str: string, index: number, ch: string): string {
  return str.slice(0, index) + ch + str.slice(index + 1);
}

function applyCurlyQuotes(
  segments: Segment[],
  openChar: string,
  closeChar: string,
  newOpen: string,
  newClose: string,
): number {
  let count = 0;
  const stack: Array<{ segIdx: number; offset: number }> = [];
  for (let segIdx = 0; segIdx < segments.length; segIdx += 1) {
    const seg = segments[segIdx]!;
    if (seg.kind !== 'editable') continue;
    for (let offset = 0; offset < seg.text.length; offset += 1) {
      const ch = seg.text[offset];
      if (ch === openChar) {
        stack.push({ segIdx, offset });
      } else if (ch === closeChar) {
        const opened = stack.pop();
        if (opened) {
          const openSeg = segments[opened.segIdx]!;
          openSeg.text = replaceCharAt(openSeg.text, opened.offset, newOpen);
        }
        seg.text = replaceCharAt(seg.text, offset, newClose);
        count += 1;
      }
    }
  }
  for (const unclosed of stack) {
    const seg = segments[unclosed.segIdx]!;
    seg.text = replaceCharAt(seg.text, unclosed.offset, newOpen);
    count += 1;
  }
  return count;
}

function prevNonWsInLine(line: string, index: number): number {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (!WHITESPACE.test(line[i] ?? '')) return i;
  }
  return -1;
}

function isChineseLeadColon(line: string, openIdx: number): boolean {
  const colonIdx = prevNonWsInLine(line, openIdx);
  if (colonIdx < 0) return false;
  const ch = line[colonIdx];
  if (ch === '：') return true;
  if (ch === ':') {
    const beforeColonIdx = prevNonWsInLine(line, colonIdx);
    return beforeColonIdx >= 0 && CJK_CONTEXT.test(line[beforeColonIdx] ?? '');
  }
  return false;
}

function applyStraightDoubleQuotes(segments: Segment[]): number {
  const positions: Array<{ segIdx: number; offset: number; lineIdx: number }> = [];
  let cursor = 0;
  let fullLine = '';
  for (let segIdx = 0; segIdx < segments.length; segIdx += 1) {
    const seg = segments[segIdx]!;
    fullLine += seg.text;
    if (seg.kind === 'editable') {
      for (let offset = 0; offset < seg.text.length; offset += 1) {
        if (seg.text[offset] === '"') {
          positions.push({ segIdx, offset, lineIdx: cursor + offset });
        }
      }
    }
    cursor += seg.text.length;
  }

  if (positions.length === 0 || positions.length % 2 !== 0) return 0;

  let count = 0;
  for (let k = 0; k < positions.length; k += 2) {
    const open = positions[k]!;
    const close = positions[k + 1]!;
    const inner = fullLine.slice(open.lineIdx + 1, close.lineIdx);
    if (inner.trim().length === 0) continue;

    const prevIdx = prevNonWsInLine(fullLine, open.lineIdx);
    if (prevIdx >= 0 && fullLine[prevIdx] === '=') continue;
    if (inner.includes('=') || inner.includes('</') || inner.includes('/>') || inner.includes('://')) continue;

    const isDialogue = HAN_OR_BOPOMOFO.test(inner) || (isChineseLeadColon(fullLine, open.lineIdx) && !isMultiWordEnglish(inner));
    if (!isDialogue) continue;

    const openSeg = segments[open.segIdx]!;
    const closeSeg = segments[close.segIdx]!;
    openSeg.text = replaceCharAt(openSeg.text, open.offset, '「');
    closeSeg.text = replaceCharAt(closeSeg.text, close.offset, '」');
    count += 1;
  }
  return count;
}

function charBefore(segments: readonly Segment[], segIdx: number, offset: number): string {
  if (offset > 0) return segments[segIdx]!.text[offset - 1] ?? '';
  for (let i = segIdx - 1; i >= 0; i -= 1) {
    const t = segments[i]!.text;
    if (t.length > 0) return t[t.length - 1] ?? '';
  }
  return '';
}

function charAfter(segments: readonly Segment[], segIdx: number, offsetEnd: number): string {
  const cur = segments[segIdx]!.text;
  if (offsetEnd < cur.length) return cur[offsetEnd] ?? '';
  for (let i = segIdx + 1; i < segments.length; i += 1) {
    const t = segments[i]!.text;
    if (t.length > 0) return t[0] ?? '';
  }
  return '';
}

function prevNonWsInfo(
  segments: readonly Segment[],
  segIdx: number,
  offset: number,
): { char: string; tag: ProtectedTag | null; immediate: boolean } {
  let immediate = true;
  for (let i = offset - 1; i >= 0; i -= 1) {
    const ch = segments[segIdx]!.text[i] ?? '';
    if (!WHITESPACE.test(ch)) return { char: ch, tag: null, immediate };
    immediate = false;
  }
  for (let s = segIdx - 1; s >= 0; s -= 1) {
    const seg = segments[s]!;
    for (let i = seg.text.length - 1; i >= 0; i -= 1) {
      const ch = seg.text[i] ?? '';
      if (!WHITESPACE.test(ch)) {
        return { char: ch, tag: seg.kind === 'protected' ? seg.tag : null, immediate };
      }
      immediate = false;
    }
  }
  return { char: '', tag: null, immediate: false };
}

function nextNonWsChar(segments: readonly Segment[], segIdx: number, offset: number): string {
  const cur = segments[segIdx]!.text;
  for (let i = offset + 1; i < cur.length; i += 1) {
    const ch = cur[i] ?? '';
    if (!WHITESPACE.test(ch)) return ch;
  }
  for (let s = segIdx + 1; s < segments.length; s += 1) {
    const t = segments[s]!.text;
    for (let i = 0; i < t.length; i += 1) {
      const ch = t[i] ?? '';
      if (!WHITESPACE.test(ch)) return ch;
    }
  }
  return '';
}

function applyEllipsis(segments: Segment[], lineHasHan: boolean): number {
  let count = 0;
  for (let segIdx = 0; segIdx < segments.length; segIdx += 1) {
    const seg = segments[segIdx]!;
    if (seg.kind !== 'editable') continue;
    const text = seg.text;
    const re = /。{3,}|[…⋯]+|\.{3,}/gu;
    let out = '';
    let last = 0;
    let match = re.exec(text);
    while (match) {
      const mStart = match.index;
      const mStr = match[0];
      const mEnd = mStart + mStr.length;
      let shouldReplace = false;

      if (mStr === '……') {
        shouldReplace = false;
      } else if (mStr.startsWith('。') || mStr[0] === '…' || mStr[0] === '⋯') {
        shouldReplace = true;
      } else {
        // 三個以上半形點 ...
        const before = charBefore(segments, segIdx, mStart);
        const after = charAfter(segments, segIdx, mEnd);
        const beforeLetter = ASCII_LETTER.test(before);
        const afterLetter = ASCII_LETTER.test(after);
        if (beforeLetter && afterLetter) {
          shouldReplace = false;
        } else if (CJK_CONTEXT.test(before) || CJK_CONTEXT.test(after)) {
          shouldReplace = true;
        } else if (lineHasHan && !beforeLetter && !afterLetter) {
          shouldReplace = true;
        }
      }

      if (shouldReplace) {
        out += text.slice(last, mStart) + '……';
        last = mEnd;
        count += 1;
      }
      match = re.exec(text);
    }
    if (last > 0) {
      seg.text = out + text.slice(last);
    }
  }
  return count;
}

function applyDashes(segments: Segment[], lineHasHan: boolean): number {
  let count = 0;
  for (let segIdx = 0; segIdx < segments.length; segIdx += 1) {
    const seg = segments[segIdx]!;
    if (seg.kind !== 'editable') continue;
    const text = seg.text;
    const re = /[—–―─]+|-{2,}/gu;
    let out = '';
    let last = 0;
    let match = re.exec(text);
    while (match) {
      const mStart = match.index;
      const mStr = match[0];
      const mEnd = mStart + mStr.length;
      let shouldReplace = false;

      if (mStr === '──') {
        shouldReplace = false;
      } else if (mStr[0] === '-') {
        const before = charBefore(segments, segIdx, mStart);
        const after = charAfter(segments, segIdx, mEnd);
        shouldReplace = lineHasHan && !ASCII_LETTER.test(before) && !ASCII_LETTER.test(after);
      } else {
        shouldReplace = true;
      }

      if (shouldReplace) {
        out += text.slice(last, mStart) + '──';
        last = mEnd;
        count += 1;
      }
      match = re.exec(text);
    }
    if (last > 0) {
      seg.text = out + text.slice(last);
    }
  }
  return count;
}

function applyHalfWidthPunct(segments: Segment[], lineHasHan: boolean): number {
  let count = 0;
  for (let segIdx = 0; segIdx < segments.length; segIdx += 1) {
    const seg = segments[segIdx]!;
    if (seg.kind !== 'editable') continue;
    for (let i = 0; i < seg.text.length; i += 1) {
      const ch = seg.text[i] ?? '';
      const full = HALF_WIDTH_PUNCT_MAP[ch];
      if (!full) continue;

      const prev = prevNonWsInfo(segments, segIdx, i);
      const next = nextNonWsChar(segments, segIdx, i);
      const immediatePrev = charBefore(segments, segIdx, i);

      const rule4a = CJK_CONTEXT.test(prev.char);
      const rule4b = CJK_CONTEXT.test(next) && !(ch === '.' && ASCII_LETTER.test(immediatePrev));
      const rule4c =
        lineHasHan &&
        prev.immediate &&
        (prev.tag === 'number' ||
          prev.tag === 'url' ||
          prev.tag === 'email' ||
          (/[0-9]/.test(prev.char) && prev.tag !== 'list-number'));

      if (rule4a || rule4b || rule4c) {
        seg.text = replaceCharAt(seg.text, i, full);
        count += 1;
      }
    }
  }
  return count;
}

function applyTildes(segments: Segment[], lineHasHan: boolean): number {
  let count = 0;
  for (let segIdx = 0; segIdx < segments.length; segIdx += 1) {
    const seg = segments[segIdx]!;
    if (seg.kind !== 'editable') continue;
    for (let i = 0; i < seg.text.length; i += 1) {
      if (seg.text[i] !== '~') continue;
      const prev = prevNonWsInfo(segments, segIdx, i);
      const next = nextNonWsChar(segments, segIdx, i);
      const immediatePrev = charBefore(segments, segIdx, i);
      const immediateNext = charAfter(segments, segIdx, i + 1);

      const shouldReplace =
        CJK_CONTEXT.test(prev.char) ||
        CJK_CONTEXT.test(next) ||
        (lineHasHan && !ASCII_LETTER.test(immediatePrev) && !ASCII_LETTER.test(immediateNext));

      if (shouldReplace) {
        seg.text = replaceCharAt(seg.text, i, '～');
        count += 1;
      }
    }
  }
  return count;
}

function processLine(line: string): { line: string; count: number } {
  if (!line) return { line, count: 0 };
  const lineHasHan = HAN_OR_BOPOMOFO.test(line);
  const lineHasCjkLang = CJK_LANGUAGE_CHAR.test(line);
  const segments = buildSegments(line, lineHasCjkLang);

  let count = 0;
  count += applyCurlyQuotes(segments, '“', '”', '「', '」');
  count += applyCurlyQuotes(segments, '‘', '’', '『', '』');
  count += applyStraightDoubleQuotes(segments);
  count += applyEllipsis(segments, lineHasHan);
  count += applyDashes(segments, lineHasHan);
  count += applyHalfWidthPunct(segments, lineHasHan);
  count += applyTildes(segments, lineHasHan);

  if (count === 0) return { line, count: 0 };
  return { line: segments.map((s) => s.text).join(''), count };
}

/**
 * 將正文統一為臺灣出版常用標點，並回傳轉換後正文與實際統一的標點處數。
 * 保證 `replacementCount === 0` 若且唯若回傳 `text === input`，且單次執行即冪等。
 */
export function unifyPunctuation(text: string): UnifyPunctuationResult {
  if (!text) return { text, replacementCount: 0 };
  const { lines, seps } = splitLinesPreserve(text);
  let out = '';
  let replacementCount = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const res = processLine(lines[i]!);
    out += res.line;
    replacementCount += res.count;
    if (i < seps.length) out += seps[i];
  }
  if (replacementCount === 0) return { text, replacementCount: 0 };
  return { text: out, replacementCount };
}
