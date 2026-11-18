import { resolvedBookTitle } from './bookTitle';

/**
 * WO-99：檔案頁「匯入文字檔」用的純函式。
 *
 * - 解碼：用位元組判斷，不靠 File.text() 猜編碼。先擋 UTF-16／UTF-32 BOM，
 *   UTF-8（含 BOM）嚴格解碼；不是合法 UTF-8 時，再試嚴格的 Big5。
 *   解出來還要通過簡單合理性檢查（不准 NUL、異常控制字元），擋掉二進位檔。
 * - 換行：CRLF、單獨 CR 一律換成 LF，其餘文字不動。
 * - 分章：一行一行線性掃描，只認行首的保守章名格式，詳見 chapterHeadingTitle。
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
 * 「第」＋數字＋「章」，第與數字、數字與章之間可有半形／全形空白；
 * 「章」後面必須是行尾，或至少一個半形／全形空白或定位字元再接標題。
 * 字元類別彼此不重疊，對單行（最多 80 碼點）不會有高回溯。
 */
const HEADING_PATTERN = /^第[ 　]*[0-9０-９零〇一二三四五六七八九十百千兩]+[ 　]*章(?:[ \t　][\s\S]*)?$/;

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

/** 這一行是合格章名就回傳章名（整行去頭尾空白），否則回傳 null。 */
export function chapterHeadingTitle(line: string): string | null {
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    if (char !== ' ' && char !== '\t' && char !== '　') break;
    index += 1;
  }
  if (line[index] !== '第') return null;
  const trimmed = line.trim();
  if (!withinCodePoints(trimmed, CHAPTER_HEADING_MAX_CODE_POINTS)) return null;
  return HEADING_PATTERN.test(trimmed) ? trimmed : null;
}

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
  private position = 0;
  private bodyStart = 0;
  private currentTitle: string | null = null;
  private readonly chapters: SplitChapter[] = [];
  /** 第一個章名之前的文字（不含章名前那個換行）；null 代表章名就在第一行。 */
  private prefix: string | null = null;

  constructor(text: string, options: SplitOptions) {
    this.text = text;
    this.options = options;
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
      const title = chapterHeadingTitle(text.slice(lineStart, lineEnd));
      if (title !== null) {
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
 * 書名用檔名去掉結尾的 .txt（大小寫都可），再照新稿子書名規則（40 個完整字元、空名用「未命名稿子」）。
 * 檔名只當一般文字，不拆路徑。
 */
export function importTitleFromFilename(filename: string): string {
  return resolvedBookTitle(filename.replace(/\.txt$/i, ''));
}
