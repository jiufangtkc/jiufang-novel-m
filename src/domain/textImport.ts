import { resolvedBookTitle } from './bookTitle';

/**
 * WO-99：檔案頁「匯入文字檔」用的純函式。
 *
 * - 解碼：用位元組判斷，不靠 File.text() 猜編碼。先擋 UTF-16／UTF-32 BOM，
 *   UTF-8（含 BOM）嚴格解碼；不是合法 UTF-8 時，再試嚴格的 Big5。
 *   解出來還要通過簡單合理性檢查（不准 NUL、異常控制字元），擋掉二進位檔。
 * - 換行：CRLF、單獨 CR 一律換成 LF，其餘文字不動。
 * - 分章：一行一行線性掃描，認整行的保守章名格式（WO-125 放寬），詳見 chapterHeadingTitle。
 */

export type TextEncodingName = 'utf-8' | 'big5';

export type DecodeTextResult =
  | { ok: true; text: string; encoding: TextEncodingName }
  | { ok: false; reason: 'unsupported-bom' | 'undecodable' | 'binary' };

/** 拿得到就回傳嚴格（fatal）解碼器，執行環境不支援這個編碼時回傳 null。 */
export type StrictDecoderFactory = (label: TextEncodingName) => { decode(bytes: Uint8Array): string } | null;

export const defaultStrictDecoder: StrictDecoderFactory = (label) => {
  try {
    // ignoreBOM：BOM 由我們自己判斷、自己去掉，不讓解碼器暗中處理。
    return new TextDecoder(label, { fatal: true, ignoreBOM: true });
  } catch {
    return null;
  }
};

/** 目前執行環境能不能嚴格解 Big5（交接記錄用，也給測試核對）。 */
export function supportsStrictBig5(factory: StrictDecoderFactory = defaultStrictDecoder): boolean {
  const decoder = factory('big5');
  if (!decoder) return false;
  try {
    // 「中文」的 Big5 位元組。
    return decoder.decode(new Uint8Array([0xa4, 0xa4, 0xa4, 0xe5])) === '中文';
  } catch {
    return false;
  }
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.byteLength < prefix.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (bytes[index] !== prefix[index]) return false;
  }
  return true;
}

/**
 * 正文不該出現的控制字元：NUL 與其他 C0（定位、換行、換頁、歸位除外）、DEL、C1。
 * 出現就當成二進位或解錯編碼，不匯入。
 */
const SUSPICIOUS_CONTROL = /[\u0000-\u0008\u000b\u000e-\u001f\u007f-\u009f]/;

function looksLikeText(text: string, allowReplacement: boolean): boolean {
  if (SUSPICIOUS_CONTROL.test(text)) return false;
  // Big5 解出替代字元代表有位元組對不上，不接受。UTF-8 嚴格解碼本來就不會產生替代字元，
  // 原文若真的寫著 U+FFFD 就照留。
  if (!allowReplacement && text.includes('�')) return false;
  return true;
}

function tryDecode(
  factory: StrictDecoderFactory,
  label: TextEncodingName,
  bytes: Uint8Array,
): string | null {
  const decoder = factory(label);
  if (!decoder) return null;
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

export function decodeTextBytes(
  bytes: Uint8Array,
  factory: StrictDecoderFactory = defaultStrictDecoder,
): DecodeTextResult {
  // UTF-32 LE（FF FE 00 00）也以 FF FE 開頭，一起擋下。
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff]) || startsWith(bytes, [0x00, 0x00, 0xfe, 0xff])) {
    return { ok: false, reason: 'unsupported-bom' };
  }
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) {
    // 有 UTF-8 BOM 就只照 UTF-8 解，解不出來不改猜 Big5。
    const text = tryDecode(factory, 'utf-8', bytes.subarray(3));
    if (text === null) return { ok: false, reason: 'undecodable' };
    if (!looksLikeText(text, true)) return { ok: false, reason: 'binary' };
    return { ok: true, text, encoding: 'utf-8' };
  }
  const utf8 = tryDecode(factory, 'utf-8', bytes);
  if (utf8 !== null) {
    if (!looksLikeText(utf8, true)) return { ok: false, reason: 'binary' };
    return { ok: true, text: utf8, encoding: 'utf-8' };
  }
  const big5 = tryDecode(factory, 'big5', bytes);
  if (big5 === null) return { ok: false, reason: 'undecodable' };
  if (!looksLikeText(big5, false)) return { ok: false, reason: 'binary' };
  return { ok: true, text: big5, encoding: 'big5' };
}

