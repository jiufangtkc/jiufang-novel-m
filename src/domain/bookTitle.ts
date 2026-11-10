/** 書名最多 40 字。中文字、標點、英文字母、表情符號都算 1 字。 */
export const BOOK_TITLE_MAX = 40;

/** 打到這個字數才顯示「38／40」。 */
export const BOOK_TITLE_COUNT_FROM = 35;

/**
 * 檔名的書名部分最多 200 位元組（UTF-8），留空間給另存的 _YYYYMMDD-HHMM.db（17 位元組）
 * 與系統自動加上的同名序號，確保整個檔名不超過 255 位元組。
 */
export const FILENAME_MAX_BYTES = 200;

const FILENAME_MAX_CHARS = 80;

/** Windows 保留名稱後面加上的字（甲案：加「稿」）。 */
export const RESERVED_NAME_SUFFIX = '稿';

const ILLEGAL_FILENAME = /[/\\:*?"<>|]/g;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const DANGLING_JOINER_OR_SELECTOR = /^[\u200d\ufe0f]+|\u200d[\u200d\ufe0f]*$/g;
const RESERVED_BASENAME = /^(con|prn|aux|nul|(com|lpt)[1-9\u00b9\u00b2\u00b3])$/i;
const PREVIOUS_RESERVED_BASENAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

const FALLBACK_GRAPHEME_CLUSTER = new RegExp(
  [
    '\\r\\n',
    '\\p{Regional_Indicator}{2}',
    '[0-9#*]\\uFE0F?\\u20E3',
    '\\p{Extended_Pictographic}[\\p{Mark}\\p{Emoji_Modifier}\\p{Variation_Selector}\\u{E0020}-\\u{E007F}]*(?:\\u200D\\p{Extended_Pictographic}[\\p{Mark}\\p{Emoji_Modifier}\\p{Variation_Selector}\\u{E0020}-\\u{E007F}]*)*[\\p{Mark}\\p{Variation_Selector}\\u200D]*',
    '[\\s\\S][\\p{Mark}\\p{Variation_Selector}]*',
  ].join('|'),
  'gu',
);

const utf8Encoder = new TextEncoder();

const FULLWIDTH_FILENAME: Record<string, string> = {
  '/': '／',
  '\\': '＼',
  ':': '：',
  '*': '＊',
  '?': '？',
  '"': '＂',
  '<': '＜',
  '>': '＞',
  '|': '｜',
};

export type TitleSavePending = 'export' | 'resave' | null;

export interface BookFileMark {
  titleInFile: string | null;
  hasExternalFile: boolean;
  titleSavePending: TitleSavePending;
}

export interface BookFileMemory {
  title: string;
  filename?: string | null;
  hasExternalFile?: boolean;
  titleInFile?: string | null;
  titleSavePending?: TitleSavePending;
}

/** 一個完整字元算 1。家庭這種組合表情不要從中間切開。 */
function textUnits(value: string): string[] {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return [...segmenter.segment(value)].map((part) => part.segment);
  }
  return value.match(FALLBACK_GRAPHEME_CLUSTER) ?? [];
}

export function countBookTitle(value: string): number {
  return textUnits(value).length;
}

export function clipBookTitle(value: string): { text: string; truncated: boolean } {
  const chars = textUnits(value);
  if (chars.length <= BOOK_TITLE_MAX) return { text: value, truncated: false };
  return { text: chars.slice(0, BOOK_TITLE_MAX).join(''), truncated: true };
}

/** 留白或只打空白，書名用「未命名稿子」。 */
export function resolvedBookTitle(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '未命名稿子';
  return clipBookTitle(trimmed).text;
}

function utf8ByteLength(value: string): number {
  return utf8Encoder.encode(value).byteLength;
}

function sanitizeUnits(value: string): string {
  return textUnits(value.replace(LONE_SURROGATE, ''))
    .map((unit) => unit.replace(DANGLING_JOINER_OR_SELECTOR, ''))
    .join('');
}

function limitFilenameChars(value: string, max: number): string {
  const chars = textUnits(value);
  return chars.length <= max ? value : chars.slice(0, max).join('');
}

function stripFilenameEdges(value: string): string {
  return value.replace(/^[\s\u3000]+/u, '').replace(/[\s\u3000.]+$/u, '');
}

/** 依完整字元截斷，使 UTF-8 位元組數與字元數都不超過上限，並在截完後去掉結尾的空白與句點。 */
function limitFilenameUnits(
  value: string,
  maxBytes = FILENAME_MAX_BYTES,
  maxChars = FILENAME_MAX_CHARS,
): string {
  const units = textUnits(value);
  let result = '';
  let bytes = 0;
  let count = 0;
  for (const rawUnit of units) {
    const unit = rawUnit.replace(LONE_SURROGATE, '').replace(DANGLING_JOINER_OR_SELECTOR, '');
    if (!unit) continue;
    const unitBytes = utf8ByteLength(unit);
    if (count + 1 > maxChars || bytes + unitBytes > maxBytes) break;
    result += unit;
    bytes += unitBytes;
    count += 1;
  }
  return stripFilenameEdges(result);
}