/** CRLF、單獨 CR 都換成 LF。其他字一個都不動。 */
export function normalizeNewlines(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
}

/** 章名整行（去頭尾空白後）最多幾個 Unicode 碼點。 */
export const CHAPTER_HEADING_MAX_CODE_POINTS = 80;

/**
 * WO-125：章名樣式。全部只比對「去頭尾空白後的整行」，從行首開始；
 * 字元類別彼此不重疊，對單行（最多 80 碼點）不會有高回溯。
 */
const NUMERALS = '0-9０-９零〇一二三四五六七八九十百千兩壹貳參叁肆伍陸柒捌玖拾佰仟廿卅';
/** 「第」可省略；有「第」時，第與數字、數字與單位之間可有半形／全形空白。「部」「篇」「幕」一律不收。 */
const NUMBERED_PATTERN = new RegExp(`^(?:第[ 　]*[${NUMERALS}]+[ 　]*|[${NUMERALS}]+)[章節回話集]`);
/** 卷名：只當同層的一章，不建卷節點。 */
const VOLUME_PATTERN = new RegExp(`^(?:第[ 　]*[${NUMERALS}]+[ 　]*卷|卷[ 　]*[${NUMERALS}]+|[上中下]卷)`);
const SPECIAL_PATTERN = new RegExp(
  `^(?:序章|序言|楔子|引子|前言|尾聲|後記|番外|外傳|終章|附錄)(?:之[\\s\\S]+|[${NUMERALS}]*(?:$|[\\s\\p{P}\\p{S}]))`,
  'u',
);
/** 英文章名與井號編號：數字後可直接接標題（`Chapter 1夜雨`、`＃1夜雨`），數字後直接接全形逗號 `，`、分號 `；;` 視為正文；半形逗號 `,` 是英文標題的合法分隔（`Chapter 1, The Beginning`）。 */
const ENGLISH_PATTERN = /^(?:Chapter|CHAPTER|Ch\.?)[ \t　]*[0-9０-９]+(?![0-9０-９])(?:$|[^，；;])/;
const HASH_PATTERN = /^[#＃][0-9０-９]+(?![0-9０-９])(?:$|[^，；;])/;

const BRACKET_CLOSE: Readonly<Record<string, string>> = { '【': '】', '[': ']', '［': '］' };
/** 單位後有明確分隔時直接放行的第一個字：空白、冒號、頓號、短橫／破折號、間隔號、開括號。 */
const EXPLICIT_SEPARATORS = ' \t　：:、-－—–·（(【「《';
/** 單位後無分隔而直接接短標題時，接續文字第一個字若是這些虛詞，視為正文。 */
const PROSE_CONTINUATIONS = '的得地都了就也還在是有和與把被會要能後時裡里中到過來去給跟比很更不沒再才已卻';

/** 章名核心之後的剩餘文字能不能接成標題。 */
function validHeadingTail(rest: string, afterClosingBracket = false): boolean {
  if (rest === '') return true;
  const first = rest[0];
  if (EXPLICIT_SEPARATORS.includes(first)) return true;
  // 直接接短標題：必須是文字或數字開頭（擋掉「第三章，她…」）。
  if (!/^[\p{L}\p{N}]/u.test(rest)) return false;
  // 閉括號本身就是邊界，不套用單位後無分隔的虛詞限制（`【第一章】不速之客`）。
  return afterClosingBracket || !PROSE_CONTINUATIONS.includes(first);
}

/** 「第？數字單位」的核心長度；不合或遇到「節課」「集合」「集和」回傳 -1。 */
function numberedCoreLength(text: string): number {
  const match = NUMBERED_PATTERN.exec(text);
  if (!match) return -1;
  const core = match[0];
  const unit = core[core.length - 1];
  const next = text[core.length];
  if (unit === '節' && next === '課') return -1;
  if (unit === '集' && (next === '合' || next === '和')) return -1;
  return core.length;
}

function isChapterHeading(text: string): boolean {
  const close = BRACKET_CLOSE[text[0]];
  if (close !== undefined) {
    const inner = text.slice(1);
    const length = numberedCoreLength(inner);
    if (length < 0 || inner[length] !== close) return false;
    return validHeadingTail(inner.slice(length + 1), true);
  }
  const length = numberedCoreLength(text);
  if (length >= 0) return validHeadingTail(text.slice(length));
  const volume = VOLUME_PATTERN.exec(text);
  if (volume) return validHeadingTail(text.slice(volume[0].length));
  return SPECIAL_PATTERN.test(text) || ENGLISH_PATTERN.test(text) || HASH_PATTERN.test(text);
}

function withinCodePoints(text: string, max: number): boolean {
  if (text.length <= max) return true;
  // 一個碼點最多兩個 UTF-16 單位。
  if (text.length > max * 2) return false;
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    // 高位代理後面接低位代理，合起來算一個碼點。
    if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
    }
    count += 1;
    if (count > max) return false;
  }
  return true;
}

/**
 * 這一行是合格章名就回傳章名（整行去頭尾空白），否則回傳 null。
 * 先去頭尾空白、擋超過 80 碼點與句尾 。？！，再依 isChapterHeading 比對各類章名。
 */
export function chapterHeadingTitle(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  if (!withinCodePoints(trimmed, CHAPTER_HEADING_MAX_CODE_POINTS)) return null;
  const last = trimmed[trimmed.length - 1];
  if (last === '。' || last === '？' || last === '！') return null;
  return isChapterHeading(trimmed) ? trimmed : null;
}

/** 一行是章名就回傳章名（去頭尾空白），否則 null。 */
export type HeadingMatcher = (line: string) => string | null;

export interface SplitChapter {
  title: string;
  content: string;
}

export interface SplitOptions {
  /** 章名前有非空白文字時，最前面那一章的章名。 */
  prefaceTitle: string;
  /** 全文沒有章名時那一章的章名。 */
  defaultTitle: string;
}

/**
 * 逐行掃描的狀態機。同步版與分批版共用，保證兩者結果一樣。
 * 正文用原文切片組成，不整段 trim，縮排、空行與尾端文字都保留；章名那一行不重複放進正文。
 */
class ChapterScanner {
  private readonly text: string;
  private readonly options: SplitOptions;
  private readonly matcher: HeadingMatcher;
  /** WO-126：實際命中的章名行數。 */
  hits = 0;
  private position = 0;
  private bodyStart = 0;
  private currentTitle: string | null = null;
  private readonly chapters: SplitChapter[] = [];
  /** 第一個章名之前的文字（不含章名前那個換行）；null 代表章名就在第一行。 */
  private prefix: string | null = null;

  constructor(text: string, options: SplitOptions, matcher: HeadingMatcher = chapterHeadingTitle) {
    this.text = text;
    this.options = options;
    this.matcher = matcher;
  }

  /** 有命中且第一個章名前有非空白文字（會補前言）。掃完才準。 */
  get hasPreface(): boolean {
    return this.currentTitle !== null && this.prefix !== null && /\S/.test(this.prefix);
  }

  get done(): boolean {
    return this.position > this.text.length;
  }

  /** 最多處理 maxLines 行，回傳實際處理幾行。 */
  step(maxLines: number): number {
    const { text } = this;
    let handled = 0;
    while (handled < maxLines && this.position <= text.length) {
      const lineStart = this.position;
      const newline = text.indexOf('\n', lineStart);
      const lineEnd = newline === -1 ? text.length : newline;
      const title = this.matcher(text.slice(lineStart, lineEnd));
      if (title !== null) {
        this.hits += 1;
        // 章名前那個換行屬於分隔，不算進上一章正文。
        const body = lineStart > this.bodyStart ? text.slice(this.bodyStart, lineStart - 1) : '';
        if (this.currentTitle === null) {
          this.prefix = lineStart > 0 ? body : null;
        } else {
          this.chapters.push({ title: this.currentTitle, content: body });
        }
        this.currentTitle = title;
        this.bodyStart = lineEnd + 1;
      }
      this.position = lineEnd + 1;
      handled += 1;
    }
    return handled;
  }