/** Windows 不允許的裝置名稱（含 COM1～9、LPT1～9 與上標 ¹²³）。在第一個句點前加上後綴字。 */
function avoidReservedBasename(base: string, suffix = RESERVED_NAME_SUFFIX): string {
  const dot = base.indexOf('.');
  const head = dot === -1 ? base : base.slice(0, dot);
  if (!RESERVED_BASENAME.test(head)) return base;
  const rest = dot === -1 ? '' : base.slice(dot);
  return `${head}${suffix}${rest}`;
}

function cleanTitleForBasename(title: string): string {
  const replaced = title.replace(ILLEGAL_FILENAME, (char) => FULLWIDTH_FILENAME[char] ?? '');
  const noControls = sanitizeUnits(replaced.replace(CONTROL_CHARS, ''));
  const cleaned = stripFilenameEdges(noControls);
  if (cleaned) return cleaned;
  return stripFilenameEdges(noControls.replace(/\./g, '．'));
}

/**
 * 產生檔名時，不能用的字改成全形，並去掉控制字元與結尾的句點、空白。
 * 書名裡的全形空白、表情符號留著。只剩標點時改成全形句點，避免檔名變成未命名稿子。
 * 以完整字元為單位限制在 200 位元組（且不超過 80 字）內；Windows 保留名稱後面加「稿」，畫面上的書名不改。
 */
export function sanitizeDbBasename(title: string): string {
  const cleaned = cleanTitleForBasename(title);
  const limited = limitFilenameUnits(cleaned) || '未命名稿子';
  return limitFilenameUnits(avoidReservedBasename(limited)) || '未命名稿子';
}