  result(): SplitChapter[] {
    const { text, options } = this;
    if (this.currentTitle === null) {
      // 整份沒有章名：全文放成一章（空檔也一樣）。
      return [{ title: options.defaultTitle, content: text }];
    }
    const lastBody = this.bodyStart <= text.length ? text.slice(this.bodyStart) : '';
    const chapters = [...this.chapters, { title: this.currentTitle, content: lastBody }];
    if (this.prefix === null) return chapters;
    if (/\S/.test(this.prefix)) {
      return [{ title: options.prefaceTitle, content: this.prefix }, ...chapters];
    }
    // 前面只有空白：不另建前言，空白連同原本的換行留在第一章正文最前面。
    const [first, ...rest] = chapters;
    return [{ ...first, content: `${this.prefix}\n${first.content}` }, ...rest];
  }
}

/** 同步分章。text 必須已經統一成 LF。 */
export function splitChapters(text: string, options: SplitOptions): SplitChapter[] {
  const scanner = new ChapterScanner(text, options);
  while (!scanner.done) scanner.step(Number.MAX_SAFE_INTEGER);
  return scanner.result();
}

/** 分批分章：每處理 linesPerBatch 行就呼叫一次 yieldToUi，讓畫面有機會更新。 */
export async function splitChaptersInBatches(
  text: string,
  options: SplitOptions,
  yieldToUi: () => Promise<void>,
  linesPerBatch = 5000,
): Promise<SplitChapter[]> {
  const scanner = new ChapterScanner(text, options);
  while (!scanner.done) {
    scanner.step(linesPerBatch);
    if (!scanner.done) await yieldToUi();
  }
  return scanner.result();
}

/**
 * WO-126：作家打一個章名例子，依樣比對。
 *
 * 例子去頭尾空白後拆成「字面片段」與「數字組」；數字組可換成任何一段數字字元（半形、全形、國字、大寫）。
 * 全程用字面比對，不把例子當成正規表示式。
 */
const NUMERAL_CHARS = new Set('0123456789０１２３４５６７８９零〇一二三四五六七八九十百千兩壹貳參叁肆伍陸柒捌玖拾佰仟廿卅');

type ExamplePart = { kind: 'literal'; text: string } | { kind: 'number' };

const CLOSE_TO_OPEN: Readonly<Record<string, string>> = {
  '】': '【',
  ']': '[',
  '］': '［',
  '）': '（',
  ')': '(',
  '」': '「',
  '』': '『',
  '》': '《',
};

export interface ChapterExample {
  parts: ExamplePart[];
  /** 核心最後一段是已成對的閉括號：括號本身就是邊界。 */
  endsWithClosedBracket: boolean;
  /** 英文章名或井號數字：半形逗號 , 是合法分隔。 */
  allowsAsciiComma: boolean;
}