/** 舊版檔名是把不能用的字直接刪掉。比對時要認得，避免舊檔被誤判成書名不同。 */
export function legacySanitizeDbBasename(title: string): string {
  const trimmed = title
    .replace(ILLEGAL_FILENAME, '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return trimmed.slice(0, 80) || '未命名';
}

function stripPreviousFilenameEdges(value: string): string {
  const trimmed = value.replace(/^[\s\u3000]+/u, '').replace(/[\s\u3000]+$/u, '');
  return trimmed.replace(/\.+$/u, '').replace(/[\s\u3000]+$/u, '');
}

function avoidPreviousReservedBasename(base: string): string {
  const dot = base.indexOf('.');
  const head = dot === -1 ? base : base.slice(0, dot);
  if (!PREVIOUS_RESERVED_BASENAME.test(head)) return base;
  const rest = dot === -1 ? '' : base.slice(dot);
  return `${head}_${rest}`;
}

function cleanPreviousBasename(title: string): string {
  const replaced = title.replace(ILLEGAL_FILENAME, (char) => FULLWIDTH_FILENAME[char] ?? '');
  const noControls = replaced.replace(CONTROL_CHARS, '');
  let cleaned = stripPreviousFilenameEdges(noControls);
  if (!cleaned) cleaned = stripPreviousFilenameEdges(noControls.replace(/\./g, '．'));
  return limitFilenameChars(cleaned, FILENAME_MAX_CHARS) || '未命名稿子';
}

/** 保留 cfb9275 基準版的清理、80 字限制與底線後綴規則，僅供舊檔名相容比對。 */
function previousSanitizeDbBasename(title: string): string {
  const limited = cleanPreviousBasename(title);
  return limitFilenameChars(avoidPreviousReservedBasename(limited), FILENAME_MAX_CHARS);
}

/** 去掉 .db，以及另存檔名結尾的 _年月日-時分。 */
export function filenameStem(filename: string): string {
  let name = filename.trim().replace(CONTROL_CHARS, '');
  if (name.toLowerCase().endsWith('.db')) name = name.slice(0, -3);
  return name.replace(/_\d{8}-\d{4}$/, '');
}

export function titleMatchesFilename(title: string, filename: string): boolean {
  const stem = filenameStem(filename);
  if (!stem) return false;
  const sanitized = sanitizeDbBasename(title);
  if (stem === sanitized || stem === legacySanitizeDbBasename(title)) return true;
  const previousLimited = cleanPreviousBasename(title);
  const previousSanitized = previousSanitizeDbBasename(title);
  if (
    stem === previousSanitized
    || stem === previousLimited
    || avoidPreviousReservedBasename(stem) === previousSanitized
  ) {
    return true;
  }
  const cleaned = cleanTitleForBasename(title);
  const unreservedLimited = limitFilenameUnits(cleaned) || '未命名稿子';
  if (
    stem === unreservedLimited
    || stem === (limitFilenameUnits(avoidReservedBasename(unreservedLimited, '_')) || '未命名稿子')
  ) {
    return true;
  }
  const charLimited = limitFilenameChars(cleaned, FILENAME_MAX_CHARS) || '未命名稿子';
  if (
    stem === charLimited
    || stem === limitFilenameChars(avoidReservedBasename(charLimited, '_'), FILENAME_MAX_CHARS)
    || stem === limitFilenameChars(avoidReservedBasename(charLimited, RESERVED_NAME_SUFFIX), FILENAME_MAX_CHARS)
  ) {
    return true;
  }
  const fullCleaned = cleaned || '未命名稿子';
  return stem === fullCleaned;
}

export function shouldSaveUnderNewName(input: {
  hasExternalFile: boolean;
  titleInFile: string | null;
  title: string;
  filename: string | null;
}): boolean {
  if (!input.hasExternalFile || !input.filename || input.titleInFile == null) return false;
  if (input.title === input.titleInFile) return false;
  return !titleMatchesFilename(input.title, input.filename);
}

export type RenameFollowUp =
  | { kind: 'unchanged' }
  | { kind: 'renamed'; title: string; askSaveAs: boolean; pending: TitleSavePending };

/** 改完書名後，這份稿子要記下的狀態，以及要不要當場問另存。 */
export function bookAfterRename(
  book: BookFileMemory,
  rawTitle: string,
  canWriteBack: boolean,
): { book: BookFileMemory; followUp: RenameFollowUp } {
  const title = resolvedBookTitle(rawTitle);
  if (title === book.title) return { book, followUp: { kind: 'unchanged' } };
  const hasExternalFile = Boolean(book.hasExternalFile);
  const titleInFile = book.titleInFile ?? null;
  const sameAsFile = hasExternalFile && titleInFile != null && title === titleInFile;
  let pending: TitleSavePending = null;
  let askSaveAs = false;
  if (hasExternalFile && !sameAsFile) {
    if (!canWriteBack) {
      askSaveAs = true;
      pending = book.titleSavePending === 'export' ? 'export' : null;
    } else if (shouldSaveUnderNewName({
      hasExternalFile,
      titleInFile,
      title,
      filename: book.filename ?? null,
    })) {
      pending = 'resave';
    }
  }
  return {
    book: {
      ...book,
      title,
      titleSavePending: pending,
    },
    followUp: { kind: 'renamed', title, askSaveAs, pending },
  };
}

export function bookAfterDeferSave(book: BookFileMemory): BookFileMemory {
  return { ...book, titleSavePending: 'export' };
}

export function bookAfterExternalSave(book: BookFileMemory): BookFileMemory {
  return {
    ...book,
    hasExternalFile: true,
    titleInFile: book.title,
    titleSavePending: null,
  };
}

/** 舊的 App 空間沒有這幾個欄位時，用稿子編號判斷是不是從 .db 開進來的。 */
export function externalFileFromStored(input: {
  key: string;
  hasExternalFile?: boolean;
  titleInFile?: string | null;
  title: string;
  titleSavePending?: string | null;
}): BookFileMark {
  const pending: TitleSavePending =
    input.titleSavePending === 'export' || input.titleSavePending === 'resave'
      ? input.titleSavePending
      : null;
  if (typeof input.hasExternalFile === 'boolean') {
    return {
      hasExternalFile: input.hasExternalFile,
      titleInFile: input.hasExternalFile ? (input.titleInFile ?? input.title) : null,
      titleSavePending: input.hasExternalFile ? pending : null,
    };
  }
  const imported = input.key.startsWith('file-');
  return {
    hasExternalFile: imported,
    titleInFile: imported ? input.title : null,
    titleSavePending: null,
  };
}

export type TitleEditSurface = 'card' | 'inline';
export type TitleEditVia = 'confirm' | 'cancel' | 'outside';

/**
 * 卡片（手機改書名、設定頁小視窗）點外面＝取消。
 * 電腦原地輸入框點外面＝確定；框裡是空白時點外面＝還原原書名。
 */
export function commitBookTitleEdit(input: {
  surface: TitleEditSurface;
  via: TitleEditVia;
  raw: string;
  previous: string;
}): { action: 'cancel' } | { action: 'unchanged' } | { action: 'apply'; title: string } {
  if (input.via === 'cancel') return { action: 'cancel' };
  if (input.via === 'outside' && input.surface === 'card') return { action: 'cancel' };
  if (input.via === 'outside' && input.surface === 'inline' && input.raw.trim() === '') {
    return { action: 'cancel' };
  }
  const title = resolvedBookTitle(input.raw);
  if (title === input.previous) return { action: 'unchanged' };
  return { action: 'apply', title };
}

/** 章名不能空白。點外面＝確定；空白時點外面＝還原舊章名。 */
export function commitInlineChapterTitle(via: TitleEditVia, raw: string): 'cancel' | 'apply' | 'blank' {
  if (via === 'cancel') return 'cancel';
  if (raw.trim() === '') return via === 'outside' ? 'cancel' : 'blank';
  return 'apply';
}