/** 解析例子；空白或無效（多行、沒有數字組、沒有非空白字面、以「幕」作數字單位）回傳 null。 */
export function parseChapterExample(raw: string): ChapterExample | null {
  const example = raw.trim();
  if (example === '' || /[\r\n\u2028\u2029]/.test(example)) return null;
  const parts: ExamplePart[] = [];
  for (const char of example) {
    const last = parts[parts.length - 1];
    if (NUMERAL_CHARS.has(char)) {
      if (!last || last.kind !== 'number') parts.push({ kind: 'number' });
    } else if (last && last.kind === 'literal') {
      last.text += char;
    } else {
      parts.push({ kind: 'literal', text: char });
    }
  }
  if (!parts.some((part) => part.kind === 'number')) return null;
  if (!parts.some((part) => part.kind === 'literal' && /\S/.test(part.text))) return null;
  // 幕是章的下層：數字組後（可有空白）接「幕」的例子不當章名。
  for (let index = 0; index < parts.length - 1; index += 1) {
    const next = parts[index + 1];
    if (parts[index].kind === 'number' && next.kind === 'literal' && next.text.trimStart().startsWith('幕')) {
      return null;
    }
  }
  const first = parts[0];
  const last = parts[parts.length - 1];
  let endsWithClosedBracket = false;
  if (last.kind === 'literal') {
    const opener = CLOSE_TO_OPEN[last.text[last.text.length - 1]];
    endsWithClosedBracket = opener !== undefined && example.includes(opener);
  }
  return {
    parts,
    endsWithClosedBracket,
    allowsAsciiComma: first.kind === 'literal' && /^[A-Za-z#＃]/.test(first.text) && last.kind === 'number',
  };
}

/** 從行首比對例子核心，回傳核心長度；對不上回傳 -1。數字組一律吃完整段，不回頭縮短。 */
function exampleCoreLength(line: string, parts: readonly ExamplePart[]): number {
  let position = 0;
  for (const part of parts) {
    if (part.kind === 'literal') {
      if (!line.startsWith(part.text, position)) return -1;
      position += part.text.length;
    } else {
      const start = position;
      while (position < line.length && NUMERAL_CHARS.has(line[position])) position += 1;
      if (position === start) return -1;
    }
  }
  return position;
}

function exampleHeadingTitle(line: string, example: ChapterExample): string | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  if (!withinCodePoints(trimmed, CHAPTER_HEADING_MAX_CODE_POINTS)) return null;
  const end = trimmed[trimmed.length - 1];
  if (end === '。' || end === '？' || end === '！') return null;
  const length = exampleCoreLength(trimmed, example.parts);
  if (length < 0) return null;
  const rest = trimmed.slice(length);
  const lastPart = example.parts[example.parts.length - 1];
  if (lastPart.kind === 'literal' && rest !== '') {
    const unit = lastPart.text[lastPart.text.length - 1];
    if (unit === '節' && rest[0] === '課') return null;
    if (unit === '集' && (rest[0] === '合' || rest[0] === '和')) return null;
  }
  if (example.allowsAsciiComma && rest[0] === ',') return trimmed;
  return validHeadingTail(rest, example.endsWithClosedBracket) ? trimmed : null;
}

/** 例子留白 → WO-125 自動規則；有例子 → 依例子比對；例子無效 → 一行都不中（不回退自動規則）。 */
export function exampleHeadingMatcher(rawExample: string): HeadingMatcher {
  if (rawExample.trim() === '') return chapterHeadingTitle;
  const example = parseChapterExample(rawExample);
  if (!example) return () => null;
  return (line) => exampleHeadingTitle(line, example);
}

export interface ChapterSplitResult {
  chapters: SplitChapter[];
  /** 實際命中的章名行數（0 代表全文放進預設的一章）。 */
  hits: number;
  /** 有命中，且章名前有非空白文字而補了「前言」。 */
  prefaceAdded: boolean;
}

function scannerResult(scanner: ChapterScanner): ChapterSplitResult {
  return { chapters: scanner.result(), hits: scanner.hits, prefaceAdded: scanner.hits > 0 && scanner.hasPreface };
}

/** 同步：依例子（可留白）分章，附命中數。text 必須已統一成 LF。 */
export function splitChaptersByExample(text: string, example: string, options: SplitOptions): ChapterSplitResult {
  const scanner = new ChapterScanner(text, options, exampleHeadingMatcher(example));
  while (!scanner.done) scanner.step(Number.MAX_SAFE_INTEGER);
  return scannerResult(scanner);
}

/** 分批：依例子（可留白）分章，附命中數；每 linesPerBatch 行讓出一次畫面。 */
export async function splitChaptersByExampleInBatches(
  text: string,
  example: string,
  options: SplitOptions,
  yieldToUi: () => Promise<void>,
  linesPerBatch = 5000,
): Promise<ChapterSplitResult> {
  const scanner = new ChapterScanner(text, options, exampleHeadingMatcher(example));
  while (!scanner.done) {
    scanner.step(linesPerBatch);
    if (!scanner.done) await yieldToUi();
  }
  return scannerResult(scanner);
}

/** 不分章：整份文字（含章名行、前言、縮排與尾端空白）放成一章。 */
export function wholeTextAsOneChapter(text: string, options: SplitOptions): SplitChapter[] {
  return [{ title: options.defaultTitle, content: text }];
}

/**
 * 書名用檔名去掉結尾的 .txt（大小寫都可），再照新稿子書名規則（40 個完整字元、空名用「未命名稿子」）。
 * 檔名只當一般文字，不拆路徑。
 */
export function importTitleFromFilename(filename: string): string {
  return resolvedBookTitle(filename.replace(/\.txt$/i, ''));
}
